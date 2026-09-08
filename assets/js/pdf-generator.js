// =====================================================================
// Generador del comprobante de pedido en PDF (usa html2pdf.js, cargado
// como <script> en index.html).
//
// El comprobante se arma como un nodo DOM real (createElement +
// appendChild, nunca innerHTML), se agrega oculto al body solo
// mientras se genera el PDF, y se elimina apenas termina.
// =====================================================================

// Arma el nodo DOM con el detalle del pedido.
function construirNodoComprobante(pedido) {
  const contenedor = document.createElement("div");
  contenedor.style.padding = "24px";
  contenedor.style.fontFamily = "Arial, sans-serif";
  contenedor.style.color = "#1f2937";
  contenedor.style.width = "600px";

  // Encabezado con logo y título.
  const encabezado = document.createElement("div");
  encabezado.style.display = "flex";
  encabezado.style.alignItems = "center";
  encabezado.style.gap = "16px";
  encabezado.style.marginBottom = "20px";

  const logoImg = document.createElement("img");
  logoImg.src = typeof LOGO_DATA_URL !== "undefined" ? LOGO_DATA_URL : "";
  logoImg.style.height = "56px";
  encabezado.appendChild(logoImg);

  const tituloWrap = document.createElement("div");
  const titulo = document.createElement("h1");
  titulo.textContent = "Nota de Pedido";
  titulo.style.margin = "0";
  titulo.style.fontSize = "20px";
  tituloWrap.appendChild(titulo);

  const fecha = document.createElement("p");
  fecha.textContent = new Date(pedido.fecha).toLocaleString("es-AR");
  fecha.style.margin = "4px 0 0";
  fecha.style.fontSize = "12px";
  fecha.style.color = "#6b7280";
  tituloWrap.appendChild(fecha);

  encabezado.appendChild(tituloWrap);
  contenedor.appendChild(encabezado);

  // Datos del cliente.
  const datosCliente = document.createElement("div");
  datosCliente.style.marginBottom = "16px";
  datosCliente.style.fontSize = "13px";

  const nombreCliente = document.createElement("p");
  nombreCliente.style.margin = "2px 0";
  const nombreLabel = document.createElement("strong");
  nombreLabel.textContent = "Cliente: ";
  nombreCliente.appendChild(nombreLabel);
  nombreCliente.appendChild(document.createTextNode(pedido.clienteNombre));
  datosCliente.appendChild(nombreCliente);

  const telefonoCliente = document.createElement("p");
  telefonoCliente.style.margin = "2px 0";
  const telefonoLabel = document.createElement("strong");
  telefonoLabel.textContent = "Teléfono: ";
  telefonoCliente.appendChild(telefonoLabel);
  telefonoCliente.appendChild(document.createTextNode(pedido.clienteTelefono));
  datosCliente.appendChild(telefonoCliente);

  contenedor.appendChild(datosCliente);

  // Tabla de ítems.
  const tabla = document.createElement("table");
  tabla.style.width = "100%";
  tabla.style.borderCollapse = "collapse";
  tabla.style.fontSize = "12px";

  const encabezadoTabla = document.createElement("thead");
  const filaEncabezado = document.createElement("tr");
  ["Producto", "Modelo", "Precio Unit.", "Cant.", "Subtotal"].forEach(function (texto) {
    const th = document.createElement("th");
    th.textContent = texto;
    th.style.borderBottom = "2px solid #3e863c";
    th.style.textAlign = "left";
    th.style.padding = "6px 4px";
    filaEncabezado.appendChild(th);
  });
  encabezadoTabla.appendChild(filaEncabezado);
  tabla.appendChild(encabezadoTabla);

  const cuerpoTabla = document.createElement("tbody");
  pedido.items.forEach(function (item) {
    const fila = document.createElement("tr");

    const celdas = [
      item.productoNombre,
      item.modelo,
      formatearMoneda(item.precioUnitario),
      String(item.cantidad),
      formatearMoneda(item.subtotal),
    ];

    celdas.forEach(function (texto) {
      const td = document.createElement("td");
      td.textContent = texto;
      td.style.borderBottom = "1px solid #e5e7eb";
      td.style.padding = "6px 4px";
      fila.appendChild(td);
    });

    cuerpoTabla.appendChild(fila);
  });
  tabla.appendChild(cuerpoTabla);
  contenedor.appendChild(tabla);

  // Total.
  const totalWrap = document.createElement("div");
  totalWrap.style.textAlign = "right";
  totalWrap.style.marginTop = "16px";
  totalWrap.style.fontSize = "16px";
  totalWrap.style.fontWeight = "800";
  totalWrap.style.color = "#3e863c";
  totalWrap.textContent =
    "Total: " + formatearMoneda(pedido.total) + " (" + pedido.cantidadArticulos + " art.)";
  contenedor.appendChild(totalWrap);

  return contenedor;
}

function formatearMoneda(numero) {
  return "$" + Number(numero).toFixed(2);
}

// Arma una pantalla completa que tapa visualmente al comprobante
// mientras se genera el PDF. Es necesaria porque html2canvas rearma
// los estilos reales del nodo capturado: si el nodo se oculta con
// opacity:0 (como se hacía antes), la captura también sale
// transparente/en blanco. Acá el nodo queda realmente pintado en
// pantalla (opaco, dentro del viewport), y este overlay -que sí es
// opaco y va arriba en el z-index- es lo único que el usuario ve.
function crearOverlayCargando() {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "99999";
  overlay.style.background = "#ffffff";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.fontFamily = "Arial, sans-serif";
  overlay.style.color = "#3e863c";
  overlay.style.fontWeight = "700";
  overlay.textContent = "Generando comprobante...";
  return overlay;
}

// Genera el PDF del pedido y devuelve un File listo para descargar o
// compartir.
async function generarPdfPedido(pedido) {
  const nodo = construirNodoComprobante(pedido);

  // El nodo se agrega realmente visible y dentro del viewport (0,0),
  // sin opacity ni posiciones extremas: html2canvas necesita que el
  // navegador lo haya pintado de verdad para poder capturarlo.
  nodo.style.position = "fixed";
  nodo.style.top = "0";
  nodo.style.left = "0";
  nodo.style.background = "#ffffff";
  nodo.style.zIndex = "1";
  document.body.appendChild(nodo);

  // El overlay de carga va arriba (z-index mayor) y tapa por completo
  // al nodo real, para que el usuario no vea el comprobante "en bruto".
  const overlay = crearOverlayCargando();
  document.body.appendChild(overlay);

  // Espera a que el logo (imagen embebida) termine de decodificarse
  // antes de rasterizar, para no capturar el nodo a medio pintar.
  const logoImg = nodo.querySelector("img");
  if (logoImg && typeof logoImg.decode === "function") {
    await logoImg.decode().catch(function () {});
  }
  // Fuerza un reflow y le da un par de frames al navegador para pintar.
  nodo.offsetHeight;
  await new Promise(function (resolve) {
    requestAnimationFrame(function () {
      requestAnimationFrame(resolve);
    });
  });

  try {
    const blob = await html2pdf()
      .set({
        margin: 10,
        filename: "pedido.pdf",
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(nodo)
      .outputPdf("blob");

    const nombreArchivo = "pedido-" + (pedido.id || Date.now()) + ".pdf";
    return new File([blob], nombreArchivo, { type: "application/pdf" });
  } finally {
    document.body.removeChild(nodo);
    document.body.removeChild(overlay);
  }
}
