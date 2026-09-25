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
let categoriasAdmin = []; // Activas e inactivas, para la pestaña Categorías y los selects de producto.
let usuariosAdmin = []; // Perfiles (nombre/rol) de quienes tienen acceso al panel.
let rolActual = null; // "admin", "editor" o "vendedora": del usuario logueado, define qué pestañas ve.
let usuarioActualId = null; // Id del usuario logueado (para no dejarlo autoeliminarse/autodegradarse).
let miVendedorId = null; // Solo para rol "vendedora": su fila vinculada en "vendedores" (ver perfiles_admin.vendedor_id).

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
  document.getElementById("btn-logout").addEventListener("click", manejarClickCerrarSesion);

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
  document.getElementById("btn-aplicar-precio-actual-todas").addEventListener("click", manejarClickAplicarPrecioActualTodas);

  document.getElementById("form-add-vendedor").addEventListener("submit", manejarSubmitAgregarVendedor);

  document.getElementById("form-add-categoria").addEventListener("submit", manejarSubmitAgregarCategoria);
  document.getElementById("edit-product-category").addEventListener("change", manejarCambioCategoriaProducto);

  document.getElementById("form-add-usuario").addEventListener("submit", manejarSubmitAgregarUsuario);

  document.getElementById("btn-toggle-completados").addEventListener("click", function () {
    const wrap = document.getElementById("orders-completados-wrap");
    const btn = document.getElementById("btn-toggle-completados");
    const mostrando = wrap.style.display !== "none";
    wrap.style.display = mostrando ? "none" : "block";
    btn.textContent = mostrando ? "Mostrar" : "Ocultar";
  });

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
// Acceso (login individual: email + contraseña de Supabase Auth)
// ---------------------------------------------------------------------

async function manejarSubmitPin(evento) {
  evento.preventDefault();

  const email = document.getElementById("input-email").value.trim();
  const password = document.getElementById("input-pin").value;
  const resultado = await iniciarSesionAdmin(email, password);

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
  await aplicarPermisosPorRol();

  // La alerta "⚠️ Demorado" depende de la hora actual, no de un dato que
  // cambie en la base: sin este refresco periódico, quedaría desactualizada
  // hasta la próxima acción manual (cerrar sesión no hace falta, se
  // recalcula solo mientras la pestaña sigue abierta).
  setInterval(function () {
    renderTablasPedidos(pedidosAdmin);
  }, 60000);
}

async function manejarSubmitCambiarPin(evento) {
  evento.preventDefault();

  const pinActual = document.getElementById("current-pin").value;
  const pinNuevo = document.getElementById("new-pin").value;
  const mensajeError = document.getElementById("change-pin-error-msg");

  const resultado = await cambiarPasswordAdmin(pinActual, pinNuevo);

  if (!resultado.ok) {
    mensajeError.textContent = resultado.error;
    mensajeError.style.display = "block";
    return;
  }

  mensajeError.style.display = "none";
  document.getElementById("form-change-pin").reset();
  ocultarModal(document.getElementById("modal-change-pin"));
  mostrarToast("Contraseña actualizada correctamente.", "success");
}

// Cierra la sesión de Supabase Auth y recarga la página: como el
// estado del panel (rolActual, pedidosAdmin, etc.) vive en variables
// globales, recargar es la forma más simple y segura de dejar todo
// limpio para el próximo login (vuelve a mostrar la pantalla de
// acceso en vez del panel).
async function manejarClickCerrarSesion() {
  await cerrarSesionAdmin();
  window.location.reload();
}

// ---------------------------------------------------------------------
// Carga inicial de datos del panel
// ---------------------------------------------------------------------

async function cargarDatosAdmin() {
  try {
    const [config, catalogo, pedidos, vendedores, categorias] = await Promise.all([
      obtenerConfig(),
      obtenerCatalogoCompleto(),
      obtenerPedidos(),
      obtenerVendedores(),
      obtenerCategoriasCompleto(),
    ]);
    document.getElementById("config-whatsapp").value = config.whatsapp_vendedor || "";
    productosAdmin = catalogo;
    vendedoresAdmin = vendedores;
    pedidosAdmin = pedidos;
    categoriasAdmin = categorias;
    renderListaProductos("");
    renderTablasPedidos(pedidosAdmin);
    renderReporteVendedores(pedidosAdmin);
    renderVendedoresAgrupados();
    renderCategoriasLista();
    renderSelectsCategorias();
  } catch (error) {
    mostrarToast("No se pudieron cargar los datos del panel.", "error");
  }
}

