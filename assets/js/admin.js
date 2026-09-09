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
let vendedoresAdmin = []; // Para el desplegable de "Vendedor/a" en Pedidos y la pestaña de Vendedores.
let pedidosAdmin = []; // Cache local para no repedir a Supabase en cada acción de la tabla/reporte.

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

  document.getElementById("btn-open-config").addEventListener("click", function () {
    mostrarModal(document.getElementById("modal-config"));
  });
  document.getElementById("btn-close-config").addEventListener("click", function () {
    ocultarModal(document.getElementById("modal-config"));
  });
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
  document.getElementById("checkbox-en-promo").addEventListener("change", manejarCambioEnPromo);
  document.getElementById("checkbox-es-nuevo").addEventListener("change", manejarCambioEsNuevo);
  document.getElementById("btn-aplicar-tachado-todas").addEventListener("click", manejarClickAplicarTachadoTodas);

  document.getElementById("form-add-vendedor").addEventListener("submit", manejarSubmitAgregarVendedor);

  configurarTabsAdmin();
}

// Las 3 pantallas del panel (Stock, Pedidos, Vendedores) son secciones
// que se muestran/ocultan con una clase, igual que catálogo/checkout en
// index.html; no hay routing real porque es un solo archivo.
function configurarTabsAdmin() {
  const botones = document.querySelectorAll(".admin-tab-btn");
  botones.forEach(function (boton) {
    boton.addEventListener("click", function () {
      botones.forEach(function (b) {
        b.classList.remove("active");
      });
      boton.classList.add("active");

      document.querySelectorAll(".admin-tab-panel").forEach(function (panel) {
        panel.classList.toggle("active", panel.id === boton.dataset.tab);
      });
    });
  });
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
    const [config, catalogo, pedidos, vendedores] = await Promise.all([
      obtenerConfig(),
      obtenerCatalogoCompleto(),
      obtenerPedidos(),
      obtenerVendedores(),
    ]);
    document.getElementById("config-whatsapp").value = config.whatsapp_vendedor || "";
    productosAdmin = catalogo;
    vendedoresAdmin = vendedores;
    pedidosAdmin = pedidos;
    renderListaProductos("");
    renderTablaPedidos(pedidosAdmin);
    renderReporteVendedores(pedidosAdmin);
    renderVendedoresAgrupados();
  } catch (error) {
    mostrarToast("No se pudieron cargar los datos del panel.", "error");
  }
}

// Vuelve a pedir los pedidos a Supabase y refresca tanto la tabla como
// el reporte por vendedor/a, para que ambos siempre reflejen el mismo
// estado (evita que uno quede desactualizado tras una acción puntual).
async function refrescarPedidos() {
  pedidosAdmin = await obtenerPedidos();
  renderTablaPedidos(pedidosAdmin);
  renderReporteVendedores(pedidosAdmin);
}

// ---------------------------------------------------------------------
// Configuración general
// ---------------------------------------------------------------------

async function manejarSubmitConfig(evento) {
  evento.preventDefault();

  const numero = document.getElementById("config-whatsapp").value.trim();
  try {
    await actualizarConfig({ whatsapp_vendedor: numero });
    ocultarModal(document.getElementById("modal-config"));
    mostrarToast("Configuración guardada.", "success");
  } catch (error) {
    mostrarToast("No se pudo guardar la configuración.", "error");
  }
}

// ---------------------------------------------------------------------
// Sección 1: Excel de precios y stock
// ---------------------------------------------------------------------

// Con las planillas de 10 mil+ filas que sube esta empresa mayorista,
// leer y procesar el archivo puede tardar varios segundos: sin ningún
// aviso en pantalla, parecía que la página no hacía nada (o que se
// había colgado). Por eso cada paso (leer, parsear, guardar en la
// base) actualiza un cartel de estado, y se bloquea el dropzone
// mientras tanto para no permitir una segunda subida en simultáneo.
let subiendoExcel = false;

