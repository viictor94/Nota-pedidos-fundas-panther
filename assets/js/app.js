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

let categoriasDisponibles = []; // Categorías activas, para los chips de filtro.
let categoriaActivaId = null; // null = chip "Todos"

let terminoBusqueda = ""; // Texto del buscador (ya en minúsculas), filtra por nombre de producto o SKU de variante.
let vistaActual = "grid"; // "grid" (tarjetas) o "lista" (tabla), elegido con el toggle de la barra de herramientas.

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
  restaurarCarritoDeSesion();
  actualizarUiCarrito();
  wireEventosEstaticos();

  try {
    const [catalogo, config, categorias] = await Promise.all([obtenerCatalogo(), obtenerConfig(), obtenerCategorias()]);
    catalogoCompleto = ordenarDestacadosPrimero(catalogo);
    configuracionApp = config;
    categoriasDisponibles = categorias;
    actualizarTextoUltimaActualizacion(config.catalogo_actualizado_en);
    renderTarjetasCategoria();
    renderCatalogo();
    // En pantallas anchas (PC, grilla de 5 columnas) la primera tanda de
    // productos puede no llegar a llenar el alto de la ventana: hay que
    // seguir completando antes de esperar a que el usuario scrollee.
    seguirCargandoSiSentinelaVisible();
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
  configurarBuscador();
  configurarToggleVista();

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

// Ícono genérico para la tarjeta "Todos" y para cualquier categoría sin
// ícono propio cargado desde el admin (campo opcional, ver data.js).
const ICONO_CATEGORIA_TODOS = "🗂️";
const ICONO_CATEGORIA_DEFECTO = "🏷️";

// Tarjetas de categoría: "Todos" + una por categoría activa. Al tocar
// una se filtra la grilla de abajo (los carruseles de Promos/Nuevos no
// se ven afectados, son transversales a categorías).
function renderTarjetasCategoria() {
  const contenedor = document.getElementById("category-cards");
  if (!contenedor) return;

  while (contenedor.firstChild) {
    contenedor.removeChild(contenedor.firstChild);
  }

  contenedor.appendChild(crearTarjetaCategoria(null, "Todos", ICONO_CATEGORIA_TODOS));
  categoriasDisponibles.forEach(function (categoria) {
    contenedor.appendChild(
      crearTarjetaCategoria(categoria.id, categoria.nombre, categoria.icono || ICONO_CATEGORIA_DEFECTO)
    );
  });
}

function crearTarjetaCategoria(id, nombre, icono) {
  const activa = categoriaActivaId === id;

  const tarjeta = document.createElement("button");
  tarjeta.type = "button";
  tarjeta.className = "category-card" + (activa ? " active" : "");
  tarjeta.setAttribute("role", "tab");
  tarjeta.setAttribute("aria-selected", activa ? "true" : "false");

  const spanIcono = document.createElement("span");
  spanIcono.className = "category-card-icon";
  spanIcono.textContent = icono;
  spanIcono.setAttribute("aria-hidden", "true");
  tarjeta.appendChild(spanIcono);

  const spanNombre = document.createElement("span");
  spanNombre.className = "category-card-label";
  spanNombre.textContent = nombre;
  tarjeta.appendChild(spanNombre);

  tarjeta.addEventListener("click", function () {
    if (categoriaActivaId === id) return;
    categoriaActivaId = id;
    productosVisibles = PRODUCTOS_POR_PAGINA;
    renderTarjetasCategoria();
    renderCatalogo();
    seguirCargandoSiSentinelaVisible();
  });

  return tarjeta;
}

// Catálogo completo si el chip activo es "Todos", o solo los productos
// de la categoría elegida.
function obtenerCatalogoFiltrado() {
  let resultado = catalogoCompleto;

  if (categoriaActivaId !== null) {
    resultado = resultado.filter(function (producto) {
      return producto.categoria_id === categoriaActivaId;
    });
  }

  if (terminoBusqueda) {
    resultado = resultado.filter(function (producto) {
      const coincideNombre = producto.nombre.toLowerCase().includes(terminoBusqueda);
      const coincideSku = producto.variantes.some(function (variante) {
        return (variante.sku || "").toLowerCase().includes(terminoBusqueda);
      });
      return coincideNombre || coincideSku;
    });
  }

  return resultado;
}

// Buscador de texto libre (nombre de producto o SKU de variante): filtra
// en memoria sobre catalogoCompleto, mismo mecanismo que los chips de
// categoría, sin pedir nada nuevo a Supabase.
function configurarBuscador() {
  document.getElementById("search-input").addEventListener("input", function (evento) {
    terminoBusqueda = evento.target.value.trim().toLowerCase();
    productosVisibles = PRODUCTOS_POR_PAGINA;
    renderCatalogo();
    seguirCargandoSiSentinelaVisible();
  });
}

// Toggle Grilla/Lista de la barra de herramientas: alterna qué
// contenedor está visible y re-renderiza con los productos ya visibles
// (no hace falta volver a pedir nada, ambas vistas leen el mismo array).
function configurarToggleVista() {
  document.getElementById("btn-vista-grid").addEventListener("click", function () {
    cambiarVista("grid");
  });
  document.getElementById("btn-vista-lista").addEventListener("click", function () {
    cambiarVista("lista");
  });
}

function cambiarVista(vista) {
  if (vista === vistaActual) {
    return;
  }
  vistaActual = vista;
  document.getElementById("btn-vista-grid").classList.toggle("active", vista === "grid");
  document.getElementById("btn-vista-lista").classList.toggle("active", vista === "lista");
  document.getElementById("catalog-grid").style.display = vista === "grid" ? "grid" : "none";
  document.getElementById("catalog-list-wrap").style.display = vista === "lista" ? "block" : "none";
  renderCatalogo();
}

function renderCatalogo() {
  renderCarruseles();

  const catalogoFiltrado = obtenerCatalogoFiltrado();
  const visibles = catalogoFiltrado.slice(0, productosVisibles);

  if (vistaActual === "lista") {
    renderListaProductos(visibles);
  } else {
    renderGrillaProductos(visibles);
  }

  const restantes = catalogoFiltrado.length - visibles.length;
  if (restantes > 0) {
    mostrarMensajeCarga("Deslizá hacia abajo para ver más fundas ↓");
  } else {
    mostrarMensajeCarga(catalogoFiltrado.length > 0 ? "Viste todo el catálogo ✓" : "");
  }
}

function renderGrillaProductos(visibles) {
  const grid = document.getElementById("catalog-grid");
  while (grid.firstChild) {
    grid.removeChild(grid.firstChild);
  }
  visibles.forEach(function (producto) {
    grid.appendChild(crearTarjetaProducto(producto));
  });
}

// Vista de lista: una fila de título por producto (nombre + botón "Ver"
// que abre el mismo modal de siempre, con la foto) seguida de una fila
// por cada variante para agregarla directo sin abrir el modal.
function renderListaProductos(visibles) {
  const cuerpo = document.getElementById("catalog-list-body");
  while (cuerpo.firstChild) {
    cuerpo.removeChild(cuerpo.firstChild);
  }
  visibles.forEach(function (producto) {
    cuerpo.appendChild(crearFilaTituloLista(producto));
    producto.variantes.forEach(function (variante) {
      cuerpo.appendChild(crearFilaVarianteLista(producto, variante));
    });
  });
}

function crearFilaTituloLista(producto) {
  const fila = document.createElement("tr");
  fila.className = "list-title-row";

  const celda = document.createElement("td");
  celda.colSpan = 5;

  const contenedor = document.createElement("div");
  contenedor.className = "list-title-row-inner";

  const nombre = document.createElement("span");
  nombre.className = "list-title-row-name";
  nombre.textContent = (producto.en_promo ? "🔥 " : "") + (producto.es_nuevo ? "🆕 " : "") + producto.nombre;
  contenedor.appendChild(nombre);

  const btnVer = document.createElement("button");
  btnVer.type = "button";
  btnVer.className = "btn-ver-funda";
  btnVer.textContent = "👁️ Ver";
  btnVer.addEventListener("click", function () {
    abrirModalVariantes(producto);
  });
  contenedor.appendChild(btnVer);

  celda.appendChild(contenedor);
  fila.appendChild(celda);
  return fila;
}

function crearFilaVarianteLista(producto, variante) {
  const fila = document.createElement("tr");
  fila.className = "list-variant-row";

  const celdaCodigo = document.createElement("td");
  celdaCodigo.className = "list-col-codigo";
  celdaCodigo.textContent = variante.sku;
  fila.appendChild(celdaCodigo);

  const celdaDescripcion = document.createElement("td");
  celdaDescripcion.textContent = variante.modelo;
  fila.appendChild(celdaDescripcion);

  const celdaCategoria = document.createElement("td");
  celdaCategoria.textContent = (producto.categorias && producto.categorias.nombre) || "-";
  fila.appendChild(celdaCategoria);

  const celdaPrecio = document.createElement("td");
  const precioTachado = calcularPrecioTachado(variante, producto);
  if (precioTachado !== null) {
    const viejo = document.createElement("span");
    viejo.className = "list-precio-old";
    viejo.textContent = formatearMoneda(precioTachado);
    celdaPrecio.appendChild(viejo);
  }
  const precioActual = document.createElement("span");
  precioActual.className = "list-precio-actual";
  precioActual.textContent = formatearMoneda(variante.precio_actual);
  celdaPrecio.appendChild(precioActual);
  fila.appendChild(celdaPrecio);

  const celdaAgregar = document.createElement("td");
  const sinStock = variante.stock_estado === "SIN STOCK";

  if (sinStock) {
    const badge = document.createElement("span");
    badge.className = "stock-badge " + claseCssStock(variante.stock_estado);
    badge.textContent = variante.stock_estado;
    celdaAgregar.appendChild(badge);
  } else {
    const control = document.createElement("div");
    control.className = "qty-control qty-control-compact";

    const btnMenos = document.createElement("button");
    btnMenos.type = "button";
    btnMenos.className = "qty-btn qty-btn-sm";
    btnMenos.textContent = "−";

    const valor = document.createElement("span");
    valor.className = "qty-value";
    valor.textContent = String((carrito[variante.id] && carrito[variante.id].cantidad) || 0);

    const btnMas = document.createElement("button");
    btnMas.type = "button";
    btnMas.className = "qty-btn qty-btn-sm";
    btnMas.textContent = "+";

    btnMenos.addEventListener("click", function () {
      const notaActual = (carrito[variante.id] && carrito[variante.id].nota) || "";
      cambiarCantidadCarrito(producto, variante, -1, notaActual);
      valor.textContent = String((carrito[variante.id] && carrito[variante.id].cantidad) || 0);
    });

    btnMas.addEventListener("click", function () {
      const notaActual = (carrito[variante.id] && carrito[variante.id].nota) || "";
      cambiarCantidadCarrito(producto, variante, 1, notaActual);
      valor.textContent = String((carrito[variante.id] && carrito[variante.id].cantidad) || 0);
    });

    control.appendChild(btnMenos);
    control.appendChild(valor);
    control.appendChild(btnMas);
    celdaAgregar.appendChild(control);
  }
  fila.appendChild(celdaAgregar);

  return fila;
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
  if (cargandoMasProductos || productosVisibles >= obtenerCatalogoFiltrado().length) {
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
    seguirCargandoSiSentinelaVisible();
  }, 350);
}

