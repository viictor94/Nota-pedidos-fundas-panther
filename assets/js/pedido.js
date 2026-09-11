// =====================================================================
// Lógica de pedido.html: página pública de "mi pedido", a la que se
// llega por un link con ?id=<uuid del pedido>. Ofrece dos modos:
//
// - "Ver Pedido": solo lectura, para el cliente (y para reenviar el
//   link). Antes de finalizar el armado muestra todo el pedido tal
//   cual se hizo; una vez finalizado, separa lo que quedó disponible
//   (tildado por la vendedora) de lo que no había, y el total a pagar
//   sólo cuenta lo disponible.
// - "Preparar Pedido": para la vendedora, pide su N° de vendedor/a
//   (numero_zeus) y, si nadie más lo está preparando, permite tildar,
//   sacar (✕) o agregar artículos, e "Finalizar armado" para guardar
//   los cambios y habilitar de nuevo los botones de compartir.
//
// Reglas de código del proyecto (AGENTS.md): sin innerHTML (todo con
// createElement/appendChild), sin alert/confirm/prompt (los cuadros de
// confirmación son modales propios), preventDefault en todos los
// submits/clicks que lo necesiten.
// =====================================================================

const MAXIMO_PALABRAS_NOTA_PEDIDO = 30;

let pedidoActual = null;
let pedidoIdActual = null;
let itemsActuales = [];
let modoActual = null; // "ver" | "preparar"
let numeroVendedorActual = null;
let catalogoParaAgregarCache = null;

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
    itemsActuales = clonarItems(pedido.items);
    mostrarPedidoInicial(pedido);
  } catch (error) {
    mostrarNoEncontrado();
    return;
  }

  wireEventosEstaticos();
});

function clonarItems(items) {
  return (items || []).map(function (item) {
    return Object.assign({}, item);
  });
}

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
// Selector inicial: Ver Pedido / Preparar Pedido
// ---------------------------------------------------------------------

function mostrarPedidoInicial(pedido) {
  document.getElementById("pedido-cargando").style.display = "none";
  document.getElementById("pedido-contenido").style.display = "block";

  document.getElementById("pedido-fecha").textContent = new Date(pedido.created_at).toLocaleString("es-AR");
  document.getElementById("pedido-cliente-nombre").textContent = pedido.cliente_nombre;
  document.getElementById("pedido-cliente-telefono").textContent = pedido.cliente_telefono;
  document.getElementById("pedido-vendedor").textContent = pedido.vendedor_nombre || "Sin asignar";

  mostrarSelectorModo();
}

function mostrarSelectorModo() {
  modoActual = null;
  document.getElementById("pedido-selector-modo").style.display = "block";
  document.getElementById("pedido-bloqueado-aviso").style.display = "none";
  document.getElementById("btn-volver-modo").style.display = "none";
  document.getElementById("pedido-tabla-wrap").style.display = "none";
  document.getElementById("pedido-sin-stock-nota").style.display = "none";
  document.getElementById("pedido-preparar-controles").style.display = "none";
  document.getElementById("pedido-acciones-compartir").style.display = "none";
  document.getElementById("btn-imprimir-pedido").style.display = "none";
  document.getElementById("pedido-guardando-aviso").style.display = "none";
}

function entrarModoVer() {
  modoActual = "ver";
  document.getElementById("pedido-selector-modo").style.display = "none";
  document.getElementById("pedido-bloqueado-aviso").style.display = "none";
  document.getElementById("btn-volver-modo").style.display = "inline-flex";
  document.getElementById("pedido-tabla-wrap").style.display = "block";
  document.getElementById("pedido-preparar-controles").style.display = "none";
  document.getElementById("btn-imprimir-pedido").style.display = "none";
  document.getElementById("pedido-acciones-compartir").style.display = "flex";
  renderTablaVer(pedidoActual);
}