function procesarArchivoExcel(archivo) {
  if (subiendoExcel) {
    return;
  }
  subiendoExcel = true;

  const dropzone = document.getElementById("excel-dropzone");
  dropzone.classList.add("dropzone-procesando");
  mostrarEstadoExcel("📥 Leyendo " + archivo.name + "...");

  const lector = new FileReader();

  lector.onload = async function (evento) {
    try {
      mostrarEstadoExcel("🔎 Interpretando las filas del archivo...");
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
        mostrarEstadoExcel(null);
        mostrarToast("El archivo no tiene filas válidas con columna Codigo.", "error");
        return;
      }

      mostrarEstadoExcel(
        "🔄 Actualizando " + filasNormalizadas.length + " variantes en la base de datos... esto puede tardar unos segundos, no cierres esta pestaña."
      );
      const actualizadas = await actualizarPreciosStockMasivo(filasNormalizadas);
      mostrarEstadoExcel("✅ Listo: " + actualizadas + " variantes actualizadas.");
      mostrarToast(actualizadas + " variantes actualizadas correctamente.", "success");
      window.setTimeout(function () {
        mostrarEstadoExcel(null);
      }, 5000);

      productosAdmin = await obtenerCatalogoCompleto();
      renderListaProductos(document.getElementById("search-product").value);
      if (productoSeleccionadoId) {
        renderDetalleProducto(productoSeleccionadoId);
      }
    } catch (error) {
      mostrarEstadoExcel(null);
      mostrarToast("No se pudo procesar el archivo. Verificá el formato.", "error");
    } finally {
      subiendoExcel = false;
      dropzone.classList.remove("dropzone-procesando");
      document.getElementById("excel-file-input").value = "";
    }
  };

  lector.onerror = function () {
    mostrarEstadoExcel(null);
    mostrarToast("No se pudo leer el archivo.", "error");
    subiendoExcel = false;
    dropzone.classList.remove("dropzone-procesando");
  };

  lector.readAsArrayBuffer(archivo);
}

function mostrarEstadoExcel(texto) {
  const nota = document.getElementById("excel-upload-status");
  if (!nota) {
    return;
  }
  if (!texto) {
    nota.style.display = "none";
    nota.textContent = "";
    return;
  }
  nota.textContent = texto;
  nota.style.display = "block";
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
  fila.appendChild(celdaCliente);

  const celdaTelefono = document.createElement("td");
  fila.appendChild(celdaTelefono);

  const celdaArticulos = document.createElement("td");
  celdaArticulos.textContent = String(pedido.cantidad_articulos);
  fila.appendChild(celdaArticulos);

  const celdaTotal = document.createElement("td");
  celdaTotal.textContent = formatearMoneda(pedido.total);
  fila.appendChild(celdaTotal);

  const celdaEstado = document.createElement("td");
  fila.appendChild(celdaEstado);

  const celdaVendedor = document.createElement("td");
  fila.appendChild(celdaVendedor);

  const celdaAcciones = document.createElement("td");
  celdaAcciones.style.display = "flex";
  celdaAcciones.style.flexWrap = "wrap";
  celdaAcciones.style.gap = "0.5rem";
  fila.appendChild(celdaAcciones);

  renderFilaPedidoVista(pedido, celdaCliente, celdaTelefono, celdaEstado, celdaVendedor, celdaAcciones);

  return fila;
}

const ETIQUETAS_ESTADO_PEDIDO = { nuevo: "🆕 Nuevo", asignado: "✅ Asignado", completado: "💰 Completado" };

