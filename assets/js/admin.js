// =====================================================================
// Lógica del panel de administración (admin.html): acceso por PIN,
// configuración general, actualización masiva de precios/stock desde
// Excel, gestor de productos/variantes/fotos, y listado de pedidos
// recibidos (con descarga de Excel por pedido, solo para el admin).
//
// Reglas de código del proyecto (AGENTS.md): sin innerHTML, sin
// alert/confirm/prompt (los borrados usan confirmación de doble click
// visual en vez de confirm()), preventDefault en todos los submits.
// =====================================================================

// ---------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------

let productosAdmin = []; // Catálogo completo (activos e inactivos) con variantes.
let productoSeleccionadoId = null;

// ---------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async function () {
  wireEventosEstaticos();

  // Si ya hay una sesión de admin activa en este navegador (persistida
  // por supabase-js), se salta la pantalla de PIN.
  const sesion = await obtenerSesionAdmin();
  if (sesion) {
    await mostrarPanelAdmin();
  }
});

function wireEventosEstaticos() {
  document.getElementById("pin-form").addEventListener("submit", manejarSubmitPin);
  document.getElementById("btn-change-pin").addEventListener("click", function () {
    mostrarModal(document.getElementById("modal-change-pin"));
  });
  document.getElementById("btn-close-change-pin").addEventListener("click", function () {
    ocultarModal(document.getElementById("modal-change-pin"));
  });
  document.getElementById("form-change-pin").addEventListener("submit", manejarSubmitCambiarPin);

  document.getElementById("form-config").addEventListener("submit", manejarSubmitConfig);

  const dropzone = document.getElementById("excel-dropzone");
  const inputExcel = document.getElementById("excel-file-input");
  dropzone.addEventListener("click", function () {
    inputExcel.click();
  });
  dropzone.addEventListener("dragover", function (evento) {
    evento.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", function () {
    dropzone.classList.remove("dragover");
  });
  dropzone.addEventListener("drop", function (evento) {
    evento.preventDefault();
    dropzone.classList.remove("dragover");
    if (evento.dataTransfer.files.length > 0) {
      procesarArchivoExcel(evento.dataTransfer.files[0]);
    }
  });
  inputExcel.addEventListener("change", function () {
    if (inputExcel.files.length > 0) {
      procesarArchivoExcel(inputExcel.files[0]);
    }
  });

  document.getElementById("search-product").addEventListener("input", function (evento) {
    renderListaProductos(evento.target.value);
  });

  document.getElementById("btn-open-create-product").addEventListener("click", function () {
    mostrarModal(document.getElementById("modal-create-product"));
  });
  document.getElementById("btn-close-create-product").addEventListener("click", function () {
    ocultarModal(document.getElementById("modal-create-product"));
  });
  document.getElementById("form-create-product").addEventListener("submit", manejarSubmitCrearProducto);

  document.getElementById("btn-open-add-variant").addEventListener("click", function () {
    mostrarModal(document.getElementById("modal-add-variant"));
  });
  document.getElementById("btn-close-add-variant").addEventListener("click", function () {
    ocultarModal(document.getElementById("modal-add-variant"));
  });
  document.getElementById("form-add-variant").addEventListener("submit", manejarSubmitAgregarVariante);

  document.getElementById("btn-trigger-photo-upload").addEventListener("click", function () {
    document.getElementById("photo-file-input").click();
  });
  document.getElementById("photo-file-input").addEventListener("change", manejarCambioFoto);

  document.getElementById("btn-delete-product").addEventListener("click", manejarClickEliminarProducto);
}

// ---------------------------------------------------------------------
// Acceso por PIN
// ---------------------------------------------------------------------

async function manejarSubmitPin(evento) {
  evento.preventDefault();

  const pin = document.getElementById("input-pin").value;
  const resultado = await iniciarSesionAdmin(pin);

  if (!resultado.ok) {
    document.getElementById("pin-error-msg").style.display = "block";
    return;
  }

  document.getElementById("pin-error-msg").style.display = "none";
  await mostrarPanelAdmin();
}

