// =====================================================================
// Lógica del catálogo cliente (index.html): render de productos,
// carrito en memoria, checkout, generación de PDF/Excel y envío por
// WhatsApp.
//
// Reglas de código del proyecto (AGENTS.md): sin innerHTML (todo con
// createElement/appendChild), sin alert/confirm/prompt (todo feedback
// visual en el DOM), preventDefault en todos los submits/clicks que lo
// necesiten.
// =====================================================================

// ---------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------

const PRODUCTOS_POR_PAGINA = 8;

let catalogoCompleto = []; // Productos con variantes, tal como vienen de Supabase.
let configuracionApp = { whatsapp_vendedor: "" };
let productosVisibles = PRODUCTOS_POR_PAGINA;

// Carrito: mapa varianteId -> { productoId, productoNombre, varianteId, sku, modelo, precioUnitario, cantidad }
let carrito = {};

// Producto actualmente abierto en el modal de variantes.
let productoEnModal = null;

// Archivos generados del último pedido confirmado (para los botones
// del modal de éxito).
let ultimoPedido = null;
let ultimoPdfFile = null;
let ultimoExcelFile = null;

// ---------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async function () {
  wireEventosEstaticos();

  try {
    const [catalogo, config] = await Promise.all([obtenerCatalogo(), obtenerConfig()]);
    catalogoCompleto = catalogo;
    configuracionApp = config;
    actualizarTextoUltimaActualizacion(config.catalogo_actualizado_en);
    renderCatalogo();
  } catch (error) {
    mostrarErrorCatalogo();
  }

  // Mantiene el catálogo al día si el admin cambia algo mientras el
  // cliente tiene la página abierta. Si la suscripción en sí falla (sin
  // conexión, websockets bloqueados, etc.), el catálogo ya cargado
  // sigue siendo utilizable: no debe romper el resto de la página.
  try {
    suscribirCambiosCatalogo(async function () {
      try {
        const [catalogo, config] = await Promise.all([obtenerCatalogo(), obtenerConfig()]);
        catalogoCompleto = catalogo;
        configuracionApp = config;
        actualizarTextoUltimaActualizacion(config.catalogo_actualizado_en);
        renderCatalogo();
      } catch (error) {
        // Si falla el refresco en vivo, no se interrumpe al usuario.
      }
    });
  } catch (error) {
    // Sin tiempo real disponible, el catálogo sigue funcionando normal.
  }
});