// Vista normal de una fila de pedido: texto de cliente/teléfono, badge
// de estado, desplegable de vendedor/a y los botones de acción. Se
// separa de crearFilaPedido para poder volver a esta vista después de
// cancelar una edición, sin tener que reconstruir toda la fila.
function renderFilaPedidoVista(pedido, celdaCliente, celdaTelefono, celdaEstado, celdaVendedor, celdaAcciones) {
  celdaCliente.textContent = pedido.cliente_nombre;
  celdaTelefono.textContent = pedido.cliente_telefono;

  while (celdaEstado.firstChild) {
    celdaEstado.removeChild(celdaEstado.firstChild);
  }
  const badgeEstado = document.createElement("span");
  badgeEstado.className = "pedido-badge " + pedido.estado;
  badgeEstado.textContent = ETIQUETAS_ESTADO_PEDIDO[pedido.estado] || pedido.estado;
  celdaEstado.appendChild(badgeEstado);

  while (celdaVendedor.firstChild) {
    celdaVendedor.removeChild(celdaVendedor.firstChild);
  }
  const selectVendedor = document.createElement("select");
  selectVendedor.className = "form-input";
  selectVendedor.style.width = "auto";
  selectVendedor.style.padding = "0.35rem 0.5rem";
  selectVendedor.style.fontSize = "0.8rem";
  // Una vez completado (cobrado/entregado) no tiene sentido reasignarlo.
  selectVendedor.disabled = pedido.estado === "completado";

  const opcionVacia = document.createElement("option");
  opcionVacia.value = "";
  opcionVacia.textContent = "— Sin asignar —";
  selectVendedor.appendChild(opcionVacia);

  vendedoresAdmin.forEach(function (vendedor) {
    const opcion = document.createElement("option");
    opcion.value = vendedor.id;
    opcion.textContent = vendedor.nombre_completo + " (" + vendedor.provincia + ")";
    if (pedido.vendedor_id === vendedor.id) {
      opcion.selected = true;
    }
    selectVendedor.appendChild(opcion);
  });

  selectVendedor.addEventListener("change", function () {
    guardarVendedorPedido(pedido.id, selectVendedor.value || null);
  });
  celdaVendedor.appendChild(selectVendedor);

  while (celdaAcciones.firstChild) {
    celdaAcciones.removeChild(celdaAcciones.firstChild);
  }

  const btnExcel = document.createElement("button");
  btnExcel.type = "button";
  btnExcel.className = "btn-secondary";
  btnExcel.style.width = "auto";
  btnExcel.style.padding = "0.35rem 0.75rem";
  btnExcel.style.fontSize = "0.8rem";
  btnExcel.textContent = "⬇️ Excel";
  btnExcel.addEventListener("click", function () {
    descargarExcelPedido(pedido);
    marcarPedidoAsignado(pedido);
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

  if (pedido.estado === "asignado") {
    const btnCompletar = document.createElement("button");
    btnCompletar.type = "button";
    btnCompletar.className = "btn-secondary";
    btnCompletar.style.width = "auto";
    btnCompletar.style.padding = "0.35rem 0.75rem";
    btnCompletar.style.fontSize = "0.8rem";
    btnCompletar.textContent = "💰 Completar";
    btnCompletar.addEventListener("click", function () {
      cambiarEstadoPedido(pedido.id, "completado");
    });
    celdaAcciones.appendChild(btnCompletar);
  } else if (pedido.estado === "completado") {
    const btnReabrir = document.createElement("button");
    btnReabrir.type = "button";
    btnReabrir.className = "btn-secondary";
    btnReabrir.style.width = "auto";
    btnReabrir.style.padding = "0.35rem 0.75rem";
    btnReabrir.style.fontSize = "0.8rem";
    btnReabrir.textContent = "↩️ Reabrir";
    btnReabrir.addEventListener("click", function () {
      cambiarEstadoPedido(pedido.id, "asignado");
    });
    celdaAcciones.appendChild(btnReabrir);
  }

  const btnEditar = document.createElement("button");
  btnEditar.type = "button";
  btnEditar.className = "btn-secondary";
  btnEditar.style.width = "auto";
  btnEditar.style.padding = "0.35rem 0.75rem";
  btnEditar.style.fontSize = "0.8rem";
  btnEditar.textContent = "✏️ Editar";
  btnEditar.addEventListener("click", function () {
    renderFilaPedidoEdicion(pedido, celdaCliente, celdaTelefono, celdaEstado, celdaVendedor, celdaAcciones);
  });
  celdaAcciones.appendChild(btnEditar);

  const btnEliminar = document.createElement("button");
  btnEliminar.type = "button";
  btnEliminar.className = "btn-delete-var";
  btnEliminar.textContent = "🗑️";
  btnEliminar.addEventListener("click", function () {
    confirmarAccionDoble(btnEliminar, "¿Confirmar?", async function () {
      try {
        await eliminarPedido(pedido.id);
        await refrescarPedidos();
        mostrarToast("Pedido eliminado.", "success");
      } catch (error) {
        mostrarToast("No se pudo eliminar el pedido.", "error");
      }
    });
  });
  celdaAcciones.appendChild(btnEliminar);
}

// Vista de edición: nombre y teléfono del cliente pasan a inputs, y los
// botones de acción se reemplazan por Guardar/Cancelar. El resto de la
// fila (fecha, artículos, total, estado, vendedor/a) no se toca.
function renderFilaPedidoEdicion(pedido, celdaCliente, celdaTelefono, celdaEstado, celdaVendedor, celdaAcciones) {
  while (celdaCliente.firstChild) {
    celdaCliente.removeChild(celdaCliente.firstChild);
  }
  const inputNombre = document.createElement("input");
  inputNombre.type = "text";
  inputNombre.className = "form-input";
  inputNombre.style.padding = "0.35rem 0.5rem";
  inputNombre.style.fontSize = "0.85rem";
  inputNombre.value = pedido.cliente_nombre;
  celdaCliente.appendChild(inputNombre);

  while (celdaTelefono.firstChild) {
    celdaTelefono.removeChild(celdaTelefono.firstChild);
  }
  const inputTelefono = document.createElement("input");
  inputTelefono.type = "tel";
  inputTelefono.className = "form-input";
  inputTelefono.style.padding = "0.35rem 0.5rem";
  inputTelefono.style.fontSize = "0.85rem";
  inputTelefono.value = pedido.cliente_telefono;
  celdaTelefono.appendChild(inputTelefono);

  const errorTelefono = document.createElement("p");
  errorTelefono.className = "form-error";
  errorTelefono.textContent = "Teléfono inválido (8 a 13 dígitos).";
  errorTelefono.hidden = true;
  celdaTelefono.appendChild(errorTelefono);

  while (celdaAcciones.firstChild) {
    celdaAcciones.removeChild(celdaAcciones.firstChild);
  }

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn-primary";
  btnGuardar.style.width = "auto";
  btnGuardar.style.padding = "0.35rem 0.75rem";
  btnGuardar.style.fontSize = "0.8rem";
  btnGuardar.textContent = "💾 Guardar";
  btnGuardar.addEventListener("click", async function () {
    const nombre = inputNombre.value.trim();
    const telefono = inputTelefono.value.trim();

    if (!telefonoEsValidoAdmin(telefono)) {
      errorTelefono.hidden = false;
      return;
    }
    errorTelefono.hidden = true;

    try {
      await actualizarPedido(pedido.id, { cliente_nombre: nombre, cliente_telefono: telefono });
      await refrescarPedidos();
      mostrarToast("Pedido actualizado.", "success");
    } catch (error) {
      mostrarToast("No se pudo actualizar el pedido.", "error");
    }
  });
  celdaAcciones.appendChild(btnGuardar);

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn-secondary";
  btnCancelar.style.width = "auto";
  btnCancelar.style.padding = "0.35rem 0.75rem";
  btnCancelar.style.fontSize = "0.8rem";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", function () {
    renderFilaPedidoVista(pedido, celdaCliente, celdaTelefono, celdaEstado, celdaVendedor, celdaAcciones);
  });
  celdaAcciones.appendChild(btnCancelar);
}

