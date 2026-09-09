// =====================================================================
// Lógica del catálogo cliente (index.html): render de productos,
// carrito en memoria, checkout y envío del link del pedido por
// WhatsApp (pedido.html, en vez de generar PDF/Excel en el navegador:
// resultó poco confiable en varios celulares).
//
// Reglas de código del proyecto (AGENTS.md): sin innerHTML (todo con
// createElement/appendChild), sin alert/confirm/prompt (todo feedback
// visual en el DOM), preventDefault en todos los submits/clicks que lo
// necesiten.
// =====================================================================

// ---------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------

const PRODUCTOS_POR_PAGINA = 8; // cuántos se muestran al cargar la página
const INCREMENTO_SCROLL = 4; // cuántos se suman cada vez que el scroll llega al final

let catalogoCompleto = []; // Productos con variantes, tal como vienen de Supabase.
let configuracionApp = { whatsapp_vendedor: "" };
let productosVisibles = PRODUCTOS_POR_PAGINA;
let vendedoresDisponibles = []; // Para el desplegable opcional "Vendedor/a preferido/a" del checkout.

// Carrito: mapa varianteId -> { productoId, productoNombre, varianteId, sku, modelo, precioUnitario, cantidad }
let carrito = {};

// Producto actualmente abierto en el modal de variantes.
let productoEnModal = null;

// Último pedido confirmado (para los botones del modal de éxito).
let ultimoPedido = null;