async function mostrarPanelAdmin() {
  document.getElementById("lock-screen").style.display = "none";
  document.getElementById("admin-main-content").style.display = "block";
  await cargarDatosAdmin();
}

async function manejarSubmitCambiarPin(evento) {
  evento.preventDefault();

  const pinActual = document.getElementById("current-pin").value;
  const pinNuevo = document.getElementById("new-pin").value;
  const mensajeError = document.getElementById("change-pin-error-msg");

  const resultado = await cambiarPinAdmin(pinActual, pinNuevo);

  if (!resultado.ok) {
    mensajeError.textContent = resultado.error;
    mensajeError.style.display = "block";
    return;
  }

  mensajeError.style.display = "none";
  document.getElementById("form-change-pin").reset();
  ocultarModal(document.getElementById("modal-change-pin"));
  mostrarToast("PIN actualizado correctamente.", "success");
}

// ---------------------------------------------------------------------
// Carga inicial de datos del panel
// ---------------------------------------------------------------------

async function cargarDatosAdmin() {
  try {
    const [config, catalogo, pedidos] = await Promise.all([
      obtenerConfig(),
      obtenerCatalogoCompleto(),
      obtenerPedidos(),
    ]);
    document.getElementById("config-whatsapp").value = config.whatsapp_vendedor || "";
    productosAdmin = catalogo;
    renderListaProductos("");
    renderTablaPedidos(pedidos);
  } catch (error) {
    mostrarToast("No se pudieron cargar los datos del panel.", "error");
  }
}

// ---------------------------------------------------------------------
// Configuración general
// ---------------------------------------------------------------------

async function manejarSubmitConfig(evento) {
  evento.preventDefault();

  const numero = document.getElementById("config-whatsapp").value.trim();
  try {
    await actualizarConfig({ whatsapp_vendedor: numero });
    mostrarToast("Configuración guardada.", "success");
  } catch (error) {
    mostrarToast("No se pudo guardar la configuración.", "error");
  }
}

// ---------------------------------------------------------------------
// Sección 1: Excel de precios y stock
// ---------------------------------------------------------------------