// Igual que telefonoEsValido de app.js (no se comparte módulo entre
// index.html y admin.html): solo valida cantidad de dígitos razonable
// para un teléfono argentino, sin exigir un formato exacto.
function telefonoEsValidoAdmin(texto) {
  const soloDigitos = (texto || "").replace(/\D/g, "");
  return soloDigitos.length >= 8 && soloDigitos.length <= 13;
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

// Descargar el Excel es la acción que marca al pedido como "en curso":
// pasa de "nuevo" a "asignado". No hace nada si ya estaba asignado o
// completado (evita retroceder un pedido ya procesado).
async function marcarPedidoAsignado(pedido) {
  if (pedido.estado !== "nuevo") return;

  try {
    await actualizarPedido(pedido.id, { estado: "asignado" });
    await refrescarPedidos();
    mostrarToast("Pedido marcado como asignado. Elegí la vendedora en el desplegable.", "success");
  } catch (error) {
    mostrarToast("No se pudo marcar el pedido como asignado.", "error");
  }
}

// Botón "💰 Completar" / "↩️ Reabrir" de la tabla de pedidos.
async function cambiarEstadoPedido(pedidoId, nuevoEstado) {
  try {
    await actualizarPedido(pedidoId, { estado: nuevoEstado });
    await refrescarPedidos();
    mostrarToast(
      nuevoEstado === "completado" ? "Pedido marcado como completado." : "Pedido reabierto como asignado.",
      "success"
    );
  } catch (error) {
    mostrarToast("No se pudo actualizar el estado del pedido.", "error");
  }
}

async function guardarVendedorPedido(pedidoId, vendedorId) {
  try {
    await actualizarPedido(pedidoId, { vendedor_id: vendedorId });
    await refrescarPedidos();
    mostrarToast("Vendedora asignada al pedido.", "success");
  } catch (error) {
    mostrarToast("No se pudo asignar la vendedora.", "error");
  }
}

// ---------------------------------------------------------------------
// Reporte por vendedor/a: qué pedidos tiene cada uno y cuáles quedaron
// pendientes de cobro/entrega (no completados), para no perderles el
// rastro cuando quedan "colgados" en Asignado.
// ---------------------------------------------------------------------

function renderReporteVendedores(pedidos) {
  const contenedor = document.getElementById("reporte-vendedores");
  while (contenedor.firstChild) {
    contenedor.removeChild(contenedor.firstChild);
  }

  const conVendedor = pedidos.filter(function (p) {
    return p.vendedor_id;
  });

  if (conVendedor.length === 0) {
    const vacio = document.createElement("p");
    vacio.style.color = "var(--color-text-light)";
    vacio.style.fontSize = "0.9rem";
    vacio.textContent = "Todavía no hay pedidos asignados a ningún vendedor/a.";
    contenedor.appendChild(vacio);
    return;
  }

  const porVendedor = {};
  conVendedor.forEach(function (pedido) {
    if (!porVendedor[pedido.vendedor_id]) {
      porVendedor[pedido.vendedor_id] = [];
    }
    porVendedor[pedido.vendedor_id].push(pedido);
  });

  Object.keys(porVendedor).forEach(function (vendedorId) {
    contenedor.appendChild(crearGrupoReporteVendedor(vendedorId, porVendedor[vendedorId]));
  });
}

function crearGrupoReporteVendedor(vendedorId, pedidosVendedor) {
  const vendedor = vendedoresAdmin.find(function (v) {
    return v.id === vendedorId;
  });
  const nombreVendedor = vendedor ? vendedor.nombre_completo + " (" + vendedor.provincia + ")" : "Vendedor/a eliminado/a";
  const pendientes = pedidosVendedor.filter(function (p) {
    return p.estado !== "completado";
  });
  const completados = pedidosVendedor.length - pendientes.length;

  const grupo = document.createElement("div");
  grupo.className = "reporte-vendedor-group";

  const header = document.createElement("div");
  header.className = "reporte-vendedor-header";

  const nombre = document.createElement("span");
  nombre.className = "reporte-vendedor-nombre";
  nombre.textContent = nombreVendedor;
  header.appendChild(nombre);

  const conteo = document.createElement("span");
  conteo.className = "reporte-vendedor-conteo";
  conteo.textContent =
    pedidosVendedor.length + " asignados · " + completados + " completados · " + pendientes.length + " pendientes";
  header.appendChild(conteo);

  grupo.appendChild(header);

  if (pendientes.length === 0) {
    const ok = document.createElement("p");
    ok.style.margin = "0";
    ok.style.fontSize = "0.82rem";
    ok.style.color = "var(--color-text-light)";
    ok.textContent = "✅ Sin pedidos pendientes de cobro/entrega.";
    grupo.appendChild(ok);
  } else {
    pendientes.forEach(function (pedido) {
      grupo.appendChild(crearFilaReportePendiente(pedido));
    });
  }

  return grupo;
}

function crearFilaReportePendiente(pedido) {
  const fila = document.createElement("div");
  fila.className = "reporte-pedido-pendiente";

  const info = document.createElement("span");
  info.textContent =
    pedido.cliente_nombre + " — " + formatearMoneda(pedido.total) + " (" + (ETIQUETAS_ESTADO_PEDIDO[pedido.estado] || pedido.estado) + ")";
  fila.appendChild(info);

  const fecha = document.createElement("span");
  fecha.style.color = "var(--color-text-light)";
  fecha.textContent = new Date(pedido.created_at).toLocaleDateString("es-AR");
  fila.appendChild(fecha);

  return fila;
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
  nombre.textContent = (producto.en_promo ? "🔥 " : "") + (producto.es_nuevo ? "🆕 " : "") + producto.nombre;
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
  document.getElementById("checkbox-en-promo").checked = Boolean(producto.en_promo);
  document.getElementById("checkbox-es-nuevo").checked = Boolean(producto.es_nuevo);

  const cuerpoTabla = document.getElementById("variants-table-body");
  while (cuerpoTabla.firstChild) {
    cuerpoTabla.removeChild(cuerpoTabla.firstChild);
  }

  producto.variantes.forEach(function (variante) {
    cuerpoTabla.appendChild(crearFilaTablaVariante(variante));
  });
}

// Tilda/destilda un cartel (Promoción o Nuevo Ingreso) del producto
// seleccionado. "campo" es la columna a actualizar en Supabase.
async function manejarCambioCartel(evento, campo, mensajeOn, mensajeOff) {
  if (!productoSeleccionadoId) return;

  const marcado = evento.target.checked;
  try {
    await actualizarProducto(productoSeleccionadoId, { [campo]: marcado });
    productosAdmin = await obtenerCatalogoCompleto();
    renderListaProductos(document.getElementById("search-product").value);
    mostrarToast(marcado ? mensajeOn : mensajeOff, "success");
  } catch (error) {
    evento.target.checked = !marcado;
    mostrarToast("No se pudo actualizar el cartel.", "error");
  }
}

function manejarCambioEnPromo(evento) {
  return manejarCambioCartel(evento, "en_promo", "Producto destacado como promoción.", "Se sacó de promoción.");
}

function manejarCambioEsNuevo(evento) {
  return manejarCambioCartel(evento, "es_nuevo", "Producto marcado como nuevo ingreso.", "Se sacó de nuevo ingreso.");
}

function crearFilaTablaVariante(variante) {
  const fila = document.createElement("tr");

  const celdaSku = document.createElement("td");
  celdaSku.textContent = variante.sku;
  fila.appendChild(celdaSku);

  const celdaModelo = document.createElement("td");
  celdaModelo.textContent = variante.modelo;
  fila.appendChild(celdaModelo);

  // Editable (y no solo texto): al crear una variante nueva su precio
  // arranca en 0 y recién se completa con la próxima subida del Excel
  // madre (que solo actualiza SKUs que ya trae esa planilla); para no
  // dejar a una funda nueva sin precio hasta esa próxima subida, el
  // admin puede cargarlo a mano acá mismo.
  const celdaPrecio = document.createElement("td");
  const inputPrecio = document.createElement("input");
  inputPrecio.type = "number";
  inputPrecio.step = "0.01";
  inputPrecio.min = "0";
  inputPrecio.className = "form-input";
  inputPrecio.style.width = "100px";
  inputPrecio.style.padding = "0.35rem 0.5rem";
  inputPrecio.style.fontSize = "0.85rem";
  inputPrecio.value = variante.precio_actual;
  inputPrecio.addEventListener("change", function () {
    guardarPrecioActualVariante(variante, inputPrecio);
  });
  celdaPrecio.appendChild(inputPrecio);
  fila.appendChild(celdaPrecio);

  const celdaPrecioAnterior = document.createElement("td");
  const inputPrecioAnterior = document.createElement("input");
  inputPrecioAnterior.type = "number";
  inputPrecioAnterior.step = "0.01";
  inputPrecioAnterior.min = "0";
  inputPrecioAnterior.className = "form-input";
  inputPrecioAnterior.style.width = "100px";
  inputPrecioAnterior.style.padding = "0.35rem 0.5rem";
  inputPrecioAnterior.style.fontSize = "0.85rem";
  inputPrecioAnterior.placeholder = "—";
  if (variante.precio_anterior) {
    inputPrecioAnterior.value = variante.precio_anterior;
  }
  inputPrecioAnterior.addEventListener("change", function () {
    guardarPrecioAnteriorVariante(variante.id, inputPrecioAnterior.value);
  });
  celdaPrecioAnterior.appendChild(inputPrecioAnterior);
  fila.appendChild(celdaPrecioAnterior);

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

// A diferencia del precio anterior, precio_actual no admite null en la
// base (siempre tiene que quedar un número válido): si el admin borra
// el campo o pone algo inválido, se revierte al último valor guardado
// en vez de dejarlo vacío.
async function guardarPrecioActualVariante(variante, input) {
  const valor = Number(input.value);
  if (input.value.trim() === "" || Number.isNaN(valor) || valor < 0) {
    input.value = variante.precio_actual;
    mostrarToast("Ingresá un precio válido.", "error");
    return;
  }
  try {
    await actualizarVariante(variante.id, { precio_actual: valor });
    variante.precio_actual = valor;
    mostrarToast("Precio actualizado.", "success");
  } catch (error) {
    input.value = variante.precio_actual;
    mostrarToast("No se pudo actualizar el precio.", "error");
  }
}

// Guarda (o borra, si el campo queda vacío) el precio anterior de una
// variante puntual. Al quedar vacío, el catálogo del cliente vuelve a
// calcular el tachado automático por porcentaje para esa variante.
async function guardarPrecioAnteriorVariante(varianteId, valorTexto) {
  const valor = valorTexto.trim() === "" ? null : Number(valorTexto);
  try {
    await actualizarVariante(varianteId, { precio_anterior: valor });
    productosAdmin = await obtenerCatalogoCompleto();
    mostrarToast("Precio anterior actualizado.", "success");
  } catch (error) {
    mostrarToast("No se pudo guardar el precio anterior.", "error");
  }
}

// Botón "aplicar a todas las variantes": calcula el precio anterior de
// cada variante del producto seleccionado como el % indicado por
// encima de SU precio actual (no un mismo monto fijo para todas, ya
// que cada variante puede tener un precio distinto), y lo guarda.
// Cualquier variante puede después corregirse a mano en su columna.
async function manejarClickAplicarTachadoTodas() {
  if (!productoSeleccionadoId) return;

  const producto = productosAdmin.find(function (p) {
    return p.id === productoSeleccionadoId;
  });
  if (!producto || producto.variantes.length === 0) return;

  const porcentaje = Number(document.getElementById("input-porcentaje-tachado").value);
  if (!porcentaje || porcentaje <= 0) {
    mostrarToast("Ingresá un porcentaje válido.", "error");
    return;
  }

  try {
    await Promise.all(
      producto.variantes.map(function (variante) {
        const precioAnterior = Math.round(variante.precio_actual * (1 + porcentaje / 100) * 100) / 100;
        return actualizarVariante(variante.id, { precio_anterior: precioAnterior });
      })
    );
    productosAdmin = await obtenerCatalogoCompleto();
    renderDetalleProducto(productoSeleccionadoId);
    mostrarToast("Precio anterior aplicado a todas las variantes.", "success");
  } catch (error) {
    mostrarToast("No se pudo aplicar el precio anterior a todas las variantes.", "error");
  }
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
// Gestión de vendedores (agrupados por provincia)
// ---------------------------------------------------------------------

function renderVendedoresAgrupados() {
  const contenedor = document.getElementById("vendedores-lista");
  while (contenedor.firstChild) {
    contenedor.removeChild(contenedor.firstChild);
  }

  if (vendedoresAdmin.length === 0) {
    const vacio = document.createElement("p");
    vacio.style.color = "var(--color-text-light)";
    vacio.style.fontSize = "0.9rem";
    vacio.textContent = "Todavía no hay vendedores cargados.";
    contenedor.appendChild(vacio);
    return;
  }

  const porProvincia = {};
  vendedoresAdmin.forEach(function (vendedor) {
    const clave = vendedor.provincia || "Sin provincia";
    if (!porProvincia[clave]) {
      porProvincia[clave] = [];
    }
    porProvincia[clave].push(vendedor);
  });

  Object.keys(porProvincia)
    .sort(function (a, b) {
      return a.localeCompare(b, "es");
    })
    .forEach(function (provincia) {
      const grupo = document.createElement("div");
      grupo.className = "vendedor-group";

      const titulo = document.createElement("h3");
      titulo.className = "vendedor-group-title";
      titulo.textContent = provincia;
      grupo.appendChild(titulo);

      porProvincia[provincia]
        .sort(function (a, b) {
          return a.nombre_completo.localeCompare(b.nombre_completo, "es");
        })
        .forEach(function (vendedor) {
          grupo.appendChild(crearFilaVendedor(vendedor));
        });

      contenedor.appendChild(grupo);
    });
}

function crearFilaVendedor(vendedor) {
  const fila = document.createElement("div");
  fila.className = "vendedor-row";
  renderVendedorRowVista(fila, vendedor);
  return fila;
}

// Vista normal de la fila (nombre, N° Zeus, botones Editar/Eliminar).
function renderVendedorRowVista(fila, vendedor) {
  while (fila.firstChild) {
    fila.removeChild(fila.firstChild);
  }

  const info = document.createElement("div");
  info.className = "vendedor-row-info";

  const nombre = document.createElement("span");
  nombre.className = "vendedor-row-name";
  nombre.textContent = vendedor.nombre_completo;
  info.appendChild(nombre);

  const zeus = document.createElement("span");
  zeus.className = "vendedor-row-zeus";
  zeus.textContent = "N° Zeus: " + vendedor.numero_zeus;
  info.appendChild(zeus);

  fila.appendChild(info);

  const acciones = document.createElement("div");
  acciones.className = "vendedor-row-actions";

  const btnEditar = document.createElement("button");
  btnEditar.type = "button";
  btnEditar.className = "btn-secondary";
  btnEditar.style.width = "auto";
  btnEditar.style.padding = "0.3rem 0.65rem";
  btnEditar.style.fontSize = "0.78rem";
  btnEditar.textContent = "✏️ Editar";
  btnEditar.addEventListener("click", function () {
    renderVendedorRowEdicion(fila, vendedor);
  });
  acciones.appendChild(btnEditar);

  const btnEliminar = document.createElement("button");
  btnEliminar.type = "button";
  btnEliminar.className = "btn-delete-var";
  btnEliminar.textContent = "🗑️";
  btnEliminar.addEventListener("click", function () {
    confirmarAccionDoble(btnEliminar, "¿Confirmar?", async function () {
      try {
        await eliminarVendedor(vendedor.id);
        vendedoresAdmin = await obtenerVendedores();
        renderVendedoresAgrupados();
        mostrarToast("Vendedor eliminado.", "success");
      } catch (error) {
        mostrarToast("No se pudo eliminar el vendedor.", "error");
      }
    });
  });
  acciones.appendChild(btnEliminar);

  fila.appendChild(acciones);
}

// Vista de edición: reemplaza el contenido de la fila por inputs
// editables con nombre/provincia/zeus, más Guardar/Cancelar.
function renderVendedorRowEdicion(fila, vendedor) {
  while (fila.firstChild) {
    fila.removeChild(fila.firstChild);
  }

  const campos = document.createElement("div");
  campos.className = "vendedor-row-fields";

  const inputNombre = document.createElement("input");
  inputNombre.type = "text";
  inputNombre.className = "form-input";
  inputNombre.value = vendedor.nombre_completo;
  campos.appendChild(inputNombre);

  const inputProvincia = document.createElement("input");
  inputProvincia.type = "text";
  inputProvincia.className = "form-input";
  inputProvincia.value = vendedor.provincia;
  campos.appendChild(inputProvincia);

  const inputZeus = document.createElement("input");
  inputZeus.type = "text";
  inputZeus.className = "form-input";
  inputZeus.value = vendedor.numero_zeus;
  campos.appendChild(inputZeus);

  fila.appendChild(campos);

  const acciones = document.createElement("div");
  acciones.className = "vendedor-row-actions";

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn-primary";
  btnGuardar.style.width = "auto";
  btnGuardar.style.padding = "0.3rem 0.65rem";
  btnGuardar.style.fontSize = "0.78rem";
  btnGuardar.textContent = "💾 Guardar";
  btnGuardar.addEventListener("click", async function () {
    const nombreNuevo = inputNombre.value.trim();
    const provinciaNueva = inputProvincia.value.trim();

    if (existeVendedorDuplicado(nombreNuevo, provinciaNueva, vendedor.id)) {
      mostrarToast("Ya existe otro vendedor con ese nombre en esa provincia.", "error");
      return;
    }

    try {
      await actualizarVendedor(vendedor.id, {
        nombre_completo: nombreNuevo,
        provincia: provinciaNueva,
        numero_zeus: inputZeus.value.trim(),
      });
      vendedoresAdmin = await obtenerVendedores();
      renderVendedoresAgrupados();
      mostrarToast("Vendedor actualizado.", "success");
    } catch (error) {
      mostrarToast(
        esErrorVendedorDuplicado(error) ? "Ya existe otro vendedor con ese nombre en esa provincia." : "No se pudo actualizar el vendedor.",
        "error"
      );
    }
  });
  acciones.appendChild(btnGuardar);

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn-secondary";
  btnCancelar.style.width = "auto";
  btnCancelar.style.padding = "0.3rem 0.65rem";
  btnCancelar.style.fontSize = "0.78rem";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", function () {
    renderVendedorRowVista(fila, vendedor);
  });
  acciones.appendChild(btnCancelar);

  fila.appendChild(acciones);
}

async function manejarSubmitAgregarVendedor(evento) {
  evento.preventDefault();

  const nombre = document.getElementById("vendedor-nombre").value.trim();
  const provincia = document.getElementById("vendedor-provincia").value.trim();
  const zeus = document.getElementById("vendedor-zeus").value.trim();

  // Antes se podía cargar el mismo vendedor dos veces sin ningún aviso;
  // se chequea primero contra lo que ya está en memoria (feedback
  // inmediato) y la restricción única de la base (ver schema.sql) queda
  // como red de seguridad ante altas simultáneas desde dos sesiones.
  if (existeVendedorDuplicado(nombre, provincia, null)) {
    mostrarToast("Ya existe un vendedor con ese nombre en esa provincia.", "error");
    return;
  }

  try {
    await crearVendedor({ nombreCompleto: nombre, provincia: provincia, numeroZeus: zeus });
    document.getElementById("form-add-vendedor").reset();
    vendedoresAdmin = await obtenerVendedores();
    renderVendedoresAgrupados();
    mostrarToast("Vendedor agregado.", "success");
  } catch (error) {
    mostrarToast(
      esErrorVendedorDuplicado(error) ? "Ya existe un vendedor con ese nombre en esa provincia." : "No se pudo agregar el vendedor.",
      "error"
    );
  }
}

// idExcluir se usa al editar: no debe compararse un vendedor contra sí
// mismo, solo contra los demás.
function existeVendedorDuplicado(nombre, provincia, idExcluir) {
  const nombreNorm = nombre.trim().toLowerCase();
  const provinciaNorm = provincia.trim().toLowerCase();
  return vendedoresAdmin.some(function (v) {
    return (
      v.id !== idExcluir &&
      v.nombre_completo.trim().toLowerCase() === nombreNorm &&
      v.provincia.trim().toLowerCase() === provinciaNorm
    );
  });
}

function esErrorVendedorDuplicado(error) {
  return Boolean(error && (error.code === "23505" || (error.message && /duplicate|unique/i.test(error.message))));
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
