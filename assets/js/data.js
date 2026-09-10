// =====================================================================
// Capa de acceso a datos (Supabase). Única fuente de queries del
// proyecto: tanto app.js (catálogo cliente) como admin.js (panel de
// gestión) usan estas mismas funciones, para no duplicar lógica.
//
// Requiere que assets/js/supabase-client.js se haya cargado antes y
// haya creado la variable global "supabaseClient".
// =====================================================================

// El panel admin no pide email: usa Supabase Auth con un único usuario
// fijo, y el campo "PIN" del formulario se manda como contraseña.
const ADMIN_EMAIL = "admin@panther.internal";

// ---------------------------------------------------------------------
// Lectura pública del catálogo
// ---------------------------------------------------------------------

// Devuelve los productos activos junto con sus variantes activas,
// ordenados por "orden" y luego por nombre. Cada producto trae su
// arreglo de variantes anidado (usando el embed de Supabase).
async function obtenerCatalogo() {
  const { data, error } = await supabaseClient
    .from("productos")
    .select("id, nombre, imagen_url, orden, en_promo, es_nuevo, variantes(id, sku, modelo, precio_actual, precio_anterior, stock_estado, stock_cantidad, activo)")
    .eq("activo", true)
    .order("orden", { ascending: true })
    .order("nombre", { ascending: true });

  if (error) {
    throw error;
  }

  // Filtra variantes inactivas y descarta productos sin ninguna variante.
  return data
    .map(function (producto) {
      return Object.assign({}, producto, {
        variantes: producto.variantes.filter(function (v) {
          return v.activo;
        }),
      });
    })
    .filter(function (producto) {
      return producto.variantes.length > 0;
    });
}

// Trae todos los productos (activos e inactivos) con todas sus
// variantes, para el panel admin.
async function obtenerCatalogoCompleto() {
  const { data, error } = await supabaseClient
    .from("productos")
    .select("id, nombre, imagen_url, activo, orden, en_promo, es_nuevo, variantes(id, sku, modelo, descripcion_completa, precio_actual, precio_anterior, stock_estado, stock_cantidad, activo)")
    .order("orden", { ascending: true })
    .order("nombre", { ascending: true });

  if (error) {
    throw error;
  }
  return data;
}

// Configuración pública de la app (número de WhatsApp del vendedor,
// fecha de última actualización del catálogo).
async function obtenerConfig() {
  const { data, error } = await supabaseClient
    .from("app_config")
    .select("whatsapp_vendedor, nombre_empresa, catalogo_actualizado_en")
    .eq("id", 1)
    .single();

  if (error) {
    throw error;
  }
  return data;
}

// Se suscribe a cambios en productos/variantes en tiempo real. Llama a
// "callback" cada vez que algo cambia, para que la UI pueda refrescar
// el catálogo sin recargar la página. Devuelve el canal, por si se
// necesita cancelar la suscripción con supabaseClient.removeChannel().
function suscribirCambiosCatalogo(callback) {
  return supabaseClient
    .channel("cambios-catalogo")
    .on("postgres_changes", { event: "*", schema: "public", table: "productos" }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "variantes" }, callback)
    .subscribe();
}

// ---------------------------------------------------------------------
// Pedidos (el cliente no necesita sesión para crear uno)
// ---------------------------------------------------------------------

async function crearPedido(pedido) {
  // El id se genera en el navegador (en vez de dejarlo en manos del
  // default de la base) para poder armar el link "pedido.html?id=..."
  // apenas se guarda, sin depender de leer la fila de vuelta (el
  // cliente solo tiene permiso de INSERT sobre "pedidos" por RLS, no
  // de SELECT).
  const id = crypto.randomUUID();

  const { error } = await supabaseClient.from("pedidos").insert({
    id: id,
    cliente_nombre: pedido.clienteNombre,
    cliente_telefono: pedido.clienteTelefono,
    items: pedido.items,
    total: pedido.total,
    cantidad_articulos: pedido.cantidadArticulos,
    vendedor_id: pedido.vendedorId || null,
  });

  if (error) {
    throw error;
  }

  return {
    id: id,
    created_at: new Date().toISOString(),
  };
}