function procesarArchivoExcel(archivo) {
  const lector = new FileReader();
  lector.onload = async function (evento) {
    try {
      const datos = new Uint8Array(evento.target.result);
      const libro = XLSX.read(datos, { type: "array" });
      const primeraHoja = libro.Sheets[libro.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(primeraHoja, { defval: null });

      const filasNormalizadas = filas
        .map(normalizarFilaExcelPrecios)
        .filter(function (fila) {
          return fila && fila.sku;
        });

      if (filasNormalizadas.length === 0) {
        mostrarToast("El archivo no tiene filas válidas con columna Codigo.", "error");
        return;
      }

      const actualizadas = await actualizarPreciosStockMasivo(filasNormalizadas);
      mostrarToast(actualizadas + " variantes actualizadas correctamente.", "success");

      productosAdmin = await obtenerCatalogoCompleto();
      renderListaProductos(document.getElementById("search-product").value);
      if (productoSeleccionadoId) {
        renderDetalleProducto(productoSeleccionadoId);
      }
    } catch (error) {
      mostrarToast("No se pudo procesar el archivo. Verificá el formato.", "error");
    }
  };
  lector.readAsArrayBuffer(archivo);
}

// Busca, sin importar mayúsculas, las columnas Codigo/SKU/Precio/Stock
// dentro de una fila del Excel y devuelve { sku, precio, stock_cantidad }.
// Acepta tanto "Codigo" (planilla de migración inicial) como "SKU"
// (planilla que exporta el sistema de ventas), para no depender de un
// único nombre de columna.
function normalizarFilaExcelPrecios(fila) {
  const claves = Object.keys(fila);

  const claveCodigo = claves.find(function (k) {
    return /codigo|sku/i.test(k);
  });
  const clavePrecio = claves.find(function (k) {
    return /precio/i.test(k);
  });
  const claveStock = claves.find(function (k) {
    return /stock/i.test(k);
  });

  if (!claveCodigo || fila[claveCodigo] === null) {
    return null;
  }

  return {
    sku: String(fila[claveCodigo]).trim(),
    precio: clavePrecio ? Number(fila[clavePrecio]) : null,
    stock_cantidad: claveStock ? Number(fila[claveStock]) : null,
  };
}

// ---------------------------------------------------------------------
// Sección 3: Pedidos recibidos
// ---------------------------------------------------------------------

function renderTablaPedidos(pedidos) {
  const cuerpo = document.getElementById("orders-table-body");
  while (cuerpo.firstChild) {
    cuerpo.removeChild(cuerpo.firstChild);
  }

  pedidos.forEach(function (pedido) {
    cuerpo.appendChild(crearFilaPedido(pedido));
  });
}

function crearFilaPedido(pedido) {
  const fila = document.createElement("tr");

  const celdaFecha = document.createElement("td");
  celdaFecha.textContent = new Date(pedido.created_at).toLocaleString("es-AR");
  fila.appendChild(celdaFecha);

  const celdaCliente = document.createElement("td");
  celdaCliente.textContent = pedido.cliente_nombre;
  fila.appendChild(celdaCliente);

  const celdaTelefono = document.createElement("td");
  celdaTelefono.textContent = pedido.cliente_telefono;
  fila.appendChild(celdaTelefono);

  const celdaArticulos = document.createElement("td");
  celdaArticulos.textContent = String(pedido.cantidad_articulos);
  fila.appendChild(celdaArticulos);

  const celdaTotal = document.createElement("td");
  celdaTotal.textContent = formatearMoneda(pedido.total);
  fila.appendChild(celdaTotal);

  const celdaAcciones = document.createElement("td");
  celdaAcciones.style.display = "flex";
  celdaAcciones.style.gap = "0.5rem";

  const btnExcel = document.createElement("button");
  btnExcel.type = "button";
  btnExcel.className = "btn-secondary";
  btnExcel.style.width = "auto";
  btnExcel.style.padding = "0.35rem 0.75rem";
  btnExcel.style.fontSize = "0.8rem";
  btnExcel.textContent = "⬇️ Excel";
  btnExcel.addEventListener("click", function () {
    descargarExcelPedido(pedido);
  });
  celdaAcciones.appendChild(btnExcel);

  const enlaceVer = document.createElement("a");
  enlaceVer.href = "pedido.html?id=" + pedido.id;
  enlaceVer.target = "_blank";
  enlaceVer.rel = "noopener";
  enlaceVer.className = "btn-secondary";
  enlaceVer.style.width = "auto";
  enlaceVer.style.padding = "0.35rem 0.75rem";
  enlaceVer.style.fontSize = "0.8rem";
  enlaceVer.style.textDecoration = "none";
  enlaceVer.textContent = "👁️ Ver";
  celdaAcciones.appendChild(enlaceVer);

  fila.appendChild(celdaAcciones);

  return fila;
}

// Genera (con excel-generator.js) y descarga el Excel de un pedido
// puntual, solo en el navegador del admin: al cliente nunca se le
// descarga nada.
function descargarExcelPedido(pedido) {
  const archivo = generarExcelPedido({
    id: pedido.id,
    fecha: pedido.created_at,
    clienteNombre: pedido.cliente_nombre,
    clienteTelefono: pedido.cliente_telefono,
    cantidadArticulos: pedido.cantidad_articulos,
    total: pedido.total,
    items: pedido.items,
  });

  const url = URL.createObjectURL(archivo);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = archivo.name;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------
// Sección 2: Gestor de productos, variantes y fotos
// ---------------------------------------------------------------------

function renderListaProductos(filtroTexto) {
  const sidebar = document.getElementById("product-list-sidebar");
  while (sidebar.firstChild) {
    sidebar.removeChild(sidebar.firstChild);
  }

  const filtro = (filtroTexto || "").toLowerCase();
  const productosFiltrados = productosAdmin.filter(function (producto) {
    return producto.nombre.toLowerCase().includes(filtro);
  });

  productosFiltrados.forEach(function (producto) {
    sidebar.appendChild(crearItemListaProducto(producto));
  });
}

function crearItemListaProducto(producto) {
  const item = document.createElement("div");
  item.className = "product-list-item" + (producto.id === productoSeleccionadoId ? " selected" : "");

  const img = document.createElement("img");
  img.src = producto.imagen_url || "assets/img/placeholder-producto.svg";
  img.alt = producto.nombre;
  item.appendChild(img);

  const nombre = document.createElement("span");
  nombre.textContent = producto.nombre;
  item.appendChild(nombre);

  item.addEventListener("click", function () {
    productoSeleccionadoId = producto.id;
    renderListaProductos(document.getElementById("search-product").value);
    renderDetalleProducto(producto.id);
  });

  return item;
}

function renderDetalleProducto(productoId) {
  const producto = productosAdmin.find(function (p) {
    return p.id === productoId;
  });
  if (!producto) return;

  document.getElementById("product-detail-box").style.display = "block";
  document.getElementById("selected-product-title").textContent = producto.nombre;
  document.getElementById("selected-product-img").src =
    producto.imagen_url || "assets/img/placeholder-producto.svg";

  const cuerpoTabla = document.getElementById("variants-table-body");
  while (cuerpoTabla.firstChild) {
    cuerpoTabla.removeChild(cuerpoTabla.firstChild);
  }

  producto.variantes.forEach(function (variante) {
    cuerpoTabla.appendChild(crearFilaTablaVariante(variante));
  });
}

function crearFilaTablaVariante(variante) {
  const fila = document.createElement("tr");

  const celdaSku = document.createElement("td");
  celdaSku.textContent = variante.sku;
  fila.appendChild(celdaSku);

  const celdaModelo = document.createElement("td");
  celdaModelo.textContent = variante.modelo;
  fila.appendChild(celdaModelo);

  const celdaPrecio = document.createElement("td");
  celdaPrecio.textContent = formatearMoneda(variante.precio_actual);
  fila.appendChild(celdaPrecio);

  const celdaStock = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = "rule-pill stock-badge " + claseCssStock(variante.stock_estado);
  badge.textContent = variante.stock_estado;
  celdaStock.appendChild(badge);
  fila.appendChild(celdaStock);

  const celdaAccion = document.createElement("td");
  const btnEliminar = document.createElement("button");
  btnEliminar.type = "button";
  btnEliminar.className = "btn-delete-var";
  btnEliminar.textContent = "🗑️";
  btnEliminar.addEventListener("click", function () {
    confirmarAccionDoble(btnEliminar, "¿Confirmar?", async function () {
      try {
        await eliminarVariante(variante.id);
        productosAdmin = await obtenerCatalogoCompleto();
        renderDetalleProducto(productoSeleccionadoId);
        mostrarToast("Variante eliminada.", "success");
      } catch (error) {
        mostrarToast("No se pudo eliminar la variante.", "error");
      }
    });
  });
  celdaAccion.appendChild(btnEliminar);
  fila.appendChild(celdaAccion);

  return fila;
}

// Confirmación de doble click (reemplaza a confirm(), prohibido por
// las reglas de código del proyecto): el primer click cambia el texto
// del botón a "textoConfirmar" por 3 segundos; si se vuelve a hacer
// click en ese lapso, se ejecuta la acción.
function confirmarAccionDoble(boton, textoConfirmar, accion) {
  if (boton.dataset.confirmando === "true") {
    boton.dataset.confirmando = "false";
    clearTimeout(Number(boton.dataset.timeoutId));
    boton.textContent = boton.dataset.textoOriginal;
    accion();
    return;
  }

  boton.dataset.confirmando = "true";
  boton.dataset.textoOriginal = boton.textContent;
  boton.textContent = textoConfirmar;

  const timeoutId = setTimeout(function () {
    boton.dataset.confirmando = "false";
    boton.textContent = boton.dataset.textoOriginal;
  }, 3000);
  boton.dataset.timeoutId = String(timeoutId);
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

async function manejarClickEliminarProducto() {
  const boton = document.getElementById("btn-delete-product");
  confirmarAccionDoble(boton, "🗑️ ¿Confirmar borrado?", async function () {
    try {
      await eliminarProducto(productoSeleccionadoId);
      productoSeleccionadoId = null;
      document.getElementById("product-detail-box").style.display = "none";
      productosAdmin = await obtenerCatalogoCompleto();
      renderListaProductos(document.getElementById("search-product").value);
      mostrarToast("Producto eliminado.", "success");
    } catch (error) {
      mostrarToast("No se pudo eliminar el producto.", "error");
    }
  });
}

// Parsea el textarea "SKU | Descripción" (una variante por línea).
function parsearListaVariantes(texto) {
  return texto
    .split("\n")
    .map(function (linea) {
      return linea.trim();
    })
    .filter(function (linea) {
      return linea.length > 0;
    })
    .map(function (linea) {
      const partes = linea.split("|");
      return {
        sku: (partes[0] || "").trim(),
        modelo: (partes[1] || "").trim(),
      };
    })
    .filter(function (variante) {
      return variante.sku && variante.modelo;
    });
}

async function manejarSubmitCrearProducto(evento) {
  evento.preventDefault();

  const nombre = document.getElementById("new-product-name").value.trim();
  const archivoFoto = document.getElementById("new-product-photo").files[0];
  const textoVariantes = document.getElementById("new-product-variants-text").value;
  const variantes = parsearListaVariantes(textoVariantes);

  try {
    const producto = await crearProducto(nombre, null);

    if (archivoFoto) {
      const url = await subirFotoProducto(producto.id, archivoFoto);
      await actualizarProducto(producto.id, { imagen_url: url });
    }

    if (variantes.length > 0) {
      await agregarVariantes(producto.id, variantes);
    }

    document.getElementById("form-create-product").reset();
    ocultarModal(document.getElementById("modal-create-product"));

    productosAdmin = await obtenerCatalogoCompleto();
    renderListaProductos(document.getElementById("search-product").value);
    productoSeleccionadoId = producto.id;
    renderDetalleProducto(producto.id);

    mostrarToast("Producto creado correctamente.", "success");
  } catch (error) {
    mostrarToast("No se pudo crear el producto.", "error");
  }
}

async function manejarSubmitAgregarVariante(evento) {
  evento.preventDefault();

  const texto = document.getElementById("add-variants-text").value;
  const variantes = parsearListaVariantes(texto);

  if (variantes.length === 0 || !productoSeleccionadoId) {
    return;
  }

  try {
    await agregarVariantes(productoSeleccionadoId, variantes);
    document.getElementById("form-add-variant").reset();
    ocultarModal(document.getElementById("modal-add-variant"));

    productosAdmin = await obtenerCatalogoCompleto();
    renderDetalleProducto(productoSeleccionadoId);
    mostrarToast("Variantes agregadas correctamente.", "success");
  } catch (error) {
    mostrarToast("No se pudieron agregar las variantes (¿SKU repetido?).", "error");
  }
}

async function manejarCambioFoto(evento) {
  const archivo = evento.target.files[0];
  if (!archivo || !productoSeleccionadoId) {
    return;
  }

  try {
    const url = await subirFotoProducto(productoSeleccionadoId, archivo);
    await actualizarProducto(productoSeleccionadoId, { imagen_url: url });

    productosAdmin = await obtenerCatalogoCompleto();
    renderDetalleProducto(productoSeleccionadoId);
    renderListaProductos(document.getElementById("search-product").value);
    mostrarToast("Foto actualizada.", "success");
  } catch (error) {
    mostrarToast("No se pudo subir la foto.", "error");
  }
}

// ---------------------------------------------------------------------
// Utilidades de UI
// ---------------------------------------------------------------------

function mostrarToast(mensaje, tipo) {
  const toast = document.getElementById("status-toast");
  toast.textContent = mensaje;
  toast.className = "status-toast " + tipo;
  setTimeout(function () {
    toast.className = "status-toast";
  }, 4000);
}

function mostrarModal(modal) {
  modal.classList.add("visible");
}

function ocultarModal(modal) {
  modal.classList.remove("visible");
}

function formatearMoneda(numero) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(numero));
}