// IntersectionObserver solo dispara su callback cuando el sentinela
// CRUZA el borde de la pantalla (pasa de no visible a visible o
// viceversa), no cada vez que sigue visible. En pantallas anchas de PC
// (grilla de 5 columnas) una tanda de 4-8 productos no siempre alcanza
// a llenar el alto de la ventana: el sentinela queda visible desde el
// principio y, tras cargar una tanda, puede seguir estando visible sin
// que eso cuente como un cruce nuevo, así que el observer no vuelve a
// avisar y el catálogo queda "trabado" aunque el usuario siga
// scrolleando. Por eso, después de cada tanda, se chequea a mano si el
// sentinela sigue a la vista y, de ser así, se seguir cargando.
function seguirCargandoSiSentinelaVisible() {
  const sentinela = document.getElementById("catalog-load-status");
  if (!sentinela) {
    return;
  }
  const rect = sentinela.getBoundingClientRect();
  const visible = rect.top < window.innerHeight + 300 && rect.bottom > 0;
  if (visible) {
    cargarMasProductos();
  }
}

// Las secciones "Promos del Día" y "Nuevos Ingresos" son filas
// estáticas con scroll horizontal (sin animación 3D ni swipe a mano):
// el navegador ya resuelve el scroll táctil/mouse por su cuenta, igual
// que las tarjetas de categoría.
function renderCarruseles() {
  renderFilaDestacados(
    "carousel-promos-wrap",
    "carousel-promos",
    catalogoCompleto.filter(function (p) {
      return p.en_promo;
    })
  );
  renderFilaDestacados(
    "carousel-nuevos-wrap",
    "carousel-nuevos",
    catalogoCompleto.filter(function (p) {
      return p.es_nuevo;
    })
  );
}