// Lectura pública de un pedido puntual (para pedido.html). Usa la
// función obtener_pedido_publico de supabase/schema.sql en vez de un
// select directo, porque la tabla "pedidos" no tiene lectura pública
// (protege los datos de otros clientes): esa función solo devuelve la
// fila exacta pedida por id, nunca una lista.
async function obtenerPedidoPublico(id) {
  const { data, error } = await supabaseClient.rpc("obtener_pedido_publico", { p_id: id });

  if (error) {
    throw error;
  }
  return data && data.length > 0 ? data[0] : null;
}

// Tilda/destilda una variante del pedido en el checklist de armado de
// pedido.html (identificada por sku, no por índice). Como
// obtener_pedido_publico no requiere sesión, esta función tampoco: la
// protección es que solo se puede tocar el pedido cuyo id exacto se
// conoce (el link).
async function marcarItemPedido(id, sku, marcado) {
  const { error } = await supabaseClient.rpc("marcar_item_pedido", { p_id: id, p_sku: sku, p_marcado: marcado });
  if (error) {
    throw error;
  }
}

// Lista todos los pedidos para el panel admin (requiere sesión activa;
// protegido además por la política RLS "pedidos_lectura_admin").
async function obtenerPedidos() {
  const { data, error } = await supabaseClient
    .from("pedidos")
    .select("id, cliente_nombre, cliente_telefono, items, total, cantidad_articulos, created_at, estado, vendedor_id")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }
  return data;
}

// Actualiza campos puntuales de un pedido (estado "nuevo"/"asignado"/
// "completado", la vendedora elegida en el desplegable, o una
// corrección de nombre/teléfono del cliente).
async function actualizarPedido(id, campos) {
  const { error } = await supabaseClient.from("pedidos").update(campos).eq("id", id);
  if (error) {
    throw error;
  }
}

async function eliminarPedido(id) {
  const { error } = await supabaseClient.from("pedidos").delete().eq("id", id);
  if (error) {
    throw error;
  }
}

// ---------------------------------------------------------------------
// Vendedores: lectura pública liviana (checkout del cliente)
// ---------------------------------------------------------------------

// Solo id/nombre/provincia (no el N° de Zeus) para el desplegable
// opcional "elegí tu vendedor/a" del checkout. Usa la función
// obtener_vendedores_publico de supabase/schema.sql, ya que la tabla
// "vendedores" en sí no tiene lectura pública.
async function obtenerVendedoresPublico() {
  const { data, error } = await supabaseClient.rpc("obtener_vendedores_publico");
  if (error) {
    throw error;
  }
  return data;
}

// ---------------------------------------------------------------------
// Autenticación de administrador (PIN = contraseña de un único
// usuario de Supabase Auth)
// ---------------------------------------------------------------------

async function iniciarSesionAdmin(pin) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: pin,
  });

  if (error) {
    return { ok: false, error: error };
  }
  return { ok: true, session: data.session };
}

async function cerrarSesionAdmin() {
  await supabaseClient.auth.signOut();
}

async function obtenerSesionAdmin() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

