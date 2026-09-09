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

document.addEventListener("DOMContentLoaded", async function () {
  const idPedido = new URLSearchParams(window.location.search).get("id");

  if (!idPedido) {
    mostrarNoEncontrado();
    return;
  }

  try {
    const pedido = await obtenerPedidoPublico(idPedido);
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
    compartirPedidoLink(true);
  });
  document.getElementById("btn-compartir-generico").addEventListener("click", function () {
    compartirPedidoLink(false);
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

  // Estilo "planilla": cada funda aparece como una fila de encabezado
  // (verde de marca) y debajo, una fila por cada variante comprada de
  // esa funda, para que se pueda revisar el detalle SKU por SKU.
  agruparItemsPorProducto(pedido.items).forEach(function (grupo) {
    cuerpoTabla.appendChild(crearFilaGrupoProducto(grupo.nombre));
    grupo.items.forEach(function (item) {
      cuerpoTabla.appendChild(crearFilaVariantePedido(item));
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
  celda.colSpan = 4;
  celda.textContent = nombreProducto;
  fila.appendChild(celda);

  return fila;
}

function crearFilaVariantePedido(item) {
  const fila = document.createElement("tr");

  const celdaSku = document.createElement("td");
  celdaSku.textContent = item.sku;
  fila.appendChild(celdaSku);

  const celdaDescripcion = document.createElement("td");
  celdaDescripcion.textContent = item.modelo;
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
  celdaEtiqueta.colSpan = 3;
  celdaEtiqueta.textContent = "Total (" + pedido.cantidad_articulos + " art.)";
  fila.appendChild(celdaEtiqueta);

  const celdaTotal = document.createElement("td");
  celdaTotal.textContent = formatearMoneda(pedido.total);
  fila.appendChild(celdaTotal);

  return fila;
}

// Comparte el link de este mismo pedido: primero intenta el share
// nativo del sistema (solo texto + url, no requiere generar ningún
// archivo, así que funciona en muchos más navegadores que compartir
// archivos), y si no está disponible cae a un link directo de wa.me.
async function compartirPedidoLink(paraVendedor) {
  const url = window.location.href;
  const texto =
    "Hola! Armé mi pedido por la web de fundas. Te dejo mis datos: nombre: " +
    pedidoActual.cliente_nombre +
    ", teléfono: " +
    pedidoActual.cliente_telefono +
    ". Aguardo así me confirmás stock y abono el total. Podés ver el detalle acá: " +
    url;

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

  if (paraVendedor) {
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
  }

  // Sin número de vendedor configurado (o "compartir a otro contacto"
  // sin share nativo disponible): abre WhatsApp genérico con el texto
  // ya armado, para que el cliente elija el contacto.
  window.location.href = "https://wa.me/?text=" + encodeURIComponent(texto);
}