function renderFilaDestacados(idWrap, idTrack, productos) {
  const wrap = document.getElementById(idWrap);
  const track = document.getElementById(idTrack);

  while (track.firstChild) {
    track.removeChild(track.firstChild);
  }

  if (productos.length === 0) {
    wrap.style.display = "none";
    return;
  }

  wrap.style.display = "block";
  productos.forEach(function (producto) {
    const tarjeta = crearTarjetaProducto(producto);
    tarjeta.classList.add("destacado-card");
    track.appendChild(tarjeta);
  });
}

function crearTarjetaProducto(producto) {
  const tarjeta = construirTarjetaBase(producto);
  tarjeta.addEventListener("click", function () {
    abrirModalVariantes(producto);
  });
  return tarjeta;
}

// Arma el DOM de una tarjeta de producto (foto, carteles, nombre,
// precios), reutilizada por la grilla, las filas de destacados
// (Promos/Nuevos) y la vista de lista (botón "Ver" del título).
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

// Palabras máximas para la nota que el cliente puede dejarle a la
// vendedora en cada variante (ej. "Color azul", "Para varón"). Un
// número bajo alcanza de sobra para un detalle corto y evita que se
// use como un segundo campo de comentarios largo.
const MAXIMO_PALABRAS_NOTA = 30;