function entrarModoPreparar() {
  modoActual = "preparar";
  document.getElementById("pedido-selector-modo").style.display = "none";
  document.getElementById("pedido-bloqueado-aviso").style.display = "none";
  document.getElementById("btn-volver-modo").style.display = "inline-flex";
  document.getElementById("pedido-tabla-wrap").style.display = "block";
  document.getElementById("pedido-preparar-controles").style.display = "flex";
  document.getElementById("btn-imprimir-pedido").style.display = "inline-flex";
  document.getElementById("pedido-acciones-compartir").style.display = pedidoActual.armado_finalizado ? "flex" : "none";
  renderTablaPreparar();
}

function mostrarAvisoBloqueado(nombreQueLoTiene) {
  const aviso = document.getElementById("pedido-bloqueado-aviso");
  aviso.textContent = "🔒 El pedido está siendo preparado por " + nombreQueLoTiene + ". Mientras tanto, sólo podés verlo.";
  aviso.style.display = "block";
}

// ---------------------------------------------------------------------
// Agrupado y celdas comunes (compartidas entre modo Ver y Preparar)
// ---------------------------------------------------------------------

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

// Agrega las celdas SKU / Descripción (+ nota, si tiene) / Cantidad /
// Precio a una fila ya creada, comunes tanto al modo Ver como Preparar.
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

// ---------------------------------------------------------------------
// Modo "Ver Pedido" (solo lectura)
// ---------------------------------------------------------------------

function crearFilaVariantePedidoVer(item, marcado, finalizado) {
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

function renderTablaVer(pedido) {
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
      cuerpo.appendChild(crearFilaVariantePedidoVer(item, marcados[item.sku], finalizado));
    });
  });

  const totales = calcularTotales(itemsParaTotal);
  cuerpo.appendChild(crearFilaTotalPedido(totales.total, totales.cantidadArticulos));

  document.getElementById("pedido-sin-stock-nota").style.display = finalizado ? "block" : "none";
}

// ---------------------------------------------------------------------
// Modo "Preparar Pedido" (editable: tildar, sacar, agregar)
// ---------------------------------------------------------------------

function crearFilaVariantePedidoPreparar(item, marcado) {
  const fila = document.createElement("tr");
  if (marcado) {
    fila.className = "item-marcado";
  }

  const celdaCheck = document.createElement("td");
  celdaCheck.className = "celda-check";

  const controles = document.createElement("div");
  controles.className = "celda-check-controles";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(marcado);
  checkbox.setAttribute("aria-label", "Marcar " + item.sku + " como en stock");
  checkbox.addEventListener("change", function () {
    manejarCambioCheck(item.sku, checkbox, fila);
  });
  controles.appendChild(checkbox);

  const btnQuitar = document.createElement("button");
  btnQuitar.type = "button";
  btnQuitar.className = "btn-quitar-item";
  btnQuitar.title = "Sacar del pedido";
  btnQuitar.setAttribute("aria-label", "Sacar " + item.sku + " del pedido");
  btnQuitar.textContent = "✕";
  btnQuitar.addEventListener("click", function () {
    quitarItemDelPedido(item.sku);
  });
  controles.appendChild(btnQuitar);

  celdaCheck.appendChild(controles);
  fila.appendChild(celdaCheck);

  agregarCeldasComunes(fila, item);
  return fila;
}

function renderTablaPreparar() {
  const cuerpo = document.getElementById("pedido-items-table-body");
  limpiarTbody(cuerpo);

  const marcados = pedidoActual.items_marcados || {};

  agruparItemsPorProducto(itemsActuales).forEach(function (grupo) {
    cuerpo.appendChild(crearFilaGrupoProducto(grupo.nombre));
    grupo.items.forEach(function (item) {
      cuerpo.appendChild(crearFilaVariantePedidoPreparar(item, marcados[item.sku]));
    });
  });

  const totales = calcularTotales(itemsActuales);
  cuerpo.appendChild(crearFilaTotalPedido(totales.total, totales.cantidadArticulos));

  document.getElementById("pedido-sin-stock-nota").style.display = "none";
}