// ---------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async function () {
  wireEventosEstaticos();

  try {
    const [catalogo, config] = await Promise.all([obtenerCatalogo(), obtenerConfig()]);
    catalogoCompleto = ordenarDestacadosPrimero(catalogo);
    configuracionApp = config;
    actualizarTextoUltimaActualizacion(config.catalogo_actualizado_en);
    renderCatalogo();
  } catch (error) {
    mostrarErrorCatalogo();
  } finally {
    ocultarPantallaCarga();
  }

  // Aparte del catálogo: si falla (RPC caída, sin red) el checkout debe
  // seguir funcionando igual, solo que sin la opción de elegir
  // vendedor/a (queda sin asignar hasta que el admin lo haga a mano).
  try {
    vendedoresDisponibles = await obtenerVendedoresPublico();
    renderSelectVendedores();
  } catch (error) {
    // Ver comentario de arriba: no es un error que deba frenar la compra.
  }

  // Mantiene el catálogo al día si el admin cambia algo mientras el
  // cliente tiene la página abierta. Si la suscripción en sí falla (sin
  // conexión, websockets bloqueados, etc.), el catálogo ya cargado
  // sigue siendo utilizable: no debe romper el resto de la página.
  try {
    suscribirCambiosCatalogo(async function () {
      try {
        const [catalogo, config] = await Promise.all([obtenerCatalogo(), obtenerConfig()]);
        catalogoCompleto = ordenarDestacadosPrimero(catalogo);
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

// Los productos marcados "en_promo" o "es_nuevo" desde el admin se
// muestran primero en el Catálogo Completo (promo antes que nuevo),
// para potenciar su venta; ninguno se excluye de la grilla, solo se
// reordena. Dentro de cada grupo se conserva el orden que ya trae la
// consulta (por "orden" y luego nombre).
function ordenarDestacadosPrimero(catalogo) {
  function puntaje(producto) {
    if (producto.en_promo) return 2;
    if (producto.es_nuevo) return 1;
    return 0;
  }
  return catalogo.slice().sort(function (a, b) {
    return puntaje(b) - puntaje(a);
  });
}

// Precio "tachado" (viejo) que se muestra junto al precio actual para
// dar sensación de descuento. Prioridad:
// 1. El precio_anterior real que haya cargado el admin para esa
//    variante puntual (uno por uno, o con "aplicar a todas").
// 2. Si no cargó ninguno, se calcula como un porcentaje por encima
//    del precio actual (20% normal, 35% si está en_promo).
// Los productos "es_nuevo" nunca llevan precio tachado (recién
// llegan, no hay "antes" que mostrar).
function calcularPrecioTachado(variante, producto) {
  if (producto.es_nuevo) {
    return null;
  }
  if (variante.precio_anterior && variante.precio_anterior > variante.precio_actual) {
    return variante.precio_anterior;
  }
  const factor = producto.en_promo ? 1.35 : 1.2;
  return variante.precio_actual * factor;
}

function formatearMoneda(numero) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(numero));
}

// Llena el desplegable opcional del checkout con los vendedores activos
// (id/nombre/provincia, vía la RPC pública obtener_vendedores_publico).
// Conserva la primera opción ("Sin preferencia...") que ya trae el HTML.
function renderSelectVendedores() {
  const select = document.getElementById("customer-vendedor");
  if (!select) return;

  while (select.options.length > 1) {
    select.remove(1);
  }

  vendedoresDisponibles.forEach(function (vendedor) {
    const opcion = document.createElement("option");
    opcion.value = vendedor.id;
    opcion.textContent = vendedor.nombre_completo + " (" + vendedor.provincia + ")";
    select.appendChild(opcion);
  });
}

// Valida que el teléfono tenga una cantidad de dígitos razonable para
// un número argentino (sin exigir un formato exacto, porque la gente lo
// escribe con espacios, guiones o +54 de formas muy distintas). Antes
// no había ningún control y se podía cargar, por ejemplo, un número de
// 25 dígitos sin que nada lo impidiera.
function telefonoEsValido(texto) {
  const soloDigitos = (texto || "").replace(/\D/g, "");
  return soloDigitos.length >= 8 && soloDigitos.length <= 13;
}

function mostrarErrorCampo(idError) {
  const error = document.getElementById(idError);
  if (error) {
    error.hidden = false;
  }
}

function ocultarErrorCampo(idError) {
  const error = document.getElementById(idError);
  if (error) {
    error.hidden = true;
  }
}

function actualizarTextoUltimaActualizacion(fechaIso) {
  const texto = document.getElementById("last-updated-text");
  if (!texto) return;
  const fecha = new Date(fechaIso);
  texto.textContent = fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Se llama una sola vez (éxito o error) apenas responde Supabase, para
// no dejar al cliente mirando una pantalla en blanco mientras carga.
function ocultarPantallaCarga() {
  const overlay = document.getElementById("app-loading-overlay");
  if (overlay) {
    overlay.remove();
  }
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
  configurarScrollInfinito();
  configurarCarruseles();

  document.getElementById("btn-close-modal").addEventListener("click", cerrarModalVariantes);
  document.getElementById("btn-modal-listo").addEventListener("click", cerrarModalVariantes);

  document.getElementById("checkout-form").addEventListener("submit", manejarSubmitCheckout);

  document.getElementById("btn-share-vendor").addEventListener("click", function () {
    compartirPedido({ abrirWhatsappVendedor: true });
  });
  document.getElementById("btn-share-generic").addEventListener("click", function () {
    compartirPedido({ abrirWhatsappVendedor: false });
  });
  document.getElementById("btn-close-success").addEventListener("click", function () {
    ocultarModal(document.getElementById("success-modal"));
    reiniciarDespuesDePedido();
  });

  configurarBienvenida();
}

// ---------------------------------------------------------------------
// Render del catálogo
// ---------------------------------------------------------------------

function renderCatalogo() {
  renderCarruseles();

  const grid = document.getElementById("catalog-grid");
  while (grid.firstChild) {
    grid.removeChild(grid.firstChild);
  }

  const visibles = catalogoCompleto.slice(0, productosVisibles);
  visibles.forEach(function (producto) {
    grid.appendChild(crearTarjetaProducto(producto));
  });

  const restantes = catalogoCompleto.length - visibles.length;
  if (restantes > 0) {
    mostrarMensajeCarga("Deslizá hacia abajo para ver más fundas ↓");
  } else {
    mostrarMensajeCarga(catalogoCompleto.length > 0 ? "Viste todo el catálogo ✓" : "");
  }
}

// Reemplaza el contenido del cartel al pie de la grilla por texto
// simple (hay más para ver / se vio todo el catálogo).
function mostrarMensajeCarga(texto) {
  const estado = document.getElementById("catalog-load-status");
  while (estado.firstChild) {
    estado.removeChild(estado.firstChild);
  }
  estado.appendChild(document.createTextNode(texto));
}

// Mientras se preparan más productos se muestra un spinner: sin este
// cartel, al llegar al final del scroll no hay ninguna señal de que
// falten más fundas por ver (parece que el catálogo ya terminó).
function mostrarSpinnerCarga() {
  const estado = document.getElementById("catalog-load-status");
  while (estado.firstChild) {
    estado.removeChild(estado.firstChild);
  }
  const spinner = document.createElement("span");
  spinner.className = "spinner spinner-inline";
  estado.appendChild(spinner);
  estado.appendChild(document.createTextNode("Cargando más fundas..."));
}

// Scroll infinito: en vez de un botón "Cargar más", se observa un
// elemento sentinela al pie de la grilla; cuando entra en pantalla se
// revela otra tanda de productos (ya están todos en memoria, no hace
// falta pedirlos de nuevo a Supabase).
function configurarScrollInfinito() {
  const sentinela = document.getElementById("catalog-load-status");
  const observador = new IntersectionObserver(function (entradas) {
    if (entradas[0].isIntersecting) {
      cargarMasProductos();
    }
  }, { rootMargin: "300px" });
  observador.observe(sentinela);
}

let cargandoMasProductos = false;

function cargarMasProductos() {
  if (cargandoMasProductos || productosVisibles >= catalogoCompleto.length) {
    return;
  }
  cargandoMasProductos = true;
  mostrarSpinnerCarga();
  // Demora artificial breve: los productos ya están en memoria (no hay
  // pedido real a Supabase), pero sin esta pausa el cambio es
  // instantáneo y el spinner ni llega a verse.
  setTimeout(function () {
    productosVisibles += INCREMENTO_SCROLL;
    cargandoMasProductos = false;
    renderCatalogo();
  }, 350);
}

// Estado de cada carrusel 3D (coverflow): qué producto está al frente
// (activo) y referencia a su track en el DOM. "productos" se actualiza
// en cada render para que las flechas y los clicks sepan hasta dónde
// pueden moverse.
// "centrado" marca si ya se hizo el posicionamiento inicial en la
// tarjeta del medio (ver renderCoverflow): solo pasa una vez, después
// el activo lo maneja el cliente (flechas, swipe o click).
const estadoCoverflowPromos = { activo: 0, productos: [], track: null, centrado: false };
const estadoCoverflowNuevos = { activo: 0, productos: [], track: null, centrado: false };

// Cachea el track de cada carrusel y conecta las flechas ‹ › y el
// swipe táctil que mueven manualmente cuál producto queda al frente.
function configurarCarruseles() {
  estadoCoverflowPromos.track = document.getElementById("carousel-promos");
  estadoCoverflowNuevos.track = document.getElementById("carousel-nuevos");

  document.getElementById("arrow-left-promos").addEventListener("click", function () {
    moverCoverflow(estadoCoverflowPromos, -1);
  });
  document.getElementById("arrow-right-promos").addEventListener("click", function () {
    moverCoverflow(estadoCoverflowPromos, 1);
  });
  document.getElementById("arrow-left-nuevos").addEventListener("click", function () {
    moverCoverflow(estadoCoverflowNuevos, -1);
  });
  document.getElementById("arrow-right-nuevos").addEventListener("click", function () {
    moverCoverflow(estadoCoverflowNuevos, 1);
  });

  agregarSoporteSwipe(estadoCoverflowPromos.track, estadoCoverflowPromos);
  agregarSoporteSwipe(estadoCoverflowNuevos.track, estadoCoverflowNuevos);
}

// Navegación por gesto táctil: deslizar el dedo hacia la izquierda
// avanza a la siguiente tarjeta, hacia la derecha retrocede. Es la
// forma principal de navegar en celular (las flechas quedan como
// alternativa). Si el gesto es más horizontal que vertical se frena el
// scroll de la página mientras dura, para que no compitan entre sí.
function agregarSoporteSwipe(elemento, estado) {
  let inicioX = 0;
  let inicioY = 0;
  let enCurso = false;

  elemento.addEventListener(
    "touchstart",
    function (evento) {
      const toque = evento.touches[0];
      inicioX = toque.clientX;
      inicioY = toque.clientY;
      enCurso = true;
    },
    { passive: true }
  );

  elemento.addEventListener(
    "touchmove",
    function (evento) {
      if (!enCurso) return;
      const toque = evento.touches[0];
      const deltaX = toque.clientX - inicioX;
      const deltaY = toque.clientY - inicioY;
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        evento.preventDefault();
      }
    },
    { passive: false }
  );

  elemento.addEventListener("touchend", function (evento) {
    if (!enCurso) return;
    enCurso = false;

    const toque = evento.changedTouches[0];
    const deltaX = toque.clientX - inicioX;
    const deltaY = toque.clientY - inicioY;
    const UMBRAL_PX = 35;

    if (Math.abs(deltaX) > UMBRAL_PX && Math.abs(deltaX) > Math.abs(deltaY)) {
      moverCoverflow(estado, deltaX < 0 ? 1 : -1);
    }
  });
}

// Arma los carruseles "Promos del Día" y "Nuevos Ingresos" a partir de
// los carteles que tilda el admin; cada uno se oculta si no hay ningún
// producto marcado. Ninguno se saca de la grilla de abajo: ver
// ordenarDestacadosPrimero.
function renderCarruseles() {
  renderCoverflow(
    "carousel-promos-wrap",
    estadoCoverflowPromos,
    catalogoCompleto.filter(function (p) {
      return p.en_promo;
    })
  );
  renderCoverflow(
    "carousel-nuevos-wrap",
    estadoCoverflowNuevos,
    catalogoCompleto.filter(function (p) {
      return p.es_nuevo;
    })
  );
}

function renderCoverflow(idWrap, estado, productos) {
  const wrap = document.getElementById(idWrap);
  const track = estado.track;

  while (track.firstChild) {
    track.removeChild(track.firstChild);
  }

  // La primera vez que este carrusel recibe productos arranca centrado
  // en el del medio del set (no en el primero), para que el cliente
  // pueda elegir deslizar hacia cualquiera de los dos lados en vez de
  // quedar pegado contra el borde izquierdo.
  if (!estado.centrado && productos.length > 0) {
    estado.activo = Math.floor((productos.length - 1) / 2);
    estado.centrado = true;
  }

  estado.productos = productos;

  if (productos.length === 0) {
    wrap.style.display = "none";
    return;
  }

  wrap.style.display = "block";
  if (estado.activo >= productos.length) {
    estado.activo = productos.length - 1;
  }

  productos.forEach(function (producto, indice) {
    track.appendChild(crearTarjetaCoverflow(producto, indice, estado));
  });

  actualizarPosicionesCoverflow(estado);
}

// Mueve manualmente el carrusel (flechas ‹ ›), sin pasarse de los
// extremos.
function moverCoverflow(estado, delta) {
  if (estado.productos.length === 0) return;
  estado.activo = Math.max(0, Math.min(estado.productos.length - 1, estado.activo + delta));
  actualizarPosicionesCoverflow(estado);
}

// Acomoda cada tarjeta según su distancia a la que está "al frente":
// la activa queda grande y de frente, las de los costados más chicas,
// tenues e inclinadas (efecto 3D tipo coverflow). Se calcula todo acá
// (no con CSS puro) porque la posición depende de cuál está activa,
// algo que cambia con cada click/flecha.
function actualizarPosicionesCoverflow(estado) {
  const tarjetas = estado.track.children;

  for (let i = 0; i < tarjetas.length; i++) {
    const offset = i - estado.activo;
    const distancia = Math.abs(offset);
    const tarjeta = tarjetas[i];

    const traslado = offset * 68;
    const escala = offset === 0 ? 1 : Math.max(0.6, 1 - distancia * 0.16);
    const rotacion = offset === 0 ? 0 : offset > 0 ? -20 : 20;
    const opacidad = distancia === 0 ? 1 : distancia === 1 ? 0.75 : distancia === 2 ? 0.4 : 0;

    tarjeta.style.transform =
      "translate(-50%, -50%) translateX(" + traslado + "px) scale(" + escala + ") rotateY(" + rotacion + "deg)";
    tarjeta.style.opacity = String(opacidad);
    tarjeta.style.zIndex = String(100 - distancia);
    tarjeta.style.pointerEvents = distancia <= 2 ? "auto" : "none";
  }
}

// Tarjeta del carrusel 3D: si ya está al frente, tocarla abre el
// modal de variantes (como en la grilla); si está a un costado, el
// click la trae al frente en vez de abrir el modal.
function crearTarjetaCoverflow(producto, indice, estado) {
  const tarjeta = construirTarjetaBase(producto);
  tarjeta.addEventListener("click", function () {
    if (estado.activo === indice) {
      abrirModalVariantes(producto);
    } else {
      estado.activo = indice;
      actualizarPosicionesCoverflow(estado);
    }
  });
  return tarjeta;
}

function crearTarjetaProducto(producto) {
  const tarjeta = construirTarjetaBase(producto);
  tarjeta.addEventListener("click", function () {
    abrirModalVariantes(producto);
  });
  return tarjeta;
}

// Arma el DOM de una tarjeta de producto (foto, carteles, nombre,
// precios), sin el listener de click: crearTarjetaProducto (grilla) y
// crearTarjetaCoverflow (carruseles) le agregan cada uno el suyo,
// porque el click hace cosas distintas en cada contexto.
function construirTarjetaBase(producto) {
  // Se necesita la variante más barata completa (no solo su precio)
  // para poder mostrar su precio_anterior real si el admin lo cargó.
  const varianteMasBarata = producto.variantes.reduce(function (min, v) {
    return v.precio_actual < min.precio_actual ? v : min;
  }, producto.variantes[0]);
  const precioMasBarato = varianteMasBarata.precio_actual;

  const tarjeta = document.createElement("article");
  tarjeta.className = "product-card" + (producto.en_promo ? " product-card-promo" : "");

  const imagenWrap = document.createElement("div");
  imagenWrap.className = "product-card-image-wrap";

  if (producto.es_nuevo) {
    const cartelNuevo = document.createElement("span");
    cartelNuevo.className = "nuevo-badge";
    cartelNuevo.textContent = "🆕 NUEVO";
    imagenWrap.appendChild(cartelNuevo);
  }

  if (producto.en_promo) {
    const cartelPromo = document.createElement("span");
    cartelPromo.className = "promo-badge";
    cartelPromo.textContent = "🔥 PROMO";
    imagenWrap.appendChild(cartelPromo);
  }

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

  const bloquePrecio = document.createElement("div");
  bloquePrecio.className = "product-card-price-block";

  const labelDesde = document.createElement("span");
  labelDesde.className = "product-card-price-label";
  labelDesde.textContent = "Desde";
  bloquePrecio.appendChild(labelDesde);

  const precioTachado = calcularPrecioTachado(varianteMasBarata, producto);
  if (precioTachado !== null) {
    const viejo = document.createElement("span");
    viejo.className = "product-card-price-old";
    viejo.textContent = formatearMoneda(precioTachado);
    bloquePrecio.appendChild(viejo);
  }

  const precio = document.createElement("p");
  precio.className = "product-card-price";
  precio.textContent = formatearMoneda(precioMasBarato);
  bloquePrecio.appendChild(precio);

  cuerpo.appendChild(bloquePrecio);
  tarjeta.appendChild(cuerpo);

  return tarjeta;
}

// ---------------------------------------------------------------------
// Modal de variantes
// ---------------------------------------------------------------------

function abrirModalVariantes(producto) {
  productoEnModal = producto;

  const prefijo = (producto.en_promo ? "🔥 " : "") + (producto.es_nuevo ? "🆕 " : "");
  document.getElementById("modal-product-title").textContent = prefijo + producto.nombre;
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

  const filaPrecio = document.createElement("div");
  filaPrecio.className = "variant-item-price-row";

  const precioTachado = calcularPrecioTachado(variante, producto);
  if (precioTachado !== null) {
    const viejo = document.createElement("span");
    viejo.className = "variant-item-price-old";
    viejo.textContent = formatearMoneda(precioTachado);
    filaPrecio.appendChild(viejo);
  }

  const precio = document.createElement("span");
  precio.className = "variant-item-price";
  precio.textContent = formatearMoneda(variante.precio_actual);
  filaPrecio.appendChild(precio);

  info.appendChild(filaPrecio);

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
  // El botón flotante "Terminar Pedido" no tiene sentido estando ya en
  // el checkout (ahí está "Confirmar Pedido"): se oculta para no
  // duplicar la acción en pantalla.
  document.getElementById("sticky-cart").classList.remove("visible");
  renderResumenCarrito();
  // Sin esto la vista queda donde estaba scrolleada en el catálogo (a
  // veces bien abajo), y el checkout parece arrancar "cortado".
  window.scrollTo(0, 0);
}

function volverAlCatalogo() {
  document.getElementById("checkout-section").classList.remove("active");
  document.getElementById("catalog-section").classList.add("active");
  actualizarUiCarrito();
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

  const telefono = document.getElementById("customer-phone").value.trim();
  if (!telefonoEsValido(telefono)) {
    mostrarErrorCampo("customer-phone-error");
    return;
  }
  ocultarErrorCampo("customer-phone-error");

  const boton = document.getElementById("btn-confirm-order");
  boton.disabled = true;

  try {
    const stockOk = await verificarStockVigente();
    if (!stockOk) {
      return;
    }

    const nombre = document.getElementById("customer-name").value.trim();

    // Si el cliente no eligió vendedor/a preferido, se le asigna
    // automáticamente el que tenga menos pedidos activos en este
    // momento (ver asignar_vendedor_automatico en supabase/schema.sql),
    // para que el trabajo quede parejo y el pedido salga más rápido.
    const vendedorElegido = document.getElementById("customer-vendedor").value;
    let vendedorId = vendedorElegido || null;
    if (!vendedorId) {
      try {
        vendedorId = await asignarVendedorAutomatico();
      } catch (error) {
        vendedorId = null;
      }
    }

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
      vendedorId: vendedorId,
    };

    const registrado = await crearPedido(pedidoInfo);

    ultimoPedido = Object.assign({}, pedidoInfo, {
      id: registrado.id,
      fecha: registrado.created_at,
    });

    const linkPedido = document.getElementById("link-ver-pedido");
    linkPedido.href = "pedido.html?id=" + registrado.id;

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
// Modal de éxito: compartir el link del pedido (pedido.html)
// ---------------------------------------------------------------------

// Mensaje que se envía al vendedor con el link de pedido.html. Se
// comparte el LINK en vez de archivos (PDF/Excel generados en el
// navegador resultaron poco confiables en varios celulares): la
// vendedora entra al link y ve el detalle completo del pedido.
function construirTextoWhatsapp(pedido) {
  const url = window.location.origin + window.location.pathname.replace(/index\.html$/, "") + "pedido.html?id=" + pedido.id;

  // Si es cliente nuevo (dato cargado en el modal de bienvenida), se
  // suma provincia/local: no se guarda en la tabla "pedidos", así que
  // este mensaje es la única forma en que le llega a la vendedora.
  const clienteGuardado = obtenerClienteGuardado();
  let datosExtra = "";
  if (clienteGuardado && clienteGuardado.tipo === "nuevo") {
    datosExtra = " Soy cliente nuevo, provincia: " + clienteGuardado.provincia + (clienteGuardado.local ? ", local: " + clienteGuardado.local : "") + ".";
  }

  return (
    "Hola! Armé mi pedido por la web de fundas. Te dejo mis datos: nombre: " +
    pedido.clienteNombre +
    ", teléfono: " +
    pedido.clienteTelefono +
    "." +
    datosExtra +
    " Aguardo así me confirmás stock y abono el total. Podés ver el detalle acá: " +
    url
  );
}

async function compartirPedido(opciones) {
  const texto = construirTextoWhatsapp(ultimoPedido);

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

  // Fallback sin Web Share API: abre WhatsApp directo con el texto (y
  // el link) ya escrito.
  const destino = opciones.abrirWhatsappVendedor && configuracionApp.whatsapp_vendedor
    ? "https://wa.me/" + configuracionApp.whatsapp_vendedor
    : "https://wa.me/";

  const nota = document.getElementById("share-fallback-note");
  if (nota) {
    nota.style.display = "block";
  }

  window.location.href = destino + "?text=" + encodeURIComponent(texto);
}

function reiniciarDespuesDePedido() {
  carrito = {};
  ultimoPedido = null;
  document.getElementById("checkout-form").reset();
  // El reset() del form vacía nombre/teléfono; se vuelven a completar
  // para el próximo pedido del mismo cliente.
  prefillCheckoutConCliente(obtenerClienteGuardado());
  const aviso = document.getElementById("stock-warning-box");
  if (aviso) {
    aviso.style.display = "none";
  }
  const nota = document.getElementById("share-fallback-note");
  if (nota) {
    nota.style.display = "none";
  }
  actualizarUiCarrito();
  volverAlCatalogo();
}

// ---------------------------------------------------------------------
// Bienvenida y datos del cliente
// ---------------------------------------------------------------------

// Se guarda en el navegador (no en Supabase) para no depender de una
// cuenta de cliente: solo sirve para no pedirle los mismos datos cada
// vez que entra desde el mismo celular.
const CLIENTE_STORAGE_KEY = "panther_cliente_info";

function obtenerClienteGuardado() {
  try {
    const crudo = localStorage.getItem(CLIENTE_STORAGE_KEY);
    return crudo ? JSON.parse(crudo) : null;
  } catch (error) {
    return null;
  }
}

function prefillCheckoutConCliente(datos) {
  if (!datos) return;
  document.getElementById("customer-name").value = datos.nombre || "";
  document.getElementById("customer-phone").value = datos.telefono || "";
}

function guardarClienteYPrefill(datos) {
  try {
    localStorage.setItem(CLIENTE_STORAGE_KEY, JSON.stringify(datos));
  } catch (error) {
    // localStorage puede fallar (modo privado, cuota llena); no debe
    // frenar el flujo de compra por eso.
  }
  prefillCheckoutConCliente(datos);
}

// Muestra un único paso del modal de bienvenida (los demás quedan
// ocultos con el atributo "hidden").
function mostrarPasoBienvenida(idPasoVisible) {
  document.querySelectorAll(".welcome-step").forEach(function (paso) {
    paso.hidden = paso.id !== idPasoVisible;
  });
}

// Si ya hay datos guardados de una visita anterior, se pre-completa el
// checkout directo y no se vuelve a preguntar. Si es la primera vez,
// se muestra el modal de bienvenida para pedirlos.
function configurarBienvenida() {
  const clienteGuardado = obtenerClienteGuardado();
  if (clienteGuardado) {
    prefillCheckoutConCliente(clienteGuardado);
    return;
  }

  mostrarModal(document.getElementById("welcome-modal"));

  document.getElementById("btn-welcome-existente").addEventListener("click", function () {
    mostrarPasoBienvenida("welcome-form-existente");
  });
  document.getElementById("btn-welcome-nuevo").addEventListener("click", function () {
    mostrarPasoBienvenida("welcome-form-nuevo");
  });
  document.querySelectorAll(".welcome-back").forEach(function (boton) {
    boton.addEventListener("click", function () {
      mostrarPasoBienvenida("welcome-step-inicial");
    });
  });

  document.getElementById("welcome-form-existente").addEventListener("submit", function (evento) {
    evento.preventDefault();

    const telefono = document.getElementById("welcome-existente-telefono").value.trim();
    if (!telefonoEsValido(telefono)) {
      mostrarErrorCampo("welcome-existente-telefono-error");
      return;
    }
    ocultarErrorCampo("welcome-existente-telefono-error");

    guardarClienteYPrefill({
      tipo: "existente",
      nombre: document.getElementById("welcome-existente-nombre").value.trim(),
      telefono: telefono,
    });
    ocultarModal(document.getElementById("welcome-modal"));
  });

  document.getElementById("welcome-form-nuevo").addEventListener("submit", function (evento) {
    evento.preventDefault();

    const telefono = document.getElementById("welcome-nuevo-telefono").value.trim();
    if (!telefonoEsValido(telefono)) {
      mostrarErrorCampo("welcome-nuevo-telefono-error");
      return;
    }
    ocultarErrorCampo("welcome-nuevo-telefono-error");

    guardarClienteYPrefill({
      tipo: "nuevo",
      nombre: document.getElementById("welcome-nuevo-nombre").value.trim(),
      telefono: telefono,
      provincia: document.getElementById("welcome-nuevo-provincia").value.trim(),
      local: document.getElementById("welcome-nuevo-local").value.trim(),
    });
    ocultarModal(document.getElementById("welcome-modal"));
  });
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
