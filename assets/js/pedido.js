// =====================================================================
// Lógica de pedido.html: página pública de "ver mi pedido", a la que
// el cliente llega por un link con ?id=<uuid del pedido>. Reemplaza al
// PDF generado en el navegador (poco confiable en varios celulares):
// ahora el cliente comparte este link por WhatsApp en vez de un
// archivo, y la vendedora entra a verlo directamente.
//
// Reglas de código del proyecto (AGENTS.md): sin innerHTML (todo con
// createElement/appendChild), sin alert/confirm/prompt, preventDefault
// en todos los submits/clicks que lo necesiten.
// =====================================================================

let pedidoActual = null;
let pedidoIdActual = null;

document.addEventListener("DOMContentLoaded", async function () {
  pedidoIdActual = new URLSearchParams(window.location.search).get("id");

  if (!pedidoIdActual) {
    mostrarNoEncontrado();
    return;
  }

  try {
    const pedido = await obtenerPedidoPublico(pedidoIdActual);
    if (!pedido) {
      mostrarNoEncontrado();
      return;
    }
    pedidoActual = pedido;
    renderPedido(pedido);
  } catch (error) {
    mostrarNoEncontrado();
  }

  document.getElementById("btn-compartir-vendedor").addEventListener("click", function () {
    compartirPedidoLink();
  });
  document.getElementById("btn-compartir-generico").addEventListener("click", function () {
    copiarEnlacePedido();
  });
  document.getElementById("btn-imprimir-pedido").addEventListener("click", function () {
    window.print();
  });
});

function mostrarNoEncontrado() {
  document.getElementById("pedido-cargando").style.display = "none";
  document.getElementById("pedido-no-encontrado").style.display = "block";
}

function formatearMoneda(numero) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(numero));
}

function renderPedido(pedido) {
  document.getElementById("pedido-cargando").style.display = "none";
  document.getElementById("pedido-contenido").style.display = "block";

  document.getElementById("pedido-fecha").textContent = new Date(pedido.created_at).toLocaleString("es-AR");
  document.getElementById("pedido-cliente-nombre").textContent = pedido.cliente_nombre;
  document.getElementById("pedido-cliente-telefono").textContent = pedido.cliente_telefono;
  document.getElementById("pedido-vendedor").textContent = pedido.vendedor_nombre || "Sin asignar";

  const cuerpoTabla = document.getElementById("pedido-items-table-body");
  while (cuerpoTabla.firstChild) {
    cuerpoTabla.removeChild(cuerpoTabla.firstChild);
  }

  const itemsMarcados = pedido.items_marcados || {};

  // Estilo "planilla": cada funda aparece como una fila de encabezado
  // (verde de marca) y debajo, una fila por cada variante comprada de
  // esa funda, para que se pueda revisar el detalle SKU por SKU.
  agruparItemsPorProducto(pedido.items).forEach(function (grupo) {
    cuerpoTabla.appendChild(crearFilaGrupoProducto(grupo.nombre));
    grupo.items.forEach(function (item) {
      cuerpoTabla.appendChild(crearFilaVariantePedido(item, itemsMarcados[item.sku]));
    });
  });

  cuerpoTabla.appendChild(crearFilaTotalPedido(pedido));
}

// Agrupa los ítems del pedido por producto (nombre de la funda),
// conservando el orden en que aparecen, para poder mostrar cada funda
// como un bloque con sus variantes debajo.
function agruparItemsPorProducto(items) {
  const grupos = [];
  const indicePorNombre = {};

  items.forEach(function (item) {
    if (!(item.productoNombre in indicePorNombre)) {
      indicePorNombre[item.productoNombre] = grupos.length;
      grupos.push({ nombre: item.productoNombre, items: [] });
    }
    grupos[indicePorNombre[item.productoNombre]].items.push(item);
  });

  return grupos;
}

function crearFilaGrupoProducto(nombreProducto) {
  const fila = document.createElement("tr");
  fila.className = "pedido-producto-header";

  const celda = document.createElement("td");
  celda.colSpan = 5;
  celda.textContent = nombreProducto;
  fila.appendChild(celda);

  return fila;
}

function crearFilaVariantePedido(item, marcado) {
  const fila = document.createElement("tr");
  if (marcado) {
    fila.className = "item-marcado";
  }

  const celdaCheck = document.createElement("td");
  celdaCheck.className = "celda-check";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(marcado);
  checkbox.setAttribute("aria-label", "Marcar " + item.sku + " como controlado");
  checkbox.addEventListener("change", function () {
    manejarCambioCheck(item.sku, checkbox, fila);
  });
  celdaCheck.appendChild(checkbox);
  fila.appendChild(celdaCheck);

  const celdaSku = document.createElement("td");
  celdaSku.textContent = item.sku;
  fila.appendChild(celdaSku);

  const celdaDescripcion = document.createElement("td");
  const textoModelo = document.createElement("span");
  textoModelo.textContent = item.modelo;
  celdaDescripcion.appendChild(textoModelo);

  // Detalle que dejó el cliente al armar el pedido (color, género,
  // diseño puntual, etc.): se ve acá y al imprimir/PDF, pero nunca se
  // exporta al Excel de picking.
  if (item.nota) {
    const nota = document.createElement("div");
    nota.className = "pedido-item-nota";
    nota.textContent = "📝 " + item.nota;
    celdaDescripcion.appendChild(nota);
  }
  fila.appendChild(celdaDescripcion);

  const celdaCantidad = document.createElement("td");
  celdaCantidad.textContent = String(item.cantidad);
  fila.appendChild(celdaCantidad);

  const celdaPrecio = document.createElement("td");
  celdaPrecio.textContent = formatearMoneda(item.precioUnitario);
  fila.appendChild(celdaPrecio);

  return fila;
}