function crearFilaVariante(producto, variante) {
  const fila = document.createElement("div");
  fila.className = "variant-item";

  const filaSuperior = document.createElement("div");
  filaSuperior.className = "variant-item-top";

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

  filaSuperior.appendChild(info);

  const sinStock = variante.stock_estado === "SIN STOCK";

  if (sinStock) {
    const aviso = document.createElement("span");
    aviso.textContent = "No disponible";
    aviso.style.fontSize = "0.8rem";
    aviso.style.color = "var(--color-text-light)";
    filaSuperior.appendChild(aviso);
    fila.appendChild(filaSuperior);
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
    cambiarCantidadCarrito(producto, variante, -1, textareaNota.value.trim());
    valor.textContent = String((carrito[variante.id] && carrito[variante.id].cantidad) || 0);
  });

  btnMas.addEventListener("click", function () {
    cambiarCantidadCarrito(producto, variante, 1, textareaNota.value.trim());
    valor.textContent = String((carrito[variante.id] && carrito[variante.id].cantidad) || 0);
  });

  control.appendChild(btnMenos);
  control.appendChild(valor);
  control.appendChild(btnMas);
  filaSuperior.appendChild(control);
  fila.appendChild(filaSuperior);

  // Detalle opcional para la vendedora al armar el pedido (color,
  // género, diseño puntual, etc.). Vive en el carrito junto al resto
  // del ítem, no en una tabla aparte: se ve en pedido.html/PDF pero
  // nunca se exporta al Excel (ese archivo es solo para picking por
  // SKU/cantidad).
  const notaBox = document.createElement("div");
  notaBox.className = "variant-item-nota";

  const notaLabel = document.createElement("label");
  notaLabel.className = "variant-item-nota-label";
  notaLabel.textContent = "Agregar algún detalle";
  notaBox.appendChild(notaLabel);

  const textareaNota = document.createElement("textarea");
  textareaNota.className = "variant-item-nota-input";
  textareaNota.rows = 2;
  textareaNota.placeholder = "Contanos si necesitás color, género, diseño específico, etc.";
  textareaNota.value = (carrito[variante.id] && carrito[variante.id].nota) || "";
  notaBox.appendChild(textareaNota);

  const notaContador = document.createElement("p");
  notaContador.className = "variant-item-nota-contador";
  notaBox.appendChild(notaContador);

  function actualizarContadorNota() {
    const cantidadPalabras = contarPalabras(textareaNota.value);
    notaContador.textContent = cantidadPalabras + "/" + MAXIMO_PALABRAS_NOTA + " palabras";
  }

  textareaNota.addEventListener("input", function () {
    limitarPalabras(textareaNota, MAXIMO_PALABRAS_NOTA);
    actualizarContadorNota();
    // Si la variante ya está en el carrito, el detalle se guarda al
    // toque (sin esperar a que se toque + / -), para no perderlo si el
    // cliente cierra el modal enseguida.
    if (carrito[variante.id]) {
      carrito[variante.id].nota = textareaNota.value.trim();
      guardarCarritoEnSesion();
    }
  });

  actualizarContadorNota();
  fila.appendChild(notaBox);

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