function actualizarTextoUltimaActualizacion(fechaIso) {
  const texto = document.getElementById("last-updated-text");
  if (!texto) return;
  const fecha = new Date(fechaIso);
  texto.textContent = fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function mostrarErrorCatalogo() {
  const grid = document.getElementById("catalog-grid");
  if (!grid) return;
  const mensaje = document.createElement("p");
  mensaje.textContent = "No se pudo cargar el catálogo. Verificá tu conexión e intentá de nuevo más tarde.";
  mensaje.style.color = "var(--color-text-light)";
  mensaje.style.gridColumn = "1 / -1";
  mensaje.style.textAlign = "center";
  grid.appendChild(mensaje);
}

function wireEventosEstaticos() {
  document.getElementById("btn-header-cart").addEventListener("click", mostrarCheckout);
  document.getElementById("btn-terminar-pedido").addEventListener("click", mostrarCheckout);
  document.getElementById("btn-back-catalog").addEventListener("click", volverAlCatalogo);
  document.getElementById("btn-load-more").addEventListener("click", function () {
    productosVisibles += PRODUCTOS_POR_PAGINA;
    renderCatalogo();
  });

  document.getElementById("btn-close-modal").addEventListener("click", cerrarModalVariantes);
  document.getElementById("btn-modal-listo").addEventListener("click", cerrarModalVariantes);

  document.getElementById("checkout-form").addEventListener("submit", manejarSubmitCheckout);

  document.getElementById("btn-share-vendor").addEventListener("click", function () {
    compartirPedido({ incluirExcel: true, abrirWhatsappVendedor: true });
  });
  document.getElementById("btn-share-generic").addEventListener("click", function () {
    compartirPedido({ incluirExcel: true, abrirWhatsappVendedor: false });
  });
  document.getElementById("btn-download-only").addEventListener("click", function () {
    descargarArchivo(ultimoPdfFile);
  });
  document.getElementById("btn-close-success").addEventListener("click", function () {
    ocultarModal(document.getElementById("success-modal"));
    reiniciarDespuesDePedido();
  });
}

// ---------------------------------------------------------------------
// Render del catálogo
// ---------------------------------------------------------------------

function renderCatalogo() {
  const grid = document.getElementById("catalog-grid");
  while (grid.firstChild) {
    grid.removeChild(grid.firstChild);
  }

  const visibles = catalogoCompleto.slice(0, productosVisibles);
  visibles.forEach(function (producto) {
    grid.appendChild(crearTarjetaProducto(producto));
  });

  const restantes = catalogoCompleto.length - visibles.length;
  const contenedorCargarMas = document.getElementById("load-more-container");
  document.getElementById("load-more-count").textContent = String(restantes);
  contenedorCargarMas.style.display = restantes > 0 ? "block" : "none";
}

function crearTarjetaProducto(producto) {
  const precioMasBarato = Math.min.apply(
    null,
    producto.variantes.map(function (v) {
      return v.precio_actual;
    })
  );

  const tarjeta = document.createElement("article");
  tarjeta.className = "product-card";

  const imagenWrap = document.createElement("div");
  imagenWrap.className = "product-card-image-wrap";
  const imagen = document.createElement("img");
  imagen.src = producto.imagen_url || "assets/img/placeholder-producto.svg";
  imagen.alt = producto.nombre;
  imagenWrap.appendChild(imagen);
  tarjeta.appendChild(imagenWrap);

  const cuerpo = document.createElement("div");
  cuerpo.className = "product-card-body";

  const nombre = document.createElement("h3");
  nombre.className = "product-card-name";
  nombre.textContent = producto.nombre;
  cuerpo.appendChild(nombre);

  const labelDesde = document.createElement("span");
  labelDesde.className = "product-card-price-label";
  labelDesde.textContent = "Desde";
  cuerpo.appendChild(labelDesde);

  const precio = document.createElement("p");
  precio.className = "product-card-price";
  precio.textContent = formatearMoneda(precioMasBarato);
  cuerpo.appendChild(precio);

  tarjeta.appendChild(cuerpo);

  tarjeta.addEventListener("click", function () {
    abrirModalVariantes(producto);
  });

  return tarjeta;
}

// ---------------------------------------------------------------------
// Modal de variantes
// ---------------------------------------------------------------------

function abrirModalVariantes(producto) {
  productoEnModal = producto;

  document.getElementById("modal-product-title").textContent = producto.nombre;
  const imagen = document.getElementById("modal-product-image");
  imagen.src = producto.imagen_url || "assets/img/placeholder-producto.svg";
  imagen.alt = producto.nombre;

  const lista = document.getElementById("modal-variants-list");
  while (lista.firstChild) {
    lista.removeChild(lista.firstChild);
  }

  producto.variantes.forEach(function (variante) {
    lista.appendChild(crearFilaVariante(producto, variante));
  });

  mostrarModal(document.getElementById("variant-modal"));
}

function crearFilaVariante(producto, variante) {
  const fila = document.createElement("div");
  fila.className = "variant-item";

  const info = document.createElement("div");
  info.className = "variant-item-info";

  const modelo = document.createElement("span");
  modelo.className = "variant-item-model";
  modelo.textContent = variante.modelo;
  info.appendChild(modelo);

  const precio = document.createElement("span");
  precio.className = "variant-item-price";
  precio.textContent = formatearMoneda(variante.precio_actual);
  info.appendChild(precio);

  const stockBadge = document.createElement("span");
  stockBadge.className = "variant-item-stock stock-badge " + claseCssStock(variante.stock_estado);
  stockBadge.textContent = variante.stock_estado;
  info.appendChild(stockBadge);

  fila.appendChild(info);

  const sinStock = variante.stock_estado === "SIN STOCK";

  if (sinStock) {
    const aviso = document.createElement("span");
    aviso.textContent = "No disponible";
    aviso.style.fontSize = "0.8rem";
    aviso.style.color = "var(--color-text-light)";
    fila.appendChild(aviso);
    return fila;
  }

  const control = document.createElement("div");
  control.className = "qty-control";

  const btnMenos = document.createElement("button");
  btnMenos.type = "button";
  btnMenos.className = "qty-btn";
  btnMenos.textContent = "−";

  const valor = document.createElement("span");
  valor.className = "qty-value";
  valor.textContent = String((carrito[variante.id] && carrito[variante.id].cantidad) || 0);

  const btnMas = document.createElement("button");
  btnMas.type = "button";
  btnMas.className = "qty-btn";
  btnMas.textContent = "+";

  btnMenos.addEventListener("click", function () {
    cambiarCantidadCarrito(producto, variante, -1);
    valor.textContent = String((carrito[variante.id] && carrito[variante.id].cantidad) || 0);
  });

  btnMas.addEventListener("click", function () {
    cambiarCantidadCarrito(producto, variante, 1);
    valor.textContent = String((carrito[variante.id] && carrito[variante.id].cantidad) || 0);
  });

  control.appendChild(btnMenos);
  control.appendChild(valor);
  control.appendChild(btnMas);
  fila.appendChild(control);

  return fila;
}

function claseCssStock(stockEstado) {
  const mapa = {
    "HAY STOCK": "hay-stock",
    "POCO STOCK": "poco-stock",
    "POR AGOTARSE": "por-agotarse",
    "SIN STOCK": "sin-stock",
  };
  return mapa[stockEstado] || "sin-stock";
}

function cambiarCantidadCarrito(producto, variante, delta) {
  const actual = carrito[variante.id];
  const nuevaCantidad = (actual ? actual.cantidad : 0) + delta;

  if (nuevaCantidad <= 0) {
    delete carrito[variante.id];
  } else {
    carrito[variante.id] = {
      productoId: producto.id,
      productoNombre: producto.nombre,
      varianteId: variante.id,
      sku: variante.sku,
      modelo: variante.modelo,
      precioUnitario: variante.precio_actual,
      cantidad: nuevaCantidad,
    };
  }

  actualizarUiCarrito();
}

function cerrarModalVariantes() {
  ocultarModal(document.getElementById("variant-modal"));
  productoEnModal = null;
}

// ---------------------------------------------------------------------
// Carrito (header + botón flotante)
// ---------------------------------------------------------------------

function obtenerItemsCarrito() {
  return Object.values(carrito);
}

function obtenerCantidadTotalCarrito() {
  return obtenerItemsCarrito().reduce(function (total, item) {
    return total + item.cantidad;
  }, 0);
}

function obtenerTotalCarrito() {
  return obtenerItemsCarrito().reduce(function (total, item) {
    return total + item.cantidad * item.precioUnitario;
  }, 0);
}

function actualizarUiCarrito() {
  const cantidad = obtenerCantidadTotalCarrito();
  const total = obtenerTotalCarrito();

  document.getElementById("header-cart-count").textContent = String(cantidad);
  document.getElementById("btn-header-cart").style.display = cantidad > 0 ? "inline-flex" : "none";

  // El span de preview del total tiene el formato "$X (N art.)"; se
  // reconstruye completo para evitar depender de nodos de texto sueltos.
  const preview = document.getElementById("cart-total-preview");
  while (preview.firstChild) {
    preview.removeChild(preview.firstChild);
  }
  preview.appendChild(document.createTextNode(formatearMoneda(total) + " ("));
  const spanQty = document.createElement("span");
  spanQty.id = "cart-qty-preview";
  spanQty.textContent = String(cantidad);
  preview.appendChild(spanQty);
  preview.appendChild(document.createTextNode(" art.)"));

  const stickyCart = document.getElementById("sticky-cart");
  if (cantidad > 0) {
    stickyCart.classList.add("visible");
  } else {
    stickyCart.classList.remove("visible");
  }
}

// ---------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------

function mostrarCheckout() {
  if (obtenerCantidadTotalCarrito() === 0) {
    return;
  }
  document.getElementById("catalog-section").classList.remove("active");
  document.getElementById("checkout-section").classList.add("active");
  renderResumenCarrito();
}

function volverAlCatalogo() {
  document.getElementById("checkout-section").classList.remove("active");
  document.getElementById("catalog-section").classList.add("active");
}

function renderResumenCarrito() {
  const contenedor = document.getElementById("cart-summary-container");
  while (contenedor.firstChild) {
    contenedor.removeChild(contenedor.firstChild);
  }

  obtenerItemsCarrito().forEach(function (item) {
    contenedor.appendChild(crearFilaResumen(item));
  });

  const totalFila = document.createElement("div");
  totalFila.className = "cart-summary-total";

  const totalLabel = document.createElement("span");
  totalLabel.textContent = "Total (" + obtenerCantidadTotalCarrito() + " art.)";
  totalFila.appendChild(totalLabel);

  const totalValor = document.createElement("span");
  totalValor.textContent = formatearMoneda(obtenerTotalCarrito());
  totalFila.appendChild(totalValor);

  contenedor.appendChild(totalFila);
}

function crearFilaResumen(item) {
  const fila = document.createElement("div");
  fila.className = "cart-summary-item";

  const info = document.createElement("div");
  info.className = "cart-summary-item-info";

  const nombre = document.createElement("span");
  nombre.className = "cart-summary-item-name";
  nombre.textContent = item.productoNombre;
  info.appendChild(nombre);

  const modelo = document.createElement("span");
  modelo.className = "cart-summary-item-model";
  modelo.textContent = item.modelo + " × " + item.cantidad;
  info.appendChild(modelo);

  fila.appendChild(info);

  const subtotal = document.createElement("span");
  subtotal.textContent = formatearMoneda(item.precioUnitario * item.cantidad);
  fila.appendChild(subtotal);

  return fila;
}

async function manejarSubmitCheckout(evento) {
  evento.preventDefault();

  const boton = document.getElementById("btn-confirm-order");
  boton.disabled = true;

  try {
    const stockOk = await verificarStockVigente();
    if (!stockOk) {
      return;
    }

    const nombre = document.getElementById("customer-name").value.trim();
    const telefono = document.getElementById("customer-phone").value.trim();

    const items = obtenerItemsCarrito().map(function (item) {
      return {
        productoNombre: item.productoNombre,
        modelo: item.modelo,
        sku: item.sku,
        precioUnitario: item.precioUnitario,
        cantidad: item.cantidad,
        subtotal: item.precioUnitario * item.cantidad,
      };
    });

    const pedidoInfo = {
      clienteNombre: nombre,
      clienteTelefono: telefono,
      items: items,
      total: obtenerTotalCarrito(),
      cantidadArticulos: obtenerCantidadTotalCarrito(),
    };

    const registrado = await crearPedido(pedidoInfo);

    ultimoPedido = Object.assign({}, pedidoInfo, {
      id: registrado.id,
      fecha: registrado.created_at,
    });

    ultimoPdfFile = await generarPdfPedido(ultimoPedido);
    ultimoExcelFile = generarExcelPedido(ultimoPedido);

    mostrarModal(document.getElementById("success-modal"));
  } catch (error) {
    mostrarAvisoStock("Ocurrió un error al generar tu pedido. Intentá de nuevo.");
  } finally {
    boton.disabled = false;
  }
}

// Vuelve a pedir el catálogo a Supabase y verifica que todo lo que hay
// en el carrito siga teniendo stock disponible antes de confirmar.
async function verificarStockVigente() {
  const catalogoFresco = await obtenerCatalogo();
  const variantesFrescas = {};
  catalogoFresco.forEach(function (producto) {
    producto.variantes.forEach(function (variante) {
      variantesFrescas[variante.id] = variante;
    });
  });

  const itemsSinStock = obtenerItemsCarrito().filter(function (item) {
    const fresca = variantesFrescas[item.varianteId];
    return !fresca || fresca.stock_estado === "SIN STOCK";
  });

  if (itemsSinStock.length > 0) {
    itemsSinStock.forEach(function (item) {
      delete carrito[item.varianteId];
    });
    actualizarUiCarrito();
    renderResumenCarrito();

    const nombres = itemsSinStock
      .map(function (item) {
        return item.productoNombre + " (" + item.modelo + ")";
      })
      .join(", ");
    mostrarAvisoStock("Sin stock disponible para: " + nombres + ". Se quitaron de tu pedido, revisá el resumen.");
    return false;
  }

  return true;
}

function mostrarAvisoStock(mensaje) {
  let aviso = document.getElementById("stock-warning-box");
  if (!aviso) {
    aviso = document.createElement("div");
    aviso.id = "stock-warning-box";
    aviso.style.background = "#fee2e2";
    aviso.style.color = "#991b1b";
    aviso.style.border = "1px solid #fca5a5";
    aviso.style.borderRadius = "var(--radius-md)";
    aviso.style.padding = "0.85rem 1rem";
    aviso.style.fontSize = "0.85rem";
    aviso.style.marginBottom = "1rem";
    const checkoutForm = document.getElementById("checkout-form");
    checkoutForm.insertBefore(aviso, checkoutForm.firstChild);
  }
  aviso.textContent = mensaje;
  aviso.style.display = "block";
}

// ---------------------------------------------------------------------
// Modal de éxito: compartir / descargar
// ---------------------------------------------------------------------

async function compartirPedido(opciones) {
  const archivos = opciones.incluirExcel && ultimoExcelFile ? [ultimoPdfFile, ultimoExcelFile] : [ultimoPdfFile];

  const puedeCompartirArchivos =
    typeof navigator.canShare === "function" && navigator.canShare({ files: archivos });

  if (puedeCompartirArchivos) {
    try {
      await navigator.share({
        files: archivos,
        title: "Nota de Pedido - Panther Distribuciones",
        text: "Hola, te comparto mi pedido.",
      });
      return;
    } catch (error) {
      // El usuario cancela el cuadro de compartir: no es un error real.
      if (error && error.name === "AbortError") {
        return;
      }
    }
  }

  // Fallback: descargar los archivos y, si corresponde, abrir WhatsApp
  // del vendedor con el resumen en texto.
  archivos.forEach(descargarArchivo);

  if (opciones.abrirWhatsappVendedor && configuracionApp.whatsapp_vendedor) {
    const texto = encodeURIComponent(
      "Hola, te envío mi pedido de " +
        ultimoPedido.clienteNombre +
        " por un total de " +
        formatearMoneda(ultimoPedido.total) +
        ". Adjunto el comprobante descargado."
    );
    const urlWhatsapp = "https://wa.me/" + configuracionApp.whatsapp_vendedor + "?text=" + texto;

    // Se usa una navegación directa (location.href) en vez de
    // window.open: en mobile, abrir una ventana nueva después de un
    // "await" (como el intento de navigator.share de más arriba) suele
    // perder el permiso del navegador para cambiar de app, y termina
    // abriendo una pestaña en blanco en lugar de WhatsApp. Se espera
    // un instante para dar tiempo a que arranquen las descargas antes
    // de navegar.
    setTimeout(function () {
      window.location.href = urlWhatsapp;
    }, 400);
  }
}

function descargarArchivo(archivo) {
  const url = URL.createObjectURL(archivo);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = archivo.name;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

function reiniciarDespuesDePedido() {
  carrito = {};
  ultimoPedido = null;
  ultimoPdfFile = null;
  ultimoExcelFile = null;
  document.getElementById("checkout-form").reset();
  const aviso = document.getElementById("stock-warning-box");
  if (aviso) {
    aviso.style.display = "none";
  }
  actualizarUiCarrito();
  volverAlCatalogo();
}

// ---------------------------------------------------------------------
// Utilidades de modales (compartidas por variant-modal y success-modal)
// ---------------------------------------------------------------------

function mostrarModal(modal) {
  modal.classList.add("visible");
}

function ocultarModal(modal) {
  modal.classList.remove("visible");
}