function crearFilaTotalPedido(pedido) {
  const fila = document.createElement("tr");
  fila.className = "pedido-total-row";

  const celdaEtiqueta = document.createElement("td");
  celdaEtiqueta.colSpan = 4;
  celdaEtiqueta.textContent = "Total (" + pedido.cantidad_articulos + " art.)";
  fila.appendChild(celdaEtiqueta);

  const celdaTotal = document.createElement("td");
  celdaTotal.textContent = formatearMoneda(pedido.total);
  fila.appendChild(celdaTotal);

  return fila;
}

// Guarda en Supabase que esta variante quedó controlada (o se
// destildó), para que el checklist de armado se mantenga aunque se
// cierre y reabra el link. Si falla el guardado (sin conexión, etc.),
// se revierte el checkbox y se avisa sin usar alert().
async function manejarCambioCheck(sku, checkbox, fila) {
  const marcado = checkbox.checked;
  fila.classList.toggle("item-marcado", marcado);
  checkbox.disabled = true;

  try {
    await marcarItemPedido(pedidoIdActual, sku, marcado);
  } catch (error) {
    checkbox.checked = !marcado;
    fila.classList.toggle("item-marcado", !marcado);
    mostrarErrorGuardadoCheck();
  } finally {
    checkbox.disabled = false;
  }
}

function mostrarErrorGuardadoCheck() {
  const nota = document.getElementById("pedido-guardado-error");
  if (!nota) {
    return;
  }
  nota.style.display = "block";
  window.clearTimeout(mostrarErrorGuardadoCheck.temporizador);
  mostrarErrorGuardadoCheck.temporizador = window.setTimeout(function () {
    nota.style.display = "none";
  }, 4000);
}

function construirTextoPedidoCompartido() {
  const url = window.location.href;
  return (
    "Hola! Armé mi pedido por la web de fundas. Te dejo mis datos: nombre: " +
    pedidoActual.cliente_nombre +
    ", teléfono: " +
    pedidoActual.cliente_telefono +
    ". Aguardo así me confirmás stock y abono el total. Podés ver el detalle acá: " +
    url
  );
}

// Comparte el link de este pedido directamente con la vendedora:
// primero intenta el share nativo del sistema, y si no está disponible
// (o el navegador no soporta navigator.share) cae a un link directo de
// wa.me con su número ya cargado en configuración.
async function compartirPedidoLink() {
  const texto = construirTextoPedidoCompartido();

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Nota de Pedido - Panther Distribuciones", text: texto });
      return;
    } catch (error) {
      // El usuario cancela el cuadro de compartir: no es un error real.
      if (error && error.name === "AbortError") {
        return;
      }
    }
  }

  const config = await obtenerConfig().catch(function () {
    return { whatsapp_vendedor: "" };
  });
  if (config.whatsapp_vendedor) {
    const nota = document.getElementById("compartir-fallback-note");
    if (nota) {
      nota.style.display = "block";
    }
    window.location.href = "https://wa.me/" + config.whatsapp_vendedor + "?text=" + encodeURIComponent(texto);
    return;
  }

  // Sin número de vendedor configurado: abre WhatsApp genérico con el
  // texto ya armado, para que el cliente elija el contacto.
  window.location.href = "https://wa.me/?text=" + encodeURIComponent(texto);
}

// "Copiar Enlace del pedido": copia el mismo mensaje + link al
// portapapeles en vez de abrir WhatsApp, para que la vendedora lo pegue
// donde le resulte más cómodo (otro chat, un mail, etc.).
async function copiarEnlacePedido() {
  const texto = construirTextoPedidoCompartido();

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(texto);
    } else {
      copiarTextoConFallback(texto);
    }
    mostrarCopiadoConfirmacion();
  } catch (error) {
    // Algunos navegadores rechazan el Clipboard API fuera de HTTPS o sin
    // permiso; se intenta el método clásico antes de darse por vencido.
    try {
      copiarTextoConFallback(texto);
      mostrarCopiadoConfirmacion();
    } catch (errorFallback) {
      mostrarErrorGuardadoCheck();
    }
  }
}

// Método clásico de copiado (textarea oculto + execCommand), para
// navegadores sin soporte del Clipboard API moderno.
function copiarTextoConFallback(texto) {
  const textarea = document.createElement("textarea");
  textarea.value = texto;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function mostrarCopiadoConfirmacion() {
  const nota = document.getElementById("copiado-confirmacion");
  if (!nota) {
    return;
  }
  nota.style.display = "block";
  window.clearTimeout(mostrarCopiadoConfirmacion.temporizador);
  mostrarCopiadoConfirmacion.temporizador = window.setTimeout(function () {
    nota.style.display = "none";
  }, 4000);
}