function contarPalabras(texto) {
  const limpio = (texto || "").trim();
  return limpio === "" ? 0 : limpio.split(/\s+/).length;
}

// Si se pasan más de "maximo" palabras, recorta el textarea a esa
// cantidad en el momento (en vez de bloquear el tipeo o mostrar un
// error), para que sea evidente que se llegó al límite.
function limitarPalabras(textarea, maximo) {
  const palabras = textarea.value.trim().split(/\s+/).filter(function (p) {
    return p !== "";
  });
  if (palabras.length > maximo) {
    textarea.value = palabras.slice(0, maximo).join(" ");
  }
}

function cambiarCantidadCarrito(producto, variante, delta, notaTexto) {
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
      nota: notaTexto !== undefined ? notaTexto : (actual ? actual.nota || "" : ""),
    };
  }

  guardarCarritoEnSesion();
  actualizarUiCarrito();
}

// ---------------------------------------------------------------------
// Persistencia del carrito (sessionStorage)
// ---------------------------------------------------------------------

// Respaldo del carrito por si el navegador termina recargando la
// página igual (algunos celulares recargan pestañas en segundo plano,
// o un pull-to-refresh accidental): sin esto, cualquier recarga real
// vaciaba el pedido armado hasta ese momento y obligaba a rehacerlo.
const CARRITO_STORAGE_KEY = "panther_carrito";

function guardarCarritoEnSesion() {
  try {
    sessionStorage.setItem(CARRITO_STORAGE_KEY, JSON.stringify(carrito));
  } catch (error) {
    // sessionStorage puede fallar (modo privado, cuota); no debe frenar
    // la compra por eso, solo se pierde el respaldo.
  }
}

function restaurarCarritoDeSesion() {
  try {
    const crudo = sessionStorage.getItem(CARRITO_STORAGE_KEY);
    if (crudo) {
      carrito = JSON.parse(crudo);
    }
  } catch (error) {
    // Si falla la lectura, se arranca con el carrito vacío de siempre.
  }
}

