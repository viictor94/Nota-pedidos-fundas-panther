// =====================================================================
// Lógica de pedido.html: página pública de "mi pedido" (solo lectura),
// a la que se llega por un link con ?id=<uuid del pedido>. La usa el
// cliente para ver el detalle y compartirlo, y sirve como comprobante:
// antes de que se finalice el armado muestra todo tal cual se pidió;
// una vez finalizado, separa lo que quedó disponible (tildado por la
// vendedora al armarlo) de lo que no había, y el total a pagar sólo
// cuenta lo disponible.
//
// El armado en sí (tildar/sacar/agregar artículos) ya NO vive acá: se
// mudó al panel de administración ("🛠️ Armar Pedido" en Gestión
// Pedidos), donde la vendedora ya está identificada por su propia
// sesión en vez de tener que tipear un N° de vendedor/a acá.
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
    mostrarPedido(pedido);
  } catch (error) {
    mostrarNoEncontrado();
    return;
  }

  wireEventosEstaticos();
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

// ---------------------------------------------------------------------
// Render del pedido (solo lectura)
// ---------------------------------------------------------------------

function mostrarPedido(pedido) {
  document.getElementById("pedido-cargando").style.display = "none";
  document.getElementById("pedido-contenido").style.display = "block";

  document.getElementById("pedido-fecha").textContent = new Date(pedido.created_at).toLocaleString("es-AR");
  document.getElementById("pedido-cliente-nombre").textContent = pedido.cliente_nombre;
  document.getElementById("pedido-cliente-telefono").textContent = pedido.cliente_telefono;
  document.getElementById("pedido-vendedor").textContent = pedido.vendedor_nombre || "Sin asignar";

  renderTablaPedido(pedido);
  mostrarBotonesCompartir();
}

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

function agregarCeldasComunes(fila, item) {
  const celdaSku = document.createElement("td");
  celdaSku.textContent = item.sku;
  fila.appendChild(celdaSku);

  const celdaDescripcion = document.createElement("td");
  const textoModelo = document.createElement("span");
  textoModelo.textContent = item.modelo;
  celdaDescripcion.appendChild(textoModelo);

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
}

function calcularTotales(items) {
  let total = 0;
  let cantidadArticulos = 0;
  items.forEach(function (item) {
    total += item.precioUnitario * item.cantidad;
    cantidadArticulos += item.cantidad;
  });
  return { total: total, cantidadArticulos: cantidadArticulos };
}

function crearFilaTotalPedido(total, cantidadArticulos) {
  const fila = document.createElement("tr");
  fila.className = "pedido-total-row";

  const celdaEtiqueta = document.createElement("td");
  celdaEtiqueta.colSpan = 4;
  celdaEtiqueta.textContent = "Total (" + cantidadArticulos + " art.)";
  fila.appendChild(celdaEtiqueta);

  const celdaTotal = document.createElement("td");
  celdaTotal.textContent = formatearMoneda(total);
  fila.appendChild(celdaTotal);

  return fila;
}

function limpiarTbody(cuerpo) {
  while (cuerpo.firstChild) {
    cuerpo.removeChild(cuerpo.firstChild);
  }
}

function crearFilaVariantePedido(item, marcado, finalizado) {
  const fila = document.createElement("tr");

  const celdaCheck = document.createElement("td");
  celdaCheck.className = "celda-check";
  if (finalizado) {
    celdaCheck.textContent = marcado ? "✅" : "❌";
    if (!marcado) {
      fila.className = "item-sin-stock";
    }
  }
  fila.appendChild(celdaCheck);

  agregarCeldasComunes(fila, item);
  return fila;
}

function renderTablaPedido(pedido) {
  const cuerpo = document.getElementById("pedido-items-table-body");
  limpiarTbody(cuerpo);

  const marcados = pedido.items_marcados || {};
  const finalizado = Boolean(pedido.armado_finalizado);
  const itemsParaTotal = finalizado
    ? pedido.items.filter(function (item) {
        return marcados[item.sku];
      })
    : pedido.items;

  agruparItemsPorProducto(pedido.items).forEach(function (grupo) {
    cuerpo.appendChild(crearFilaGrupoProducto(grupo.nombre));
    grupo.items.forEach(function (item) {
      cuerpo.appendChild(crearFilaVariantePedido(item, marcados[item.sku], finalizado));
    });
  });

  const totales = calcularTotales(itemsParaTotal);
  cuerpo.appendChild(crearFilaTotalPedido(totales.total, totales.cantidadArticulos));

  document.getElementById("pedido-sin-stock-nota").style.display = finalizado ? "block" : "none";
}

// ---------------------------------------------------------------------
// Compartir / copiar el link del pedido
// ---------------------------------------------------------------------

function mostrarBotonesCompartir() {
  document.getElementById("pedido-acciones-compartir").style.display = "flex";
}

function construirTextoPedidoCompartido() {
  const url = window.location.href;
  return (
    "Hola, acabo de hacer un pedido de fundas en Panther Distribuciones.\n\n" +
    "Te dejo mis datos:\n\n" +
    "* Nombre completo: " +
    pedidoActual.cliente_nombre +
    "\n* Teléfono: " +
    pedidoActual.cliente_telefono +
    "\n\n" +
    "Aguardo así me confirmás que tenés stock de todo, así procedo a realizar el pago.\n" +
    "Acá está el link del pedido: " +
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
// portapapeles en vez de abrir WhatsApp, para que se pegue donde
// resulte más cómodo (otro chat, un mail, etc.).
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
    copiarTextoConFallback(texto);
    mostrarCopiadoConfirmacion();
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

// ---------------------------------------------------------------------
// Wiring de eventos estáticos
// ---------------------------------------------------------------------

function wireEventosEstaticos() {
  document.getElementById("btn-compartir-vendedor").addEventListener("click", function () {
    compartirPedidoLink();
  });
  document.getElementById("btn-compartir-generico").addEventListener("click", function () {
    copiarEnlacePedido();
  });
}