// Vuelve a pedir los pedidos a Supabase y refresca tanto las tablas
// como el reporte por vendedor/a, para que todo siempre refleje el
// mismo estado (evita que algo quede desactualizado tras una acción
// puntual, como completar un pedido).
async function refrescarPedidos() {
  pedidosAdmin = await obtenerPedidos();
  renderTablasPedidos(pedidosAdmin);
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

// Separa los pedidos "abiertos" (nuevo/asignado, todavía requieren
// alguna acción) de los "completados" (ya cobrados/entregados) en dos
// tablas distintas, para no tener que scrollear el historial completo
// buscando lo que sigue pendiente.
function renderTablasPedidos(pedidos) {
  // Una vendedora solo necesita ver lo suyo: los pedidos que ya tiene
  // asignados y los que están libres para tomar. Los de otras
  // sucursales/vendedoras no le aportan nada y solo generan ruido (y
  // riesgo de confundirse y tocar algo que no es de ella).
  const visibles =
    rolActual === "vendedora"
      ? pedidos.filter(function (p) {
          return p.vendedor_id === null || p.vendedor_id === miVendedorId;
        })
      : pedidos;

  const abiertos = visibles.filter(function (p) {
    return p.estado !== "completado";
  });
  const completados = visibles.filter(function (p) {
    return p.estado === "completado";
  });

  renderTablaPedidos(abiertos, "orders-table-body-abiertos", "orders-abiertos-vacio");
  renderTablaPedidos(completados, "orders-table-body-completados", "orders-completados-vacio");
}

function renderTablaPedidos(pedidos, idTbody, idMensajeVacio) {
  const cuerpo = document.getElementById(idTbody);
  while (cuerpo.firstChild) {
    cuerpo.removeChild(cuerpo.firstChild);
  }

  pedidos.forEach(function (pedido) {
    cuerpo.appendChild(crearFilaPedido(pedido));
  });

  const mensajeVacio = document.getElementById(idMensajeVacio);
  if (mensajeVacio) {
    mensajeVacio.style.display = pedidos.length === 0 ? "block" : "none";
  }
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

  if (rolActual === "vendedora") {
    renderFilaPedidoVendedora(pedido, celdaCliente, celdaTelefono, celdaEstado, celdaVendedor, celdaAcciones);
  } else {
    renderFilaPedidoVista(pedido, celdaCliente, celdaTelefono, celdaEstado, celdaVendedor, celdaAcciones);
  }

  return fila;
}

// Vista de una fila de pedido para el rol vendedora: sin reasignar a
// otra persona, sin Excel/editar/eliminar (igual quedarían rechazados
// por RLS, pero mejor no mostrar botones que no van a funcionar). Solo
// "Tomar pedido" (si está libre) o "Marcar completado" (si ya es suyo),
// vía tomar_pedido/completar_pedido_propio (supabase/schema.sql).
function renderFilaPedidoVendedora(pedido, celdaCliente, celdaTelefono, celdaEstado, celdaVendedor, celdaAcciones) {
  celdaCliente.textContent = pedido.cliente_nombre;
  celdaTelefono.textContent = pedido.cliente_telefono;

  pintarEstadoPedido(pedido, celdaEstado);

  while (celdaVendedor.firstChild) {
    celdaVendedor.removeChild(celdaVendedor.firstChild);
  }
  celdaVendedor.textContent = pedido.vendedor_id === null ? "🤝 Disponible" : "Vos";

  while (celdaAcciones.firstChild) {
    celdaAcciones.removeChild(celdaAcciones.firstChild);
  }

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

  if (pedido.vendedor_id === null && pedido.estado !== "completado") {
    const btnTomar = document.createElement("button");
    btnTomar.type = "button";
    btnTomar.className = "btn-primary";
    btnTomar.style.width = "auto";
    btnTomar.style.padding = "0.35rem 0.75rem";
    btnTomar.style.fontSize = "0.8rem";
    btnTomar.textContent = "🤝 Agarrar pedido";
    btnTomar.addEventListener("click", function () {
      manejarTomarPedido(pedido.id, btnTomar);
    });
    celdaAcciones.appendChild(btnTomar);
  } else if (pedido.vendedor_id === miVendedorId && pedido.estado === "asignado") {
    const btnPreparar = document.createElement("button");
    btnPreparar.type = "button";
    btnPreparar.className = "btn-secondary";
    btnPreparar.style.width = "auto";
    btnPreparar.style.padding = "0.35rem 0.75rem";
    btnPreparar.style.fontSize = "0.8rem";
    btnPreparar.textContent = "📦 Marcar preparado";
    btnPreparar.addEventListener("click", function () {
      manejarPrepararPedido(pedido.id, btnPreparar);
    });
    celdaAcciones.appendChild(btnPreparar);
  } else if (pedido.vendedor_id === miVendedorId && pedido.estado === "preparado") {
    const btnCompletar = document.createElement("button");
    btnCompletar.type = "button";
    btnCompletar.className = "btn-secondary";
    btnCompletar.style.width = "auto";
    btnCompletar.style.padding = "0.35rem 0.75rem";
    btnCompletar.style.fontSize = "0.8rem";
    btnCompletar.textContent = "💰 Marcar pagado";
    btnCompletar.addEventListener("click", function () {
      manejarCompletarPedido(pedido.id, btnCompletar);
    });
    celdaAcciones.appendChild(btnCompletar);
  }
}

// Toma un pedido sin asignar (o confirma el propio) de forma atómica en
// el servidor: si otra vendedora ya lo tomó justo antes, avisa sin
// romper nada (ver tomar_pedido en supabase/schema.sql).
async function manejarTomarPedido(pedidoId, boton) {
  boton.disabled = true;
  try {
    const resultado = await tomarPedido(pedidoId);
    if (!resultado.ok) {
      if (resultado.motivo === "ya_asignado") {
        mostrarToast("Ese pedido ya lo tomó " + (resultado.vendedor_nombre || "otra vendedora") + ".", "error");
      } else if (resultado.motivo === "sin_vendedor_vinculado") {
        mostrarToast("Tu usuario todavía no está vinculado a un/a vendedor/a. Pedile al admin que lo complete en Usuarios.", "error");
      } else {
        mostrarToast("No se pudo tomar el pedido.", "error");
      }
    } else {
      mostrarToast("Pedido asignado a vos.", "success");
    }
    await refrescarPedidos();
  } catch (error) {
    mostrarToast("No se pudo tomar el pedido.", "error");
    boton.disabled = false;
  }
}

async function manejarPrepararPedido(pedidoId, boton) {
  boton.disabled = true;
  try {
    const ok = await prepararPedidoPropio(pedidoId);
    mostrarToast(ok ? "Pedido marcado como preparado." : "No se pudo marcar como preparado.", ok ? "success" : "error");
    await refrescarPedidos();
  } catch (error) {
    mostrarToast("No se pudo marcar como preparado.", "error");
    boton.disabled = false;
  }
}

async function manejarCompletarPedido(pedidoId, boton) {
  boton.disabled = true;
  try {
    const ok = await completarPedidoPropio(pedidoId);
    mostrarToast(ok ? "Pedido marcado como pagado." : "No se pudo marcar como pagado.", ok ? "success" : "error");
    await refrescarPedidos();
  } catch (error) {
    mostrarToast("No se pudo marcar como pagado.", "error");
    boton.disabled = false;
  }
}

const ETIQUETAS_ESTADO_PEDIDO = { nuevo: "🆕 Nuevo", asignado: "🤝 Tomado", preparado: "📦 Preparado", completado: "💰 Pagado" };

// Horas transcurridas entre dos fechas contando solo tramos de día hábil
// (lunes a viernes): el tiempo que cae sábado/domingo no suma. No se
// recorta a un horario laboral dentro del día, solo se saltan los dos
// días de fin de semana completos.
function horasHabilesEntre(desde, hasta) {
  let total = 0;
  let cursor = new Date(desde);
  while (cursor < hasta) {
    const diaSemana = cursor.getDay(); // 0 = domingo, 6 = sábado
    const finDia = new Date(cursor);
    finDia.setHours(24, 0, 0, 0);
    const finSegmento = finDia < hasta ? finDia : hasta;
    if (diaSemana !== 0 && diaSemana !== 6) {
      total += finSegmento - cursor;
    }
    cursor = finSegmento;
  }
  return total / (1000 * 60 * 60);
}

// Alerta de SLA pedida por el negocio: más de 8 horas hábiles sin que
// nadie agarre el pedido, o más de 24 horas hábiles desde que alguien lo
// agarró sin marcarlo preparado. Una vez preparado o completado, ya no
// aplica (el reloj de esas dos etapas se detiene ahí).
function pedidoEstaDemorado(pedido) {
  const ahora = new Date();
  if (!pedido.vendedor_id) {
    return horasHabilesEntre(new Date(pedido.created_at), ahora) > 8;
  }
  if (pedido.estado === "asignado" && pedido.tomado_en) {
    return horasHabilesEntre(new Date(pedido.tomado_en), ahora) > 24;
  }
  return false;
}

// Badges de estado + armado, compartidos entre la vista admin y la
// vista simplificada de vendedora (ver renderFilaPedidoVendedora).
function pintarEstadoPedido(pedido, celdaEstado) {
  while (celdaEstado.firstChild) {
    celdaEstado.removeChild(celdaEstado.firstChild);
  }
  const badgeEstado = document.createElement("span");
  badgeEstado.className = "pedido-badge " + pedido.estado;
  badgeEstado.textContent = ETIQUETAS_ESTADO_PEDIDO[pedido.estado] || pedido.estado;
  celdaEstado.appendChild(badgeEstado);

  if (pedidoEstaDemorado(pedido)) {
    celdaEstado.appendChild(document.createElement("br"));
    const badgeDemorado = document.createElement("span");
    badgeDemorado.className = "pedido-badge pedido-badge-demorado";
    badgeDemorado.textContent = "⚠️ Demorado";
    celdaEstado.appendChild(badgeDemorado);
  }

  // Estado de armado (pedido.html): si alguien lo está preparando
  // ahora mismo, o si ya lo terminó de armar, para verlo sin tener que
  // abrir el link.
  if (pedido.preparado_por_id) {
    celdaEstado.appendChild(document.createElement("br"));
    const badgeLock = document.createElement("span");
    badgeLock.className = "pedido-badge pedido-badge-lock";
    badgeLock.textContent = "🔒 " + (pedido.preparado_por_nombre || "vendedor/a");
    celdaEstado.appendChild(badgeLock);
  } else if (pedido.armado_finalizado) {
    celdaEstado.appendChild(document.createElement("br"));
    const badgeArmado = document.createElement("span");
    badgeArmado.className = "pedido-badge pedido-badge-armado";
    badgeArmado.textContent = "✅ Armado" + (pedido.armado_finalizado_por ? " por " + pedido.armado_finalizado_por : "");
    celdaEstado.appendChild(badgeArmado);
  }
}

// Vista normal de una fila de pedido: texto de cliente/teléfono, badge
// de estado, desplegable de vendedor/a y los botones de acción. Se
// separa de crearFilaPedido para poder volver a esta vista después de
// cancelar una edición, sin tener que reconstruir toda la fila.
function renderFilaPedidoVista(pedido, celdaCliente, celdaTelefono, celdaEstado, celdaVendedor, celdaAcciones) {
  celdaCliente.textContent = pedido.cliente_nombre;
  celdaTelefono.textContent = pedido.cliente_telefono;

  pintarEstadoPedido(pedido, celdaEstado);

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
    const btnPreparar = document.createElement("button");
    btnPreparar.type = "button";
    btnPreparar.className = "btn-secondary";
    btnPreparar.style.width = "auto";
    btnPreparar.style.padding = "0.35rem 0.75rem";
    btnPreparar.style.fontSize = "0.8rem";
    btnPreparar.textContent = "📦 Preparar";
    btnPreparar.addEventListener("click", function () {
      cambiarEstadoPedido(pedido.id, "preparado");
    });
    celdaAcciones.appendChild(btnPreparar);
  } else if (pedido.estado === "preparado") {
    const btnCompletar = document.createElement("button");
    btnCompletar.type = "button";
    btnCompletar.className = "btn-secondary";
    btnCompletar.style.width = "auto";
    btnCompletar.style.padding = "0.35rem 0.75rem";
    btnCompletar.style.fontSize = "0.8rem";
    btnCompletar.textContent = "💰 Marcar pagado";
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
      cambiarEstadoPedido(pedido.id, "preparado");
    });
    celdaAcciones.appendChild(btnReabrir);
  }

  if (pedido.preparado_por_id) {
    const btnLiberar = document.createElement("button");
    btnLiberar.type = "button";
    btnLiberar.className = "btn-secondary";
    btnLiberar.style.width = "auto";
    btnLiberar.style.padding = "0.35rem 0.75rem";
    btnLiberar.style.fontSize = "0.8rem";
    btnLiberar.textContent = "🔓 Liberar";
    btnLiberar.addEventListener("click", function () {
      confirmarAccionDoble(btnLiberar, "¿Liberar?", async function () {
        try {
          await actualizarPedido(pedido.id, { preparado_por_id: null, preparado_por_nombre: null });
          await refrescarPedidos();
          mostrarToast("Bloqueo de armado liberado.", "success");
        } catch (error) {
          mostrarToast("No se pudo liberar el pedido.", "error");
        }
      });
    });
    celdaAcciones.appendChild(btnLiberar);
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
// Reporte por vendedor/a: en vez de listar pedidos sueltos, se lista
// un renglón por vendedor/a (todos, tengan o no pedidos todavía). Al
// tocar uno se despliegan sus últimos 5 pedidos (en cualquier estado,
// no solo pendientes) y un control para descargar su historial
// completo en Excel, filtrado por rango de fechas si se quiere.
// ---------------------------------------------------------------------

const CANTIDAD_ULTIMOS_PEDIDOS_REPORTE = 5;

function renderReporteVendedores(pedidos) {
  const contenedor = document.getElementById("reporte-vendedores");
  // Recordar qué vendedor/a estaba desplegado antes de re-renderizar
  // (por ejemplo, tras asignarle un pedido nuevo), para no cerrarlo de
  // golpe en la cara del admin.
  const expandidoPrevio = contenedor.querySelector(".reporte-vendedor-row.expandido");
  const vendedorIdExpandido = expandidoPrevio ? expandidoPrevio.dataset.vendedorId : null;

  while (contenedor.firstChild) {
    contenedor.removeChild(contenedor.firstChild);
  }

  if (vendedoresAdmin.length === 0) {
    const vacio = document.createElement("p");
    vacio.style.color = "var(--color-text-light)";
    vacio.style.fontSize = "0.9rem";
    vacio.textContent = "Todavía no cargaste ningún vendedor/a (pestaña Gestión Vendedores).";
    contenedor.appendChild(vacio);
    return;
  }

  const porVendedor = {};
  pedidos.forEach(function (pedido) {
    if (!pedido.vendedor_id) return;
    if (!porVendedor[pedido.vendedor_id]) {
      porVendedor[pedido.vendedor_id] = [];
    }
    porVendedor[pedido.vendedor_id].push(pedido);
  });

  vendedoresAdmin.forEach(function (vendedor) {
    const pedidosVendedor = (porVendedor[vendedor.id] || []).slice().sort(function (a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    });
    const fila = crearFilaReporteVendedor(vendedor, pedidosVendedor);
    if (vendedor.id === vendedorIdExpandido) {
      fila.classList.add("expandido");
    }
    contenedor.appendChild(fila);
  });
}

function crearFilaReporteVendedor(vendedor, pedidosVendedor) {
  const pendientes = pedidosVendedor.filter(function (p) {
    return p.estado !== "completado";
  });

  const fila = document.createElement("div");
  fila.className = "reporte-vendedor-row";
  fila.dataset.vendedorId = vendedor.id;

  const header = document.createElement("button");
  header.type = "button";
  header.className = "reporte-vendedor-header";

  const nombreBox = document.createElement("div");
  nombreBox.className = "reporte-vendedor-nombre-box";
  const nombre = document.createElement("span");
  nombre.className = "reporte-vendedor-nombre";
  nombre.textContent = vendedor.nombre_completo;
  nombreBox.appendChild(nombre);
  const provincia = document.createElement("span");
  provincia.className = "reporte-vendedor-provincia";
  provincia.textContent = vendedor.provincia;
  nombreBox.appendChild(provincia);
  header.appendChild(nombreBox);

  const conteo = document.createElement("span");
  conteo.className = "reporte-vendedor-conteo";
  const textoConteo = document.createElement("span");
  textoConteo.textContent =
    pedidosVendedor.length + " pedido" + (pedidosVendedor.length === 1 ? "" : "s") +
    (pendientes.length > 0 ? " · " + pendientes.length + " pendiente" + (pendientes.length === 1 ? "" : "s") : "");
  conteo.appendChild(textoConteo);
  const flecha = document.createElement("span");
  flecha.className = "reporte-vendedor-flecha";
  flecha.textContent = "▸";
  conteo.appendChild(flecha);
  header.appendChild(conteo);

  header.addEventListener("click", function () {
    fila.classList.toggle("expandido");
  });
  fila.appendChild(header);

  const body = document.createElement("div");
  body.className = "reporte-vendedor-body";

  if (pedidosVendedor.length === 0) {
    const vacio = document.createElement("p");
    vacio.style.margin = "0.5rem 0 0";
    vacio.style.fontSize = "0.82rem";
    vacio.style.color = "var(--color-text-light)";
    vacio.textContent = "Todavía no tiene pedidos asignados.";
    body.appendChild(vacio);
  } else {
    const titulo = document.createElement("p");
    titulo.style.margin = "0.5rem 0 0.25rem";
    titulo.style.fontSize = "0.78rem";
    titulo.style.color = "var(--color-text-light)";
    titulo.textContent = "Últimos " + Math.min(CANTIDAD_ULTIMOS_PEDIDOS_REPORTE, pedidosVendedor.length) + " pedidos:";
    body.appendChild(titulo);

    pedidosVendedor.slice(0, CANTIDAD_ULTIMOS_PEDIDOS_REPORTE).forEach(function (pedido) {
      body.appendChild(crearFilaReportePedido(pedido));
    });
  }

  body.appendChild(crearControlDescargaHistorial(vendedor, pedidosVendedor));

  fila.appendChild(body);
  return fila;
}

function crearFilaReportePedido(pedido) {
  const fila = document.createElement("div");
  fila.className = "reporte-pedido-fila";

  const info = document.createElement("span");
  info.textContent =
    new Date(pedido.created_at).toLocaleDateString("es-AR") + " — " + pedido.cliente_nombre + " — " + formatearMoneda(pedido.total);
  fila.appendChild(info);

  const derecha = document.createElement("span");
  derecha.style.display = "flex";
  derecha.style.alignItems = "center";
  derecha.style.gap = "0.5rem";

  const badge = document.createElement("span");
  badge.className = "pedido-badge " + pedido.estado;
  badge.textContent = ETIQUETAS_ESTADO_PEDIDO[pedido.estado] || pedido.estado;
  derecha.appendChild(badge);

  const enlaceVer = document.createElement("a");
  enlaceVer.href = "pedido.html?id=" + pedido.id;
  enlaceVer.target = "_blank";
  enlaceVer.rel = "noopener";
  enlaceVer.textContent = "👁️ Ver";
  derecha.appendChild(enlaceVer);

  fila.appendChild(derecha);
  return fila;
}

// Control de "Desde/Hasta" + botón de descarga del historial completo
// de un vendedor/a en Excel (no solo los últimos 5 que se ven en
// pantalla). Sin fechas cargadas, descarga todo el historial.
function crearControlDescargaHistorial(vendedor, pedidosVendedor) {
  const box = document.createElement("div");
  box.className = "reporte-descarga-box";

  const labelDesde = document.createElement("label");
  labelDesde.textContent = "Desde";
  const inputDesde = document.createElement("input");
  inputDesde.type = "date";
  inputDesde.className = "form-input";

  const labelHasta = document.createElement("label");
  labelHasta.textContent = "Hasta";
  const inputHasta = document.createElement("input");
  inputHasta.type = "date";
  inputHasta.className = "form-input";

  const btnDescargar = document.createElement("button");
  btnDescargar.type = "button";
  btnDescargar.className = "btn-secondary";
  btnDescargar.style.width = "auto";
  btnDescargar.style.padding = "0.35rem 0.75rem";
  btnDescargar.style.fontSize = "0.8rem";
  btnDescargar.textContent = "📥 Descargar historial de pedidos de este vendedor/a";
  btnDescargar.addEventListener("click", function () {
    descargarHistorialVendedor(vendedor, pedidosVendedor, inputDesde.value, inputHasta.value);
  });

  box.appendChild(labelDesde);
  box.appendChild(inputDesde);
  box.appendChild(labelHasta);
  box.appendChild(inputHasta);
  box.appendChild(btnDescargar);

  return box;
}

// Filtra por rango de fechas (si se cargó alguna) y genera el Excel
// con excel-generator.js. "hasta" incluye el día completo (23:59:59),
// para que cargar la misma fecha en desde/hasta traiga ese día entero.
function descargarHistorialVendedor(vendedor, pedidosVendedor, desdeTexto, hastaTexto) {
  const desde = desdeTexto ? new Date(desdeTexto + "T00:00:00") : null;
  const hasta = hastaTexto ? new Date(hastaTexto + "T23:59:59") : null;

  const filtrados = pedidosVendedor.filter(function (pedido) {
    const fecha = new Date(pedido.created_at);
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;
    return true;
  });

  if (filtrados.length === 0) {
    mostrarToast("No hay pedidos de este vendedor/a en ese rango de fechas.", "error");
    return;
  }

  const archivo = generarExcelHistorialVendedor(vendedor, filtrados);
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
  document.getElementById("edit-product-category").value = producto.categoria_id || "";

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

async function manejarCambioCategoriaProducto(evento) {
  if (!productoSeleccionadoId) return;

  const categoriaId = evento.target.value || null;
  try {
    await actualizarProducto(productoSeleccionadoId, { categoria_id: categoriaId });
    productosAdmin = await obtenerCatalogoCompleto();
    renderListaProductos(document.getElementById("search-product").value);
    mostrarToast("Categoría del producto actualizada.", "success");
  } catch (error) {
    mostrarToast("No se pudo actualizar la categoría del producto.", "error");
  }
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

// Botón "aplicar a todas las variantes" del precio actual: carga el
// mismo monto fijo a TODAS las variantes del producto seleccionado de
// una sola vez (a diferencia del precio anterior, que se calcula
// distinto por variante). Pensado para una funda recién creada con
// muchas variantes, para no tener que escribir el precio una por una
// mientras se espera la próxima subida del Excel madre; esa subida
// sigue pisando el precio de cada SKU que traiga, como siempre.
async function manejarClickAplicarPrecioActualTodas() {
  if (!productoSeleccionadoId) return;

  const producto = productosAdmin.find(function (p) {
    return p.id === productoSeleccionadoId;
  });
  if (!producto || producto.variantes.length === 0) return;

  const input = document.getElementById("input-precio-actual-masivo");
  const precio = Number(input.value);
  if (input.value.trim() === "" || Number.isNaN(precio) || precio < 0) {
    mostrarToast("Ingresá un precio válido.", "error");
    return;
  }

  try {
    await Promise.all(
      producto.variantes.map(function (variante) {
        return actualizarVariante(variante.id, { precio_actual: precio });
      })
    );
    productosAdmin = await obtenerCatalogoCompleto();
    renderDetalleProducto(productoSeleccionadoId);
    mostrarToast("Precio aplicado a las " + producto.variantes.length + " variantes.", "success");
  } catch (error) {
    mostrarToast("No se pudo aplicar el precio a todas las variantes.", "error");
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
  const categoriaId = document.getElementById("new-product-category").value || null;
  const archivoFoto = document.getElementById("new-product-photo").files[0];
  const textoVariantes = document.getElementById("new-product-variants-text").value;
  const variantes = parsearListaVariantes(textoVariantes);

  try {
    const producto = await crearProducto(nombre, null, categoriaId);

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
// Gestión de categorías (lista plana, ordenable con los botones ↑/↓)
// ---------------------------------------------------------------------

function renderCategoriasLista() {
  const contenedor = document.getElementById("categorias-lista");
  while (contenedor.firstChild) {
    contenedor.removeChild(contenedor.firstChild);
  }

  if (categoriasAdmin.length === 0) {
    const vacio = document.createElement("p");
    vacio.style.color = "var(--color-text-light)";
    vacio.style.fontSize = "0.9rem";
    vacio.textContent = "Todavía no hay categorías cargadas.";
    contenedor.appendChild(vacio);
    return;
  }

  const ordenadas = categoriasAdmin.slice().sort(function (a, b) {
    return a.orden - b.orden;
  });

  ordenadas.forEach(function (categoria, indice) {
    contenedor.appendChild(crearFilaCategoria(categoria, indice, ordenadas.length));
  });
}

// Reutiliza las clases "vendedor-row-*" (ya definidas en admin.html):
// son puramente de layout (fila con info a la izquierda y acciones a la
// derecha), no algo específico de vendedores.
function crearFilaCategoria(categoria, indice, total) {
  const fila = document.createElement("div");
  fila.className = "vendedor-row";
  renderCategoriaRowVista(fila, categoria, indice, total);
  return fila;
}

function renderCategoriaRowVista(fila, categoria, indice, total) {
  while (fila.firstChild) {
    fila.removeChild(fila.firstChild);
  }

  if (categoria.imagen_url) {
    const miniatura = document.createElement("img");
    miniatura.src = categoria.imagen_url;
    miniatura.alt = "";
    miniatura.style.width = "36px";
    miniatura.style.height = "36px";
    miniatura.style.objectFit = "contain";
    miniatura.style.background = "#f3f4f6";
    miniatura.style.borderRadius = "6px";
    miniatura.style.flex = "0 0 auto";
    fila.appendChild(miniatura);
  }

  const info = document.createElement("div");
  info.className = "vendedor-row-info";

  const nombre = document.createElement("span");
  nombre.className = "vendedor-row-name";
  nombre.textContent = (categoria.icono ? categoria.icono + " " : "") + categoria.nombre;
  info.appendChild(nombre);

  const estado = document.createElement("span");
  estado.className = "vendedor-row-zeus";
  estado.textContent = categoria.activo ? "Activa" : "Inactiva";
  info.appendChild(estado);

  fila.appendChild(info);

  const acciones = document.createElement("div");
  acciones.className = "vendedor-row-actions";

  const btnSubir = document.createElement("button");
  btnSubir.type = "button";
  btnSubir.className = "btn-secondary";
  btnSubir.style.width = "auto";
  btnSubir.style.padding = "0.3rem 0.55rem";
  btnSubir.style.fontSize = "0.78rem";
  btnSubir.textContent = "↑";
  btnSubir.disabled = indice === 0;
  btnSubir.addEventListener("click", function () {
    moverCategoria(categoria, -1);
  });
  acciones.appendChild(btnSubir);

  const btnBajar = document.createElement("button");
  btnBajar.type = "button";
  btnBajar.className = "btn-secondary";
  btnBajar.style.width = "auto";
  btnBajar.style.padding = "0.3rem 0.55rem";
  btnBajar.style.fontSize = "0.78rem";
  btnBajar.textContent = "↓";
  btnBajar.disabled = indice === total - 1;
  btnBajar.addEventListener("click", function () {
    moverCategoria(categoria, 1);
  });
  acciones.appendChild(btnBajar);

  const btnToggleActivo = document.createElement("button");
  btnToggleActivo.type = "button";
  btnToggleActivo.className = "btn-secondary";
  btnToggleActivo.style.width = "auto";
  btnToggleActivo.style.padding = "0.3rem 0.65rem";
  btnToggleActivo.style.fontSize = "0.78rem";
  btnToggleActivo.textContent = categoria.activo ? "Desactivar" : "Activar";
  btnToggleActivo.addEventListener("click", async function () {
    try {
      await actualizarCategoria(categoria.id, { activo: !categoria.activo });
      categoriasAdmin = await obtenerCategoriasCompleto();
      renderCategoriasLista();
      renderSelectsCategorias();
      mostrarToast(categoria.activo ? "Categoría desactivada." : "Categoría activada.", "success");
    } catch (error) {
      mostrarToast("No se pudo actualizar la categoría.", "error");
    }
  });
  acciones.appendChild(btnToggleActivo);

  const btnEditar = document.createElement("button");
  btnEditar.type = "button";
  btnEditar.className = "btn-secondary";
  btnEditar.style.width = "auto";
  btnEditar.style.padding = "0.3rem 0.65rem";
  btnEditar.style.fontSize = "0.78rem";
  btnEditar.textContent = "✏️ Editar";
  btnEditar.addEventListener("click", function () {
    renderCategoriaRowEdicion(fila, categoria, indice, total);
  });
  acciones.appendChild(btnEditar);

  // Input de archivo oculto: se dispara clickeándolo desde btnImagen, y
  // sube apenas se elige un archivo (mismo patrón que la foto de
  // producto, sin un paso extra de "guardar").
  const inputImagen = document.createElement("input");
  inputImagen.type = "file";
  inputImagen.accept = "image/*";
  inputImagen.style.display = "none";
  inputImagen.addEventListener("change", async function () {
    const archivo = inputImagen.files[0];
    if (!archivo) return;
    try {
      const url = await subirImagenCategoria(categoria.id, archivo);
      await actualizarCategoria(categoria.id, { imagen_url: url });
      categoriasAdmin = await obtenerCategoriasCompleto();
      renderCategoriasLista();
      mostrarToast("Imagen actualizada.", "success");
    } catch (error) {
      mostrarToast("No se pudo subir la imagen.", "error");
    }
  });
  acciones.appendChild(inputImagen);

  const btnImagen = document.createElement("button");
  btnImagen.type = "button";
  btnImagen.className = "btn-secondary";
  btnImagen.style.width = "auto";
  btnImagen.style.padding = "0.3rem 0.65rem";
  btnImagen.style.fontSize = "0.78rem";
  btnImagen.textContent = "🖼️ Imagen";
  btnImagen.addEventListener("click", function () {
    inputImagen.click();
  });
  acciones.appendChild(btnImagen);

  const btnEliminar = document.createElement("button");
  btnEliminar.type = "button";
  btnEliminar.className = "btn-delete-var";
  btnEliminar.textContent = "🗑️";
  btnEliminar.addEventListener("click", function () {
    // El FK productos.categoria_id es "on delete set null": borrar acá
    // sin este chequeo dejaría productos huérfanos (fuera de todos los
    // chips salvo "Todos") sin ningún aviso.
    const productosEnCategoria = productosAdmin.filter(function (producto) {
      return producto.categoria_id === categoria.id;
    }).length;
    if (productosEnCategoria > 0) {
      mostrarToast("No se puede eliminar: hay " + productosEnCategoria + " producto(s) en esta categoría.", "error");
      return;
    }
    confirmarAccionDoble(btnEliminar, "¿Confirmar?", async function () {
      try {
        await eliminarCategoria(categoria.id);
        categoriasAdmin = await obtenerCategoriasCompleto();
        renderCategoriasLista();
        renderSelectsCategorias();
        mostrarToast("Categoría eliminada.", "success");
      } catch (error) {
        mostrarToast("No se pudo eliminar la categoría.", "error");
      }
    });
  });
  acciones.appendChild(btnEliminar);

  fila.appendChild(acciones);
}

function renderCategoriaRowEdicion(fila, categoria, indice, total) {
  while (fila.firstChild) {
    fila.removeChild(fila.firstChild);
  }

  const campos = document.createElement("div");
  campos.className = "vendedor-row-fields";

  const inputNombre = document.createElement("input");
  inputNombre.type = "text";
  inputNombre.className = "form-input";
  inputNombre.value = categoria.nombre;
  campos.appendChild(inputNombre);

  const inputIcono = document.createElement("input");
  inputIcono.type = "text";
  inputIcono.className = "form-input";
  inputIcono.style.maxWidth = "70px";
  inputIcono.maxLength = 4;
  inputIcono.placeholder = "🏷️";
  inputIcono.value = categoria.icono || "";
  campos.appendChild(inputIcono);

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
    if (!nombreNuevo) return;

    try {
      await actualizarCategoria(categoria.id, { nombre: nombreNuevo, icono: inputIcono.value.trim() || null });
      categoriasAdmin = await obtenerCategoriasCompleto();
      renderCategoriasLista();
      renderSelectsCategorias();
      mostrarToast("Categoría actualizada.", "success");
    } catch (error) {
      mostrarToast("No se pudo actualizar la categoría (¿nombre repetido?).", "error");
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
    renderCategoriaRowVista(fila, categoria, indice, total);
  });
  acciones.appendChild(btnCancelar);

  fila.appendChild(acciones);
}

// Intercambia el campo "orden" de una categoría con su vecina (arriba o
// abajo en la lista ya ordenada) en vez de drag-and-drop: alcanza para
// la cantidad de categorías que va a tener este catálogo.
async function moverCategoria(categoria, delta) {
  const ordenadas = categoriasAdmin.slice().sort(function (a, b) {
    return a.orden - b.orden;
  });
  const indice = ordenadas.findIndex(function (c) {
    return c.id === categoria.id;
  });
  const indiceVecino = indice + delta;
  if (indiceVecino < 0 || indiceVecino >= ordenadas.length) return;

  const vecino = ordenadas[indiceVecino];
  try {
    await Promise.all([
      actualizarCategoria(categoria.id, { orden: vecino.orden }),
      actualizarCategoria(vecino.id, { orden: categoria.orden }),
    ]);
    categoriasAdmin = await obtenerCategoriasCompleto();
    renderCategoriasLista();
  } catch (error) {
    mostrarToast("No se pudo reordenar la categoría.", "error");
  }
}

async function manejarSubmitAgregarCategoria(evento) {
  evento.preventDefault();

  const nombre = document.getElementById("categoria-nombre").value.trim();
  const icono = document.getElementById("categoria-icono").value.trim();
  const archivoImagen = document.getElementById("categoria-imagen").files[0];
  if (!nombre) return;

  try {
    const categoria = await crearCategoria(nombre, icono);
    if (archivoImagen) {
      const url = await subirImagenCategoria(categoria.id, archivoImagen);
      await actualizarCategoria(categoria.id, { imagen_url: url });
    }
    document.getElementById("form-add-categoria").reset();
    categoriasAdmin = await obtenerCategoriasCompleto();
    renderCategoriasLista();
    renderSelectsCategorias();
    mostrarToast("Categoría agregada.", "success");
  } catch (error) {
    mostrarToast(
      error && error.code === "23505" ? "Ya existe una categoría con ese nombre." : "No se pudo agregar la categoría.",
      "error"
    );
  }
}

// Llena los selects de categoría del alta y edición de producto. El de
// alta solo ofrece categorías activas (no tendría sentido asignar un
// producto nuevo a una ya desactivada); el de edición incluye también
// las inactivas, para que se siga viendo/pueda corregirse la categoría
// de un producto ya asignado a una que se desactivó después.
function renderSelectsCategorias() {
  poblarSelectCategoria(
    document.getElementById("new-product-category"),
    categoriasAdmin.filter(function (c) {
      return c.activo;
    })
  );
  poblarSelectCategoria(document.getElementById("edit-product-category"), categoriasAdmin);
}

function poblarSelectCategoria(select, categorias) {
  if (!select) return;
  while (select.options.length > 1) {
    select.remove(1);
  }
  categorias.forEach(function (categoria) {
    const opcion = document.createElement("option");
    opcion.value = categoria.id;
    opcion.textContent = categoria.nombre;
    select.appendChild(opcion);
  });
}

// ---------------------------------------------------------------------
// Permisos por rol: cada rol ve únicamente las pestañas que le
// corresponden (las políticas RLS de supabase/schema.sql bloquean
// además cualquier escritura fuera de su alcance, aunque alguien
// manipulara el DOM para revelar una pestaña oculta).
// - admin: todas las pestañas.
// - editor: carga catálogo (Stock y Precios, Categorías) y Vendedores,
//   pero no ve Gestión Pedidos ni Usuarios.
// - vendedora: solo Gestión Pedidos, de solo lectura.
// ---------------------------------------------------------------------

const TABS_POR_ROL = {
  admin: ["tab-stock", "tab-pedidos", "tab-vendedores", "tab-categorias", "tab-usuarios"],
  editor: ["tab-stock", "tab-vendedores", "tab-categorias"],
  vendedora: ["tab-pedidos"],
};

async function aplicarPermisosPorRol() {
  try {
    const usuario = await obtenerUsuarioActual();
    usuarioActualId = usuario ? usuario.id : null;
    const perfil = await obtenerPerfilActual();
    // Sin perfil asignado (por ejemplo, el admin histórico recién
    // migrado antes de correr el seed de supabase/schema.sql) se trata
    // como admin, para no dejarlo afuera del panel por accidente.
    rolActual = perfil ? perfil.rol : "admin";
    miVendedorId = perfil ? perfil.vendedor_id : null;
  } catch (error) {
    rolActual = "admin";
    miVendedorId = null;
  }

  // El reporte agregado por vendedor/a es información de todas las
  // sucursales: solo tiene sentido para el admin.
  const seccionReporte = document.getElementById("seccion-reporte-vendedor");
  if (seccionReporte) {
    seccionReporte.style.display = rolActual === "admin" ? "" : "none";
  }

  if (rolActual === "admin") {
    await cargarUsuariosAdmin();
    return;
  }

  // Para vendedora, las filas de Pedidos ya se dibujaron una vez en
  // cargarDatosAdmin() con el rol todavía sin resolver (admin por
  // default): se vuelven a pintar acá, ahora que se sabe el rol real y
  // el vendedor_id vinculado, para aplicar el filtro y los botones de
  // autoservicio correctos.
  if (rolActual === "vendedora") {
    renderTablasPedidos(pedidosAdmin);
  }

  const tabsPermitidas = TABS_POR_ROL[rolActual] || TABS_POR_ROL.vendedora;

  document.querySelectorAll(".admin-tab-btn").forEach(function (boton) {
    if (!tabsPermitidas.includes(boton.dataset.tab)) {
      boton.style.display = "none";
    }
  });

  const botonInicial = document.querySelector('.admin-tab-btn[data-tab="' + tabsPermitidas[0] + '"]');
  if (botonInicial) {
    botonInicial.click();
  }
}

// ---------------------------------------------------------------------
// Gestión de usuarios del panel (pestaña "Usuarios", solo rol admin)
// ---------------------------------------------------------------------

const ETIQUETAS_ROL = { admin: "Admin", editor: "Editor de Catálogo", vendedora: "Vendedora" };

function etiquetaRol(rol) {
  return ETIQUETAS_ROL[rol] || rol;
}

async function cargarUsuariosAdmin() {
  try {
    usuariosAdmin = await obtenerPerfilesAdmin();
    renderUsuariosLista();
    poblarSelectVendedorUsuario(document.getElementById("usuario-vendedor"), "");
  } catch (error) {
    // Si falla (por ejemplo, RLS bloqueando a alguien sin perfil todavía)
    // no debe romper el resto del panel: la pestaña de Usuarios
    // simplemente queda vacía.
  }
}

// Llena un <select> de vendedor/a (form de alta o fila en edición) con
// las opciones de vendedoresAdmin, conservando la primera opción fija
// ("— Ninguno —") que ya trae el HTML.
function poblarSelectVendedorUsuario(select, vendedorIdSeleccionado) {
  if (!select) return;

  while (select.options.length > 1) {
    select.remove(1);
  }

  vendedoresAdmin.forEach(function (vendedor) {
    const opcion = document.createElement("option");
    opcion.value = vendedor.id;
    opcion.textContent = vendedor.nombre_completo + " (" + vendedor.provincia + ")";
    opcion.selected = vendedorIdSeleccionado === vendedor.id;
    select.appendChild(opcion);
  });
}

// Nombre del vendedor/a vinculado a un usuario, para mostrarlo en la
// lista de Usuarios (usuariosAdmin no trae el nombre, solo el id).
function nombreVendedorVinculado(vendedorId) {
  if (!vendedorId) return null;
  const vendedor = vendedoresAdmin.find(function (v) {
    return v.id === vendedorId;
  });
  return vendedor ? vendedor.nombre_completo : null;
}

function renderUsuariosLista() {
  const contenedor = document.getElementById("usuarios-lista");
  while (contenedor.firstChild) {
    contenedor.removeChild(contenedor.firstChild);
  }

  if (usuariosAdmin.length === 0) {
    const vacio = document.createElement("p");
    vacio.style.color = "var(--color-text-light)";
    vacio.style.fontSize = "0.9rem";
    vacio.textContent = "Todavía no hay usuarios asignados.";
    contenedor.appendChild(vacio);
    return;
  }

  usuariosAdmin.forEach(function (usuario) {
    contenedor.appendChild(crearFilaUsuario(usuario));
  });
}

function crearFilaUsuario(usuario) {
  const fila = document.createElement("div");
  fila.className = "vendedor-row";
  renderUsuarioRowVista(fila, usuario);
  return fila;
}

function renderUsuarioRowVista(fila, usuario) {
  while (fila.firstChild) {
    fila.removeChild(fila.firstChild);
  }

  const esUsuarioActual = usuario.id === usuarioActualId;

  const info = document.createElement("div");
  info.className = "vendedor-row-info";

  const nombre = document.createElement("span");
  nombre.className = "vendedor-row-name";
  nombre.textContent = usuario.nombre + (esUsuarioActual ? " (vos)" : "");
  info.appendChild(nombre);

  const detalle = document.createElement("span");
  detalle.className = "vendedor-row-zeus";
  const nombreVendedor = nombreVendedorVinculado(usuario.vendedor_id);
  detalle.textContent =
    etiquetaRol(usuario.rol) + (nombreVendedor ? " · " + nombreVendedor : "") + (usuario.activo ? "" : " · Inactivo");
  info.appendChild(detalle);

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
    renderUsuarioRowEdicion(fila, usuario);
  });
  acciones.appendChild(btnEditar);

  // No se deja desactivar/eliminar el propio acceso desde acá: sin esto,
  // un admin podría quedarse afuera del panel sin forma de revertirlo
  // más que entrando directo a Supabase.
  if (!esUsuarioActual) {
    const btnToggleActivo = document.createElement("button");
    btnToggleActivo.type = "button";
    btnToggleActivo.className = "btn-secondary";
    btnToggleActivo.style.width = "auto";
    btnToggleActivo.style.padding = "0.3rem 0.65rem";
    btnToggleActivo.style.fontSize = "0.78rem";
    btnToggleActivo.textContent = usuario.activo ? "Desactivar" : "Activar";
    btnToggleActivo.addEventListener("click", async function () {
      try {
        await actualizarPerfilAdmin(usuario.id, { activo: !usuario.activo });
        await cargarUsuariosAdmin();
        mostrarToast(usuario.activo ? "Usuario desactivado." : "Usuario activado.", "success");
      } catch (error) {
        mostrarToast("No se pudo actualizar el usuario.", "error");
      }
    });
    acciones.appendChild(btnToggleActivo);

    const btnEliminar = document.createElement("button");
    btnEliminar.type = "button";
    btnEliminar.className = "btn-delete-var";
    btnEliminar.textContent = "🗑️";
    btnEliminar.addEventListener("click", function () {
      confirmarAccionDoble(btnEliminar, "¿Confirmar?", async function () {
        try {
          await eliminarPerfilAdmin(usuario.id);
          await cargarUsuariosAdmin();
          mostrarToast("Usuario eliminado del panel (la cuenta de Supabase sigue existiendo).", "success");
        } catch (error) {
          mostrarToast("No se pudo eliminar el usuario.", "error");
        }
      });
    });
    acciones.appendChild(btnEliminar);
  }

  fila.appendChild(acciones);
}

function renderUsuarioRowEdicion(fila, usuario) {
  while (fila.firstChild) {
    fila.removeChild(fila.firstChild);
  }

  const campos = document.createElement("div");
  campos.className = "vendedor-row-fields";

  const inputNombre = document.createElement("input");
  inputNombre.type = "text";
  inputNombre.className = "form-input";
  inputNombre.value = usuario.nombre;
  campos.appendChild(inputNombre);

  const selectRol = document.createElement("select");
  selectRol.className = "form-input";
  ["vendedora", "editor", "admin"].forEach(function (rol) {
    const opcion = document.createElement("option");
    opcion.value = rol;
    opcion.textContent = etiquetaRol(rol);
    opcion.selected = usuario.rol === rol;
    selectRol.appendChild(opcion);
  });
  // No se deja auto-degradar: si un admin se saca a sí mismo el rol de
  // admin y era el único, nadie podría volver a entrar al tab Usuarios.
  selectRol.disabled = usuario.id === usuarioActualId;
  campos.appendChild(selectRol);

  const selectVendedor = document.createElement("select");
  selectVendedor.className = "form-input";
  const opcionNinguno = document.createElement("option");
  opcionNinguno.value = "";
  opcionNinguno.textContent = "— Ninguno —";
  selectVendedor.appendChild(opcionNinguno);
  poblarSelectVendedorUsuario(selectVendedor, usuario.vendedor_id);
  campos.appendChild(selectVendedor);

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
    if (!nombreNuevo) return;

    try {
      await actualizarPerfilAdmin(usuario.id, {
        nombre: nombreNuevo,
        rol: selectRol.value,
        vendedor_id: selectVendedor.value || null,
      });
      await cargarUsuariosAdmin();
      mostrarToast("Usuario actualizado.", "success");
    } catch (error) {
      mostrarToast("No se pudo actualizar el usuario.", "error");
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
    renderUsuarioRowVista(fila, usuario);
  });
  acciones.appendChild(btnCancelar);

  fila.appendChild(acciones);
}

async function manejarSubmitAgregarUsuario(evento) {
  evento.preventDefault();

  const id = document.getElementById("usuario-id").value.trim();
  const nombre = document.getElementById("usuario-nombre").value.trim();
  const rol = document.getElementById("usuario-rol").value;
  const vendedorId = document.getElementById("usuario-vendedor").value || null;

  try {
    await crearPerfilAdmin(id, nombre, rol, vendedorId);
    document.getElementById("form-add-usuario").reset();
    await cargarUsuariosAdmin();
    mostrarToast("Usuario asignado correctamente.", "success");
  } catch (error) {
    mostrarToast(mensajeErrorCrearUsuario(error), "error");
  }
}

// Traduce los códigos de error de Postgres a un mensaje que dice
// exactamente qué falló, en vez de un genérico "verificá el ID" que
// tapa causas muy distintas (usuario duplicado, UUID inexistente en
// Auth, o un vendedor/a inválido).
function mensajeErrorCrearUsuario(error) {
  if (!error) return "No se pudo asignar el usuario.";

  if (error.code === "23505") {
    return "Ese usuario ya tiene un perfil asignado.";
  }

  // 23503 = foreign_key_violation. El detalle de Postgres dice qué
  // columna no encontró su referencia (id -> auth.users, o
  // vendedor_id -> vendedores).
  if (error.code === "23503") {
    const detalle = (error.details || error.message || "").toLowerCase();
    if (detalle.indexOf("vendedor_id") !== -1) {
      return "El vendedor/a elegido no existe (puede haber sido borrado). Recargá la página e intentá de nuevo.";
    }
    return 'Ese ID de usuario no existe en Supabase Auth. Verificá que copiaste el UUID completo desde el Dashboard (Authentication → Users → columna "UID").';
  }

  return "No se pudo asignar el usuario" + (error.message ? ": " + error.message : "") + ".";
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