function borrarCarritoDeSesion() {
  try {
    sessionStorage.removeItem(CARRITO_STORAGE_KEY);
  } catch (error) {
    // No hay nada que limpiar si sessionStorage no está disponible.
  }
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

  // El ícono del carrito ahora queda siempre visible en el header (con
  // el contador en 0), en vez de aparecer/desaparecer según si hay algo
  // cargado; hacer click estando vacío no hace nada (ver mostrarCheckout).
  document.getElementById("header-cart-count").textContent = String(cantidad);

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

// El checkout nunca fue una "página" real (no cambia de URL), así que
// el gesto/botón nativo de "atrás" del celular no volvía al catálogo:
// se salía del todo del sitio o recargaba la página, perdiendo el
// carrito armado hasta ese momento. Con history.pushState al entrar y
// un listener de "popstate", tanto el botón "← Volver al Catálogo"
// como el gesto nativo de atrás terminan en el mismo lugar sin recargar
// nada (ver también CARRITO_STORAGE_KEY más abajo, que además guarda el
// carrito por si la página llegara a recargarse igual).
function mostrarSeccionCatalogo() {
  document.getElementById("checkout-section").classList.remove("active");
  document.getElementById("catalog-section").classList.add("active");
  actualizarUiCarrito();
}

function mostrarSeccionCheckout() {
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

function mostrarCheckout() {
  if (obtenerCantidadTotalCarrito() === 0) {
    return;
  }
  if (!history.state || history.state.vista !== "checkout") {
    history.pushState({ vista: "checkout" }, "", "#checkout");
  }
  mostrarSeccionCheckout();
}

function volverAlCatalogo() {
  // Si se llegó acá con una entrada de "checkout" en el historial, se
  // la descarta con history.back(): eso dispara "popstate" y termina
  // llamando a mostrarSeccionCatalogo() de todas formas, dejando el
  // historial del navegador prolijo (sin entradas de checkout colgadas).
  if (history.state && history.state.vista === "checkout") {
    history.back();
  } else {
    mostrarSeccionCatalogo();
  }
}

window.addEventListener("popstate", function (evento) {
  if (evento.state && evento.state.vista === "checkout") {
    mostrarSeccionCheckout();
  } else {
    mostrarSeccionCatalogo();
  }
});

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

    // Si el cliente no eligió vendedor/a preferido, el pedido queda sin
    // asignar (vendedor_id null) para que el admin lo asigne a mano
    // desde el panel, en vez de auto-asignarlo.
    const vendedorElegido = document.getElementById("customer-vendedor").value;
    const vendedorId = vendedorElegido || null;

    const items = obtenerItemsCarrito().map(function (item) {
      return {
        productoNombre: item.productoNombre,
        modelo: item.modelo,
        sku: item.sku,
        precioUnitario: item.precioUnitario,
        cantidad: item.cantidad,
        subtotal: item.precioUnitario * item.cantidad,
        nota: item.nota || "",
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
    guardarCarritoEnSesion();
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
  let lineaExtra = "";
  if (clienteGuardado && clienteGuardado.tipo === "nuevo") {
    lineaExtra =
      "\n* Soy cliente nuevo — Provincia: " + clienteGuardado.provincia + (clienteGuardado.local ? ", Local: " + clienteGuardado.local : "");
  }

  return (
    "Hola, acabo de hacer un pedido de fundas en Panther Distribuciones.\n\n" +
    "Te dejo mis datos:\n\n" +
    "* Nombre completo: " +
    pedido.clienteNombre +
    "\n* Teléfono: " +
    pedido.clienteTelefono +
    lineaExtra +
    "\n\n" +
    "Aguardo así me confirmás que tenés stock de todo, así procedo a realizar el pago.\n" +
    "Acá está el link del pedido: " +
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
  borrarCarritoDeSesion();
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