function quitarItemDelPedido(sku) {
  itemsActuales = itemsActuales.filter(function (item) {
    return item.sku !== sku;
  });
  renderTablaPreparar();
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
    pedidoActual.items_marcados = pedidoActual.items_marcados || {};
    pedidoActual.items_marcados[sku] = marcado;
  } catch (error) {
    checkbox.checked = !marcado;
    fila.classList.toggle("item-marcado", !marcado);
    mostrarErrorGuardadoCheck();
  } finally {
    checkbox.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Modal: N° de vendedor/a para entrar a "Preparar Pedido"
// ---------------------------------------------------------------------

function abrirModalNumeroVendedor() {
  document.getElementById("numero-vendedor-error").style.display = "none";
  // Si ya se validó un número en esta misma visita, se precarga (por si
  // volvió al selector sin querer) pero igual pide confirmar.
  document.getElementById("input-numero-vendedor").value = numeroVendedorActual || "";
  mostrarModalPedido(document.getElementById("modal-numero-vendedor"));
  document.getElementById("input-numero-vendedor").focus();
}

async function manejarSubmitNumeroVendedor(evento) {
  evento.preventDefault();

  const numero = document.getElementById("input-numero-vendedor").value.trim();
  const errorBox = document.getElementById("numero-vendedor-error");

  if (!numero) {
    errorBox.textContent = "Ingresá tu número de vendedor/a.";
    errorBox.style.display = "block";
    return;
  }

  try {
    const resultado = await iniciarArmadoPedido(pedidoIdActual, numero);
    if (resultado.ok) {
      numeroVendedorActual = numero;
      ocultarModalPedido(document.getElementById("modal-numero-vendedor"));
      pedidoActual.preparado_por_id = resultado.vendedor_id;
      pedidoActual.preparado_por_nombre = resultado.vendedor_nombre;
      entrarModoPreparar();
      return;
    }

    if (resultado.motivo === "bloqueado") {
      ocultarModalPedido(document.getElementById("modal-numero-vendedor"));
      entrarModoVer();
      mostrarAvisoBloqueado(resultado.bloqueado_por);
      return;
    }

    errorBox.textContent = "Número de vendedor/a inválido.";
    errorBox.style.display = "block";
  } catch (error) {
    errorBox.textContent = "No se pudo validar el número. Probá de nuevo.";
    errorBox.style.display = "block";
  }
}

// ---------------------------------------------------------------------
// Modal: agregar producto/variante que no estaba en el pedido
// ---------------------------------------------------------------------

async function abrirModalAgregarProducto() {
  const errorBox = document.getElementById("agregar-producto-error");
  errorBox.style.display = "none";

  if (!catalogoParaAgregarCache) {
    try {
      catalogoParaAgregarCache = await obtenerCatalogo();
    } catch (error) {
      catalogoParaAgregarCache = [];
      errorBox.textContent = "No se pudo cargar el catálogo. Probá de nuevo.";
      errorBox.style.display = "block";
    }
  }

  poblarSelectProductosAgregar();
  document.getElementById("input-agregar-cantidad").value = "1";

  const textareaNota = document.getElementById("textarea-agregar-nota");
  textareaNota.value = "";
  actualizarContadorNotaAgregar();

  mostrarModalPedido(document.getElementById("modal-agregar-producto"));
}

function poblarSelectProductosAgregar() {
  const select = document.getElementById("select-agregar-producto");
  while (select.firstChild) {
    select.removeChild(select.firstChild);
  }

  catalogoParaAgregarCache.forEach(function (producto) {
    const opcion = document.createElement("option");
    opcion.value = producto.id;
    opcion.textContent = producto.nombre;
    select.appendChild(opcion);
  });

  poblarSelectVariantesAgregar();
}

function poblarSelectVariantesAgregar() {
  const selectProducto = document.getElementById("select-agregar-producto");
  const selectVariante = document.getElementById("select-agregar-variante");
  while (selectVariante.firstChild) {
    selectVariante.removeChild(selectVariante.firstChild);
  }

  const producto = (catalogoParaAgregarCache || []).find(function (p) {
    return p.id === selectProducto.value;
  });
  if (!producto) {
    return;
  }

  producto.variantes.forEach(function (variante) {
    const opcion = document.createElement("option");
    opcion.value = variante.id;
    opcion.textContent = variante.sku + " - " + variante.modelo + " (" + formatearMoneda(variante.precio_actual) + ")";
    selectVariante.appendChild(opcion);
  });
}

function contarPalabrasPedido(texto) {
  const limpio = (texto || "").trim();
  return limpio === "" ? 0 : limpio.split(/\s+/).length;
}

function limitarPalabrasPedido(textarea, maximo) {
  const palabras = textarea.value
    .trim()
    .split(/\s+/)
    .filter(function (p) {
      return p !== "";
    });
  if (palabras.length > maximo) {
    textarea.value = palabras.slice(0, maximo).join(" ");
  }
}

function actualizarContadorNotaAgregar() {
  const textarea = document.getElementById("textarea-agregar-nota");
  limitarPalabrasPedido(textarea, MAXIMO_PALABRAS_NOTA_PEDIDO);
  document.getElementById("agregar-nota-contador").textContent = contarPalabrasPedido(textarea.value) + "/" + MAXIMO_PALABRAS_NOTA_PEDIDO + " palabras";
}

function manejarClickConfirmarAgregar() {
  const errorBox = document.getElementById("agregar-producto-error");
  const selectProducto = document.getElementById("select-agregar-producto");
  const selectVariante = document.getElementById("select-agregar-variante");
  const cantidad = parseInt(document.getElementById("input-agregar-cantidad").value, 10);
  const nota = document.getElementById("textarea-agregar-nota").value.trim();

  const producto = (catalogoParaAgregarCache || []).find(function (p) {
    return p.id === selectProducto.value;
  });
  const variante = producto
    ? producto.variantes.find(function (v) {
        return v.id === selectVariante.value;
      })
    : null;

  if (!producto || !variante) {
    errorBox.textContent = "Elegí una funda y una variante.";
    errorBox.style.display = "block";
    return;
  }
  if (!cantidad || cantidad < 1) {
    errorBox.textContent = "La cantidad debe ser al menos 1.";
    errorBox.style.display = "block";
    return;
  }
  errorBox.style.display = "none";

  agregarItemAlPedido(producto, variante, cantidad, nota);
  ocultarModalPedido(document.getElementById("modal-agregar-producto"));
}

function agregarItemAlPedido(producto, variante, cantidad, nota) {
  const existente = itemsActuales.find(function (item) {
    return item.sku === variante.sku;
  });

  if (existente) {
    existente.cantidad += cantidad;
    if (nota) {
      existente.nota = nota;
    }
  } else {
    itemsActuales.push({
      productoId: producto.id,
      productoNombre: producto.nombre,
      varianteId: variante.id,
      sku: variante.sku,
      modelo: variante.modelo,
      precioUnitario: variante.precio_actual,
      cantidad: cantidad,
      nota: nota || "",
    });
  }

  renderTablaPreparar();
}

// ---------------------------------------------------------------------
// Finalizar armado
// ---------------------------------------------------------------------

function itemsEquivalentes(itemsA, itemsB) {
  const normalizar = function (items) {
    return (items || [])
      .map(function (item) {
        return item.sku + ":" + item.cantidad;
      })
      .sort()
      .join("|");
  };
  return normalizar(itemsA) === normalizar(itemsB);
}

function abrirModalConfirmarFinalizar() {
  const itemsOriginales = pedidoActual.items_original || pedidoActual.items;
  const hayModificaciones = !itemsEquivalentes(itemsActuales, itemsOriginales);

  document.getElementById("texto-confirmar-finalizar").textContent = hayModificaciones
    ? "¿Deseás actualizar y finalizar el armado del pedido?"
    : "¿Deseás finalizar el armado del pedido?";

  mostrarModalPedido(document.getElementById("modal-confirmar-finalizar"));
}

async function manejarClickConfirmarFinalizar() {
  ocultarModalPedido(document.getElementById("modal-confirmar-finalizar"));

  const aviso = document.getElementById("pedido-guardando-aviso");
  aviso.style.display = "block";

  const totales = calcularTotales(itemsActuales);

  try {
    await actualizarItemsPedido(pedidoIdActual, itemsActuales, totales.total, totales.cantidadArticulos, numeroVendedorActual);
    await finalizarArmadoPedido(pedidoIdActual, numeroVendedorActual);

    pedidoActual.items = clonarItems(itemsActuales);
    pedidoActual.total = totales.total;
    pedidoActual.cantidad_articulos = totales.cantidadArticulos;
    pedidoActual.armado_finalizado = true;
    pedidoActual.preparado_por_id = null;
    pedidoActual.preparado_por_nombre = null;

    aviso.style.display = "none";
    document.getElementById("pedido-acciones-compartir").style.display = "flex";
    mostrarCopiadoConfirmacion();
  } catch (error) {
    aviso.style.display = "none";
    mostrarErrorGuardadoCheck();
  }
}

// ---------------------------------------------------------------------
// Compartir / copiar el link del pedido
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// Modales genéricos y wiring de eventos estáticos
// ---------------------------------------------------------------------

function mostrarModalPedido(modal) {
  modal.classList.add("visible");
}

function ocultarModalPedido(modal) {
  modal.classList.remove("visible");
}

function wireEventosEstaticos() {
  document.getElementById("btn-modo-ver").addEventListener("click", function () {
    entrarModoVer();
  });

  document.getElementById("btn-modo-preparar").addEventListener("click", function () {
    abrirModalNumeroVendedor();
  });

  document.getElementById("btn-volver-modo").addEventListener("click", function () {
    mostrarSelectorModo();
  });

  document.getElementById("btn-cerrar-modal-numero").addEventListener("click", function () {
    ocultarModalPedido(document.getElementById("modal-numero-vendedor"));
  });
  document.getElementById("form-numero-vendedor").addEventListener("submit", manejarSubmitNumeroVendedor);

  document.getElementById("btn-agregar-producto").addEventListener("click", function () {
    abrirModalAgregarProducto();
  });
  document.getElementById("btn-cerrar-modal-agregar").addEventListener("click", function () {
    ocultarModalPedido(document.getElementById("modal-agregar-producto"));
  });
  document.getElementById("select-agregar-producto").addEventListener("change", function () {
    poblarSelectVariantesAgregar();
  });
  document.getElementById("textarea-agregar-nota").addEventListener("input", function () {
    actualizarContadorNotaAgregar();
  });
  document.getElementById("btn-confirmar-agregar-producto").addEventListener("click", function () {
    manejarClickConfirmarAgregar();
  });

  document.getElementById("btn-finalizar-armado").addEventListener("click", function () {
    abrirModalConfirmarFinalizar();
  });
  document.getElementById("btn-cancelar-finalizar").addEventListener("click", function () {
    ocultarModalPedido(document.getElementById("modal-confirmar-finalizar"));
  });
  document.getElementById("btn-confirmar-finalizar").addEventListener("click", function () {
    manejarClickConfirmarFinalizar();
  });

  document.getElementById("btn-compartir-vendedor").addEventListener("click", function () {
    compartirPedidoLink();
  });
  document.getElementById("btn-compartir-generico").addEventListener("click", function () {
    copiarEnlacePedido();
  });
  document.getElementById("btn-imprimir-pedido").addEventListener("click", function () {
    window.print();
  });
}