// Revalida el PIN actual (haciendo login de nuevo) y, si es correcto,
// cambia la contraseña del usuario admin al PIN nuevo.
async function cambiarPinAdmin(pinActual, pinNuevo) {
  const resultado = await iniciarSesionAdmin(pinActual);
  if (!resultado.ok) {
    return { ok: false, error: "El PIN actual no es correcto." };
  }

  const { error } = await supabaseClient.auth.updateUser({ password: pinNuevo });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// Escritura de administración (requiere sesión activa; protegido
// además por las políticas RLS de supabase/schema.sql)
// ---------------------------------------------------------------------

async function actualizarConfig(campos) {
  const { error } = await supabaseClient.from("app_config").update(campos).eq("id", 1);
  if (error) {
    throw error;
  }
}

async function crearProducto(nombre, imagenUrl) {
  const { data, error } = await supabaseClient
    .from("productos")
    .insert({ nombre: nombre, imagen_url: imagenUrl || null })
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

async function actualizarProducto(id, campos) {
  const { error } = await supabaseClient.from("productos").update(campos).eq("id", id);
  if (error) {
    throw error;
  }
}

async function eliminarProducto(id) {
  const { error } = await supabaseClient.from("productos").delete().eq("id", id);
  if (error) {
    throw error;
  }
}

// Inserta varias variantes de una sola vez. "variantes" es un arreglo
// de objetos { sku, modelo }, tal como se parsean del textarea
// "SKU | Descripción" del panel admin.
async function agregarVariantes(productoId, variantes) {
  const filas = variantes.map(function (v) {
    return {
      producto_id: productoId,
      sku: v.sku,
      modelo: v.modelo,
      descripcion_completa: v.modelo,
      precio_actual: 0,
      stock_estado: "SIN STOCK",
    };
  });

  const { error } = await supabaseClient.from("variantes").insert(filas);
  if (error) {
    throw error;
  }
}

async function eliminarVariante(id) {
  const { error } = await supabaseClient.from("variantes").delete().eq("id", id);
  if (error) {
    throw error;
  }
}

// Actualiza campos puntuales de una variante (ej. precio_anterior
// cargado a mano en el admin, uno por uno o con "aplicar a todas").
async function actualizarVariante(id, campos) {
  const { error } = await supabaseClient.from("variantes").update(campos).eq("id", id);
  if (error) {
    throw error;
  }
}

// Actualización masiva de precio/stock a partir del Excel del sistema
// (columnas Codigo/Precio/Stock). "filas" es un arreglo de objetos
// { sku, precio, stock_cantidad }.
async function actualizarPreciosStockMasivo(filas) {
  const { data, error } = await supabaseClient.rpc("actualizar_precios_stock_masivo", {
    p_filas: filas,
  });

  if (error) {
    throw error;
  }
  return data; // cantidad de variantes actualizadas
}

// Sube una foto al bucket público "assets-publicos" bajo
// productos/{productoId}.{extension}, y devuelve la URL pública.
// upsert:true permite reemplazar la foto de un producto ya existente.
async function subirFotoProducto(productoId, archivo) {
  const extension = archivo.name.split(".").pop();
  const ruta = "productos/" + productoId + "." + extension;

  const { error: errorSubida } = await supabaseClient.storage
    .from("assets-publicos")
    .upload(ruta, archivo, { upsert: true });

  if (errorSubida) {
    throw errorSubida;
  }

  const { data } = supabaseClient.storage.from("assets-publicos").getPublicUrl(ruta);
  return data.publicUrl;
}

// ---------------------------------------------------------------------
// Vendedores (panel admin, sección "Gestión Vendedores")
// ---------------------------------------------------------------------

async function obtenerVendedores() {
  const { data, error } = await supabaseClient
    .from("vendedores")
    .select("id, nombre_completo, provincia, numero_zeus, activo")
    .order("provincia", { ascending: true })
    .order("nombre_completo", { ascending: true });

  if (error) {
    throw error;
  }
  return data;
}

async function crearVendedor(datos) {
  const { data, error } = await supabaseClient
    .from("vendedores")
    .insert({ nombre_completo: datos.nombreCompleto, provincia: datos.provincia, numero_zeus: datos.numeroZeus })
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

async function actualizarVendedor(id, campos) {
  const { error } = await supabaseClient.from("vendedores").update(campos).eq("id", id);
  if (error) {
    throw error;
  }
}

async function eliminarVendedor(id) {
  const { error } = await supabaseClient.from("vendedores").delete().eq("id", id);
  if (error) {
    throw error;
  }
}
