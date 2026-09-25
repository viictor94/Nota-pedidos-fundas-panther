-- =====================================================================
-- Nota de Pedidos Fundas - Panther Distribuciones
-- Esquema de Supabase (Postgres + Auth + Storage)
--
-- Cómo aplicarlo: pegar todo este archivo en el SQL Editor de Supabase
-- (https://supabase.com/dashboard/project/_/sql/new) y ejecutar.
--
-- Diseño de seguridad:
-- - El catálogo (productos, variantes, app_config) es de LECTURA
--   pública (el cliente arma su pedido sin login).
-- - La ESCRITURA (crear/editar productos y variantes, cambiar
--   precios/stock, editar configuración) requiere estar autenticado.
-- - No hay un sistema de "PIN casero": se usa Supabase Auth con un
--   único usuario admin (ver README.md para cómo crearlo). La pantalla
--   de "PIN" de admin.html en realidad hace un login normal de Supabase
--   Auth contra ese usuario fijo, usando el PIN como contraseña. Esto
--   da hasheo de contraseña real (bcrypt) sin escribir criptografía a
--   mano, y "Cambiar PIN" es simplemente auth.updateUser({password}).
-- - pedidos: cualquiera puede INSERTAR (el cliente no tiene cuenta),
--   pero solo el admin autenticado puede leerlos/editarlos/borrarlos.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------

create table if not exists public.productos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  imagen_url  text,
  activo      boolean not null default true,
  orden       integer not null default 0,
  -- Carteles que el admin tilda/destilda para resaltar el producto en
  -- el catálogo del cliente y potenciar su venta.
  en_promo    boolean not null default false,
  es_nuevo    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Por si la tabla ya existía de antes (proyecto ya provisionado) sin
-- estas columnas: se agregan sin romper nada, no hace falta correrlo
-- dos veces (add column if not exists es seguro de re-ejecutar).
alter table public.productos add column if not exists en_promo boolean not null default false;
alter table public.productos add column if not exists es_nuevo boolean not null default false;

create table if not exists public.variantes (
  id                   uuid primary key default gen_random_uuid(),
  producto_id          uuid not null references public.productos(id) on delete cascade,
  sku                  text not null unique,
  modelo               text not null,
  descripcion_completa text not null,
  precio_anterior      numeric(10, 2),
  precio_actual        numeric(10, 2) not null default 0,
  stock_estado         text not null default 'SIN STOCK'
    check (stock_estado in ('HAY STOCK', 'POCO STOCK', 'POR AGOTARSE', 'SIN STOCK')),
  stock_cantidad       numeric(10, 2),
  activo               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists variantes_producto_id_idx on public.variantes(producto_id);

-- Categorías de producto (plano, sin jerarquías): cada producto
-- pertenece a UNA sola categoría. Antes de que existiera esta tabla,
-- todo el catálogo era fundas de celular; se crea "Fundas" como
-- categoría por defecto para no dejar productos existentes sin
-- categorizar (ver seed más abajo).
create table if not exists public.categorias (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  icono       text,
  imagen_url  text,
  orden       integer not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- "icono"/"imagen_url" nullables a propósito: se sumaron después de
-- crear la tabla. El catálogo cliente muestra la imagen (silueta de la
-- categoría, ej. una funda o un cargador) si está cargada, si no el
-- emoji de "icono", y si tampoco hay eso un ícono genérico (ver app.js).
alter table public.categorias add column if not exists icono text;
alter table public.categorias add column if not exists imagen_url text;

drop index if exists public.categorias_nombre_unq;
create unique index categorias_nombre_unq on public.categorias (lower(trim(nombre)));

-- categoria_id nullable al principio: permite agregar la columna sin
-- romper el catálogo en producción mientras se corre el seed de abajo.
-- Se puede promover a "not null" más adelante una vez confirmado que
-- todos los productos quedaron asignados.
alter table public.productos add column if not exists categoria_id uuid references public.categorias(id) on delete set null;
create index if not exists productos_categoria_id_idx on public.productos(categoria_id);

-- Seed idempotente: crea "Fundas" si no existe y asigna esa categoría
-- a todo producto que todavía no tenga una.
insert into public.categorias (nombre, orden)
select 'Fundas', 0
where not exists (select 1 from public.categorias where lower(trim(nombre)) = 'fundas');

update public.productos
set categoria_id = (select id from public.categorias where lower(trim(nombre)) = 'fundas' limit 1)
where categoria_id is null;

-- Fila única de configuración general de la app.
create table if not exists public.app_config (
  id                 smallint primary key default 1 check (id = 1),
  whatsapp_vendedor  text not null default '',
  nombre_empresa     text not null default 'Panther Distribuciones',
  catalogo_actualizado_en timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

insert into public.app_config (id) values (1)
  on conflict (id) do nothing;

-- Vendedores de la empresa, agrupados por provincia en el panel admin.
-- "numero_zeus" es el número de vendedor del sistema de facturación
-- interno (Zeus), no un dato de Supabase: se guarda tal cual lo pasa
-- el admin para poder identificar al vendedor en ese otro sistema.
create table if not exists public.vendedores (
  id              uuid primary key default gen_random_uuid(),
  nombre_completo text not null,
  provincia       text not null,
  numero_zeus     text not null,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists vendedores_provincia_idx on public.vendedores(provincia);

-- Evita cargar el mismo vendedor dos veces sin darse cuenta (mismo
-- nombre en la misma provincia); sin esto el alta lo permitía en
-- silencio. Comparación sin importar mayúsculas/espacios.
--
-- Si ya se habían cargado duplicados antes de existir esta regla, el
-- create unique index de abajo fallaría; se los borra primero (se
-- queda con el más viejo de cada grupo repetido).
delete from public.vendedores a
using public.vendedores b
where a.id > b.id
  and lower(trim(a.nombre_completo)) = lower(trim(b.nombre_completo))
  and lower(trim(a.provincia)) = lower(trim(b.provincia));

drop index if exists public.vendedores_nombre_provincia_unq;
create unique index vendedores_nombre_provincia_unq
  on public.vendedores (lower(trim(nombre_completo)), lower(trim(provincia)));

-- Registro/auditoría de pedidos enviados por los clientes.
create table if not exists public.pedidos (
  id                  uuid primary key default gen_random_uuid(),
  cliente_nombre      text not null,
  cliente_telefono    text not null,
  items               jsonb not null,
  total               numeric(10, 2) not null,
  cantidad_articulos  integer not null,
  created_at          timestamptz not null default now()
);

-- Estado del pedido en el panel admin: "nuevo" hasta que se descarga su
-- Excel (ahí pasa a "asignado" automáticamente), "completado" cuando el
-- admin confirma que ya se cobró/entregó (para el reporte por
-- vendedor), y qué vendedor/a quedó a cargo. Se agregan con alter (en
-- vez de solo en el create table de arriba) para que el script sea
-- seguro de re-ejecutar sobre una base ya provisionada de antes.
alter table public.pedidos add column if not exists estado text not null default 'nuevo';
alter table public.pedidos add column if not exists vendedor_id uuid references public.vendedores(id) on delete set null;

-- Qué variantes del pedido ya fueron controladas físicamente por la
-- vendedora al armarlo (checkbox al lado de cada renglón en
-- pedido.html). Se guarda como objeto {"<sku>": true/false} en vez de
-- un array paralelo a "items", para no depender de que el orden o el
-- índice se mantengan.
alter table public.pedidos add column if not exists items_marcados jsonb not null default '{}'::jsonb;

-- "items" puede editarse desde pedido.html al armar el pedido (agregar
-- o sacar fundas que no había en stock), así que se guarda una copia
-- congelada de lo que pidió el cliente originalmente en
-- "items_original" (se completa sola vía trigger al insertar, ver más
-- abajo) para poder avisar si hubo cambios respecto del pedido real.
alter table public.pedidos add column if not exists items_original jsonb;

-- Bloqueo de armado: qué vendedor/a está preparando ahora mismo este
-- pedido (identificado con su N° de Zeus al entrar a "Preparar
-- Pedido"), para que otra persona que entre mientras tanto solo pueda
-- verlo, no editarlo. Se libera automáticamente al finalizar el
-- armado (ver finalizar_armado_pedido).
alter table public.pedidos add column if not exists preparado_por_id uuid references public.vendedores(id) on delete set null;
alter table public.pedidos add column if not exists preparado_por_nombre text;

-- Una vez que la vendedora termina de controlar/editar el pedido y
-- confirma el cartel de "finalizar armado", queda con detalle de qué
-- quedó en stock (tildado) y qué no (sin tildar) para mostrárselo al
-- cliente en pedido.html.
alter table public.pedidos add column if not exists armado_finalizado boolean not null default false;
alter table public.pedidos add column if not exists armado_finalizado_por text;

-- Marcas de tiempo para la alerta de "pedido demorado" del panel (ver
-- pedidoEstaDemorado en admin.js): cuándo se le asignó vendedor/a (sea
-- porque ella lo tomó, o porque el admin lo asignó a mano) y cuándo
-- pasó a "preparado". Se completan solas vía trigger (ver más abajo),
-- nunca a mano, para que no dependa de que cada lugar del código que
-- toca "pedidos" se acuerde de setearlas.
alter table public.pedidos add column if not exists tomado_en timestamptz;
alter table public.pedidos add column if not exists preparado_en timestamptz;

-- Congela "items_original" en el momento de crear el pedido (el
-- cliente inserta directo desde el checkout): así después se puede
-- comparar contra "items" para saber si la vendedora modificó algo.
create or replace function public.congelar_items_original()
returns trigger
language plpgsql
as $$
begin
  new.items_original = new.items;
  return new;
end;
$$;

drop trigger if exists trg_pedidos_items_original on public.pedidos;
create trigger trg_pedidos_items_original before insert on public.pedidos
  for each row execute function public.congelar_items_original();

-- Completa tomado_en/preparado_en automáticamente en el momento exacto
-- de cada transición, sin importar si la update la disparó el admin
-- (actualizarPedido/cambiarEstadoPedido) o una vendedora (tomar_pedido/
-- preparar_pedido_propio): un solo lugar, no hay forma de que alguno de
-- los dos caminos se olvide de marcarla.
create or replace function public.marcar_timestamps_pedido()
returns trigger
language plpgsql
as $$
begin
  if new.vendedor_id is not null and old.vendedor_id is null then
    new.tomado_en = now();
  end if;
  if new.estado = 'preparado' and old.estado is distinct from 'preparado' then
    new.preparado_en = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pedidos_timestamps on public.pedidos;
create trigger trg_pedidos_timestamps before update on public.pedidos
  for each row execute function public.marcar_timestamps_pedido();

-- El check de "estado" se agregó sin nombre explícito en una versión
-- anterior de este archivo (quedó autonombrado "pedidos_estado_check");
-- se reemplaza para poder sumarle "preparado" (paso intermedio entre
-- tomado y pagado) sin duplicar la regla.
alter table public.pedidos drop constraint if exists pedidos_estado_check;
alter table public.pedidos add constraint pedidos_estado_check
  check (estado in ('nuevo', 'asignado', 'preparado', 'completado'));

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_productos_updated on public.productos;
create trigger trg_productos_updated before update on public.productos
  for each row execute function public.set_updated_at();

drop trigger if exists trg_variantes_updated on public.variantes;
create trigger trg_variantes_updated before update on public.variantes
  for each row execute function public.set_updated_at();

drop trigger if exists trg_categorias_updated on public.categorias;
create trigger trg_categorias_updated before update on public.categorias
  for each row execute function public.set_updated_at();

drop trigger if exists trg_config_updated on public.app_config;
create trigger trg_config_updated before update on public.app_config
  for each row execute function public.set_updated_at();

drop trigger if exists trg_vendedores_updated on public.vendedores;
create trigger trg_vendedores_updated before update on public.vendedores
  for each row execute function public.set_updated_at();

-- Cada vez que se toca el catálogo, refleja la fecha en app_config para
-- que index.html pueda mostrar "Actualizado: ...".
create or replace function public.tocar_catalogo_actualizado()
returns trigger
language plpgsql
as $$
begin
  update public.app_config set catalogo_actualizado_en = now() where id = 1;
  return null;
end;
$$;

drop trigger if exists trg_productos_tocar_catalogo on public.productos;
create trigger trg_productos_tocar_catalogo
  after insert or update or delete on public.productos
  for each statement execute function public.tocar_catalogo_actualizado();

drop trigger if exists trg_variantes_tocar_catalogo on public.variantes;
create trigger trg_variantes_tocar_catalogo
  after insert or update or delete on public.variantes
  for each statement execute function public.tocar_catalogo_actualizado();

-- Calcula la etiqueta de stock según las reglas de negocio ya definidas
-- en admin.html ("Criterio de Stock Automático aplicado").
create or replace function public.calcular_stock_estado(p_cantidad numeric)
returns text
language sql
immutable
as $$
  select case
    when p_cantidad is null then 'SIN STOCK'
    when p_cantidad >= 100 then 'HAY STOCK'
    when p_cantidad > 50 then 'POCO STOCK'
    when p_cantidad > 10 then 'POR AGOTARSE'
    else 'SIN STOCK'
  end;
$$;

-- Actualización masiva de precio/stock desde el Excel del panel admin
-- (Sección 1). p_filas es un jsonb array de objetos
-- {"sku": "...", "precio": 999, "stock_cantidad": 120}.
-- No es SECURITY DEFINER: corre con los permisos de quien la llama, así
-- que sigue protegida por las mismas políticas RLS de "variantes".
--
-- Antes recorría las filas una por una con un "for ... loop" (una
-- sentencia UPDATE por fila): con las planillas de 10 mil+ filas que
-- sube esta empresa mayorista, eso significaba 10 mil UPDATEs
-- separados dentro de la misma función, muy lento y sin forma de saber
-- si seguía procesando o se había colgado. Ahora es un único UPDATE
-- "set-based" (join contra jsonb_to_recordset), que el planner resuelve
-- de una sola vez.
create or replace function public.actualizar_precios_stock_masivo(p_filas jsonb)
returns integer
language plpgsql
as $$
declare
  v_actualizadas integer;
begin
  with filas as (
    select
      sku,
      precio,
      stock_cantidad
    from jsonb_to_recordset(p_filas) as t(sku text, precio numeric, stock_cantidad numeric)
  )
  update public.variantes v
  set precio_actual = coalesce(f.precio, v.precio_actual),
      stock_cantidad = coalesce(f.stock_cantidad, v.stock_cantidad),
      stock_estado = public.calcular_stock_estado(coalesce(f.stock_cantidad, v.stock_cantidad))
  from filas f
  where v.sku = f.sku;

  get diagnostics v_actualizadas = row_count;
  return v_actualizadas;
end;
$$;

-- Lectura pública de UN pedido puntual por id, para la página
-- pedido.html (el cliente comparte ese link con la vendedora en vez de
-- archivos, porque generar PDF en el navegador resultó poco confiable
-- en varios celulares). SECURITY DEFINER: se ejecuta con permisos del
-- dueño de la función, no del usuario que llama, así que puede leer
-- "pedidos" aunque su política de SELECT esté restringida al admin.
-- No expone el resto de la tabla: solo devuelve la fila cuyo id exacto
-- se pasa por parámetro (funciona como token de acceso, ya que el uuid
-- no es adivinable), nunca una lista.
-- "create or replace function" no permite cambiar las columnas de un
-- "returns table" ya existente (falla con "cannot change return type");
-- como se le suman columnas de armado/bloqueo, hay que borrarla primero.
drop function if exists public.obtener_pedido_publico(uuid);

create or replace function public.obtener_pedido_publico(p_id uuid)
returns table (
  cliente_nombre       text,
  cliente_telefono     text,
  items                jsonb,
  items_original       jsonb,
  total                numeric,
  cantidad_articulos   integer,
  created_at           timestamptz,
  vendedor_nombre      text,
  items_marcados       jsonb,
  preparado_por_id     uuid,
  preparado_por_nombre text,
  armado_finalizado    boolean,
  armado_finalizado_por text
)
language sql
security definer
set search_path = public
as $$
  select p.cliente_nombre, p.cliente_telefono, p.items, p.items_original, p.total, p.cantidad_articulos,
         p.created_at, v.nombre_completo, p.items_marcados,
         p.preparado_por_id, p.preparado_por_nombre, p.armado_finalizado, p.armado_finalizado_por
  from public.pedidos p
  left join public.vendedores v on v.id = p.vendedor_id
  where p.id = p_id;
$$;

revoke all on function public.obtener_pedido_publico(uuid) from public;
grant execute on function public.obtener_pedido_publico(uuid) to anon, authenticated;

-- Valida el N° de Zeus ingresado en "Preparar Pedido" contra
-- "vendedores" y, si nadie más lo está preparando (o ya lo estaba
-- preparando esa misma persona), toma el bloqueo. Si otra persona ya
-- lo tiene tomado, avisa quién es sin permitir editar.
create or replace function public.iniciar_armado_pedido(p_id uuid, p_numero_zeus text)
returns table (
  ok              boolean,
  motivo          text,
  vendedor_id     uuid,
  vendedor_nombre text,
  bloqueado_por   text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendedor_id     uuid;
  v_vendedor_nombre text;
  v_pedido          record;
begin
  select id, nombre_completo into v_vendedor_id, v_vendedor_nombre
  from public.vendedores
  where activo and trim(numero_zeus) = trim(p_numero_zeus)
  limit 1;

  if v_vendedor_id is null then
    return query select false, 'numero_invalido', null::uuid, null::text, null::text;
    return;
  end if;

  select preparado_por_id, preparado_por_nombre into v_pedido
  from public.pedidos where id = p_id;

  if not found then
    return query select false, 'pedido_inexistente', null::uuid, null::text, null::text;
    return;
  end if;

  if v_pedido.preparado_por_id is not null and v_pedido.preparado_por_id <> v_vendedor_id then
    return query select false, 'bloqueado', v_vendedor_id, v_vendedor_nombre, v_pedido.preparado_por_nombre;
    return;
  end if;

  update public.pedidos
  set preparado_por_id = v_vendedor_id, preparado_por_nombre = v_vendedor_nombre
  where id = p_id;

  return query select true, 'ok', v_vendedor_id, v_vendedor_nombre, null::text;
end;
$$;

revoke all on function public.iniciar_armado_pedido(uuid, text) from public;
grant execute on function public.iniciar_armado_pedido(uuid, text) to anon, authenticated;

-- Guarda los items editados (agregados/sacados) y el total recalculado
-- mientras se arma el pedido. Vuelve a validar el N° de Zeus, y si el
-- pedido está tomado por otra persona no permite guardar (protege
-- contra una pestaña vieja que quedó abierta).
create or replace function public.actualizar_items_pedido(
  p_id uuid,
  p_items jsonb,
  p_total numeric,
  p_cantidad_articulos integer,
  p_numero_zeus text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendedor_id uuid;
  v_pedido      record;
begin
  select id into v_vendedor_id
  from public.vendedores
  where activo and trim(numero_zeus) = trim(p_numero_zeus)
  limit 1;

  if v_vendedor_id is null then
    return false;
  end if;

  select preparado_por_id into v_pedido from public.pedidos where id = p_id;
  if not found then
    return false;
  end if;

  if v_pedido.preparado_por_id is not null and v_pedido.preparado_por_id <> v_vendedor_id then
    return false;
  end if;

  update public.pedidos
  set items = p_items, total = p_total, cantidad_articulos = p_cantidad_articulos
  where id = p_id;

  return true;
end;
$$;

revoke all on function public.actualizar_items_pedido(uuid, jsonb, numeric, integer, text) from public;
grant execute on function public.actualizar_items_pedido(uuid, jsonb, numeric, integer, text) to anon, authenticated;

-- Cierra el armado: marca armado_finalizado y libera el bloqueo (para
-- que, si hace falta corregir algo después, cualquiera pueda volver a
-- entrar a "Preparar Pedido" sin quedar trabado por esta sesión).
create or replace function public.finalizar_armado_pedido(p_id uuid, p_numero_zeus text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendedor_id     uuid;
  v_vendedor_nombre text;
begin
  select id, nombre_completo into v_vendedor_id, v_vendedor_nombre
  from public.vendedores
  where activo and trim(numero_zeus) = trim(p_numero_zeus)
  limit 1;

  if v_vendedor_id is null then
    return false;
  end if;

  update public.pedidos
  set armado_finalizado = true,
      armado_finalizado_por = v_vendedor_nombre,
      preparado_por_id = null,
      preparado_por_nombre = null
  where id = p_id;

  return true;
end;
$$;

revoke all on function public.finalizar_armado_pedido(uuid, text) from public;
grant execute on function public.finalizar_armado_pedido(uuid, text) to anon, authenticated;

-- Permite tildar/destildar una variante puntual del pedido desde
-- pedido.html (checklist de armado), sin exponer el resto de la fila:
-- solo escribe dentro de "items_marcados", identificando el renglón por
-- sku (no por índice, para no depender del orden del array "items").
create or replace function public.marcar_item_pedido(p_id uuid, p_sku text, p_marcado boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pedidos
  set items_marcados = jsonb_set(coalesce(items_marcados, '{}'::jsonb), array[p_sku], to_jsonb(p_marcado), true)
  where id = p_id;
$$;

revoke all on function public.marcar_item_pedido(uuid, text, boolean) from public;
grant execute on function public.marcar_item_pedido(uuid, text, boolean) to anon, authenticated;

-- Lista liviana de vendedores para el desplegable opcional del
-- checkout ("elegí tu vendedor/a preferido"). Los datos completos de
-- "vendedores" (incluido el N° de Zeus) siguen sin lectura pública;
-- esta función SECURITY DEFINER solo expone lo necesario para elegir.
create or replace function public.obtener_vendedores_publico()
returns table (id uuid, nombre_completo text, provincia text)
language sql
security definer
set search_path = public
as $$
  select id, nombre_completo, provincia
  from public.vendedores
  where activo
  order by provincia, nombre_completo;
$$;

revoke all on function public.obtener_vendedores_publico() from public;
grant execute on function public.obtener_vendedores_publico() to anon, authenticated;

-- Si el cliente no elige vendedor/a en el checkout, el pedido queda sin
-- asignar (vendedor_id null) para que el admin lo asigne a mano desde
-- el panel. Antes se auto-asignaba acá al que tenía menos pedidos
-- activos; se borra esa función porque ya no se llama desde ningún
-- lado (evita dejar código muerto en la base).
drop function if exists public.asignar_vendedor_automatico();

-- ---------------------------------------------------------------------
-- Perfiles de acceso al panel admin (multi-usuario con roles)
--
-- Antes había un único usuario fijo de Supabase Auth (admin@panther...)
-- y cualquiera que entrara con ese PIN podía hacer cualquier cosa. Con
-- el panel volviéndose más crítico, se pasa a cuentas individuales:
-- cada persona (admin o vendedora) tiene su propio login de Supabase
-- Auth, y esta tabla guarda qué nombre/rol le corresponde a cada una.
--
-- Alta de un usuario nuevo: se crea la cuenta desde el Dashboard de
-- Supabase (Authentication → Users → Add user, con su email y
-- contraseña), y con el UUID que le asigna Supabase se completa el
-- nombre/rol acá (desde el tab "Usuarios" del panel admin, o a mano en
-- este mismo SQL Editor). No se crea el usuario de Auth desde el
-- navegador para no tener que exponer la Service Role Key ahí.
-- ---------------------------------------------------------------------

create table if not exists public.perfiles_admin (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null,
  rol         text not null default 'vendedora' check (rol in ('admin', 'vendedora', 'editor')),
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- "check" no admite "if not exists": si la tabla ya existía de antes de
-- sumar el rol "editor", se reemplaza el constraint para no quedar
-- pisado por la definición vieja (solo 'admin'/'vendedora').
alter table public.perfiles_admin drop constraint if exists perfiles_admin_rol_check;
alter table public.perfiles_admin add constraint perfiles_admin_rol_check
  check (rol in ('admin', 'vendedora', 'editor'));

-- Vincula la cuenta de login (este perfil) con su fila en "vendedores"
-- (nombre real, provincia, N° de Zeus). Sin esto no hay forma de saber,
-- cuando una vendedora entra al panel con su propio usuario, cuál es
-- "ella" dentro de la tabla de vendedores para las funciones de abajo
-- (tomar_pedido, completar_pedido_propio). Solo tiene sentido para rol
-- "vendedora"; el admin lo completa a mano en el tab Usuarios.
alter table public.perfiles_admin add column if not exists vendedor_id uuid references public.vendedores(id) on delete set null;

drop trigger if exists trg_perfiles_admin_updated on public.perfiles_admin;
create trigger trg_perfiles_admin_updated before update on public.perfiles_admin
  for each row execute function public.set_updated_at();

-- Funciones "security definer": corren con los permisos de quien las
-- creó (el proyecto de Supabase), no de quien las llama, así que pueden
-- leer perfiles_admin aunque su propia política de RLS (ver más abajo)
-- le impida a un usuario cualquiera ver la fila de otro. Sin esto,
-- cualquier política que quisiera chequear el rol del usuario actual
-- caería en una referencia circular contra su propia tabla.
create or replace function public.es_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.perfiles_admin
    where id = auth.uid() and rol = 'admin' and activo
  );
$$;

create or replace function public.tiene_acceso_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.perfiles_admin
    where id = auth.uid() and activo
  );
$$;

-- Rol intermedio "editor": puede cargar/editar catálogo (productos,
-- variantes, categorías) y la lista de vendedoras, pero no ve ni toca
-- Gestión Pedidos, Configuración ni Usuarios (eso queda solo para admin).
create or replace function public.puede_editar_catalogo()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.perfiles_admin
    where id = auth.uid() and rol in ('admin', 'editor') and activo
  );
$$;

-- ---------------------------------------------------------------------
-- Autoservicio de pedidos para vendedoras: antes, solo el admin podía
-- tocar "pedidos" (pedidos_escritura_admin más abajo sigue siendo
-- es_admin()-only), así que una vendedora dependía de avisarle al admin
-- para que asigne/complete cada pedido. Estas dos funciones SECURITY
-- DEFINER le dan a cada vendedora un camino angosto y seguro para
-- tomar un pedido sin dueño y cerrar los suyos, sin necesidad de
-- otorgarle UPDATE directo sobre toda la tabla.
-- ---------------------------------------------------------------------

-- Toma un pedido sin vendedor/a asignado (o que ya es suyo) de forma
-- atómica: el "where vendedor_id is null" en el update es lo que evita
-- que dos vendedoras se lo lleven a la vez (la segunda en llegar
-- actualiza 0 filas y se entera de que ya estaba tomado).
create or replace function public.tomar_pedido(p_id uuid)
returns table (ok boolean, motivo text, vendedor_nombre text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendedor_id     uuid;
  v_vendedor_nombre text;
  v_actualizadas    integer;
  v_actual_nombre   text;
begin
  select pa.vendedor_id, v.nombre_completo into v_vendedor_id, v_vendedor_nombre
  from public.perfiles_admin pa
  join public.vendedores v on v.id = pa.vendedor_id and v.activo
  where pa.id = auth.uid() and pa.rol = 'vendedora' and pa.activo;

  if v_vendedor_id is null then
    return query select false, 'sin_vendedor_vinculado', null::text;
    return;
  end if;

  update public.pedidos
  set vendedor_id = v_vendedor_id,
      estado = case when estado = 'nuevo' then 'asignado' else estado end
  where id = p_id and estado <> 'completado' and (vendedor_id is null or vendedor_id = v_vendedor_id);

  get diagnostics v_actualizadas = row_count;

  if v_actualizadas = 0 then
    select v.nombre_completo into v_actual_nombre
    from public.pedidos p
    join public.vendedores v on v.id = p.vendedor_id
    where p.id = p_id;

    return query select false, 'ya_asignado', v_actual_nombre;
    return;
  end if;

  return query select true, 'ok', v_vendedor_nombre;
end;
$$;

revoke all on function public.tomar_pedido(uuid) from public;
grant execute on function public.tomar_pedido(uuid) to authenticated;

-- Marca como "preparado" un pedido que ya es suyo y todavía está
-- "asignado" (tomado). Es el paso intermedio obligatorio antes de poder
-- cerrarlo como pagado (ver completar_pedido_propio más abajo).
create or replace function public.preparar_pedido_propio(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendedor_id  uuid;
  v_actualizadas integer;
begin
  select vendedor_id into v_vendedor_id
  from public.perfiles_admin
  where id = auth.uid() and rol = 'vendedora' and activo;

  if v_vendedor_id is null then
    return false;
  end if;

  update public.pedidos
  set estado = 'preparado'
  where id = p_id and vendedor_id = v_vendedor_id and estado = 'asignado';

  get diagnostics v_actualizadas = row_count;
  return v_actualizadas > 0;
end;
$$;

revoke all on function public.preparar_pedido_propio(uuid) from public;
grant execute on function public.preparar_pedido_propio(uuid) to authenticated;

-- Cierra (estado "completado"/pagado) un pedido que ya es suyo y que ya
-- pasó por "preparado". No permite tocar pedidos de otra vendedora ni
-- saltearse el paso de preparado (para eso están tomar_pedido y
-- preparar_pedido_propio antes).
create or replace function public.completar_pedido_propio(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendedor_id  uuid;
  v_actualizadas integer;
begin
  select vendedor_id into v_vendedor_id
  from public.perfiles_admin
  where id = auth.uid() and rol = 'vendedora' and activo;

  if v_vendedor_id is null then
    return false;
  end if;

  update public.pedidos
  set estado = 'completado'
  where id = p_id and vendedor_id = v_vendedor_id and estado = 'preparado';

  get diagnostics v_actualizadas = row_count;
  return v_actualizadas > 0;
end;
$$;

revoke all on function public.completar_pedido_propio(uuid) from public;
grant execute on function public.completar_pedido_propio(uuid) to authenticated;

-- Migra al único admin histórico (usuario fijo de antes de que
-- existiera esta tabla) para que no pierda el acceso: si ya tiene una
-- cuenta de Auth con ese email, le asigna rol "admin" acá. No hace nada
-- si esa cuenta no existe (proyecto nuevo) o si ya estaba migrada.
insert into public.perfiles_admin (id, nombre, rol)
select id, 'Admin', 'admin'
from auth.users
where email = 'admin@panther.internal'
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.productos enable row level security;
alter table public.variantes enable row level security;
alter table public.categorias enable row level security;
alter table public.app_config enable row level security;
alter table public.pedidos enable row level security;
alter table public.vendedores enable row level security;
alter table public.perfiles_admin enable row level security;

-- "create policy" no admite "if not exists": para que el archivo entero
-- sea seguro de re-ejecutar (ya pasó que una corrida anterior dejó
-- creadas las de "productos" y volver a correr todo el script rompía
-- ahí), se borra primero la policy si ya existe.
drop policy if exists "productos_lectura_publica" on public.productos;
create policy "productos_lectura_publica" on public.productos
  for select using (true);
drop policy if exists "productos_escritura_admin" on public.productos;
create policy "productos_escritura_admin" on public.productos
  for all using (public.puede_editar_catalogo()) with check (public.puede_editar_catalogo());

drop policy if exists "variantes_lectura_publica" on public.variantes;
create policy "variantes_lectura_publica" on public.variantes
  for select using (true);
drop policy if exists "variantes_escritura_admin" on public.variantes;
create policy "variantes_escritura_admin" on public.variantes
  for all using (public.puede_editar_catalogo()) with check (public.puede_editar_catalogo());

drop policy if exists "categorias_lectura_publica" on public.categorias;
create policy "categorias_lectura_publica" on public.categorias
  for select using (true);
drop policy if exists "categorias_escritura_admin" on public.categorias;
create policy "categorias_escritura_admin" on public.categorias
  for all using (public.puede_editar_catalogo()) with check (public.puede_editar_catalogo());

drop policy if exists "config_lectura_publica" on public.app_config;
create policy "config_lectura_publica" on public.app_config
  for select using (true);
drop policy if exists "config_escritura_admin" on public.app_config;
create policy "config_escritura_admin" on public.app_config
  for update using (public.es_admin()) with check (public.es_admin());

drop policy if exists "pedidos_insert_publico" on public.pedidos;
create policy "pedidos_insert_publico" on public.pedidos
  for insert with check (true);
-- Lectura: admin y vendedora (pestaña "Gestión Pedidos" del panel).
-- Escritura/borrado: solo admin (asignar vendedor/a, completar,
-- corregir datos o eliminar un pedido quedan reservados al admin).
drop policy if exists "pedidos_lectura_admin" on public.pedidos;
create policy "pedidos_lectura_admin" on public.pedidos
  for select using (public.tiene_acceso_admin());
drop policy if exists "pedidos_escritura_admin" on public.pedidos;
create policy "pedidos_escritura_admin" on public.pedidos
  for update using (public.es_admin());
drop policy if exists "pedidos_borrado_admin" on public.pedidos;
create policy "pedidos_borrado_admin" on public.pedidos
  for delete using (public.es_admin());

-- Vendedores: son datos internos de la empresa (no hace falta que el
-- cliente los vea), así que a diferencia del catálogo van sin lectura
-- pública. Accesible para admin y editor de catálogo (mismo grupo que
-- puede tocar productos/categorías).
drop policy if exists "vendedores_lectura_admin" on public.vendedores;
create policy "vendedores_lectura_admin" on public.vendedores
  for select using (public.puede_editar_catalogo());
drop policy if exists "vendedores_escritura_admin" on public.vendedores;
create policy "vendedores_escritura_admin" on public.vendedores
  for all using (public.puede_editar_catalogo()) with check (public.puede_editar_catalogo());

-- Perfiles: cada quien puede ver su propio perfil (para saber su
-- nombre/rol al entrar al panel); solo el admin puede ver la lista
-- completa o dar de alta/editar/borrar perfiles de otras personas.
drop policy if exists "perfiles_lectura_propia_o_admin" on public.perfiles_admin;
create policy "perfiles_lectura_propia_o_admin" on public.perfiles_admin
  for select using (id = auth.uid() or public.es_admin());
drop policy if exists "perfiles_escritura_admin" on public.perfiles_admin;
create policy "perfiles_escritura_admin" on public.perfiles_admin
  for all using (public.es_admin()) with check (public.es_admin());

-- ---------------------------------------------------------------------
-- Storage: bucket público de fotos de producto y placeholder.
-- Lectura pública, escritura solo admin autenticado.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('assets-publicos', 'assets-publicos', true)
on conflict (id) do nothing;

drop policy if exists "assets_lectura_publica" on storage.objects;
create policy "assets_lectura_publica" on storage.objects
  for select using (bucket_id = 'assets-publicos');
drop policy if exists "assets_escritura_admin" on storage.objects;
create policy "assets_escritura_admin" on storage.objects
  for insert with check (bucket_id = 'assets-publicos' and public.puede_editar_catalogo());
drop policy if exists "assets_actualizacion_admin" on storage.objects;
create policy "assets_actualizacion_admin" on storage.objects
  for update using (bucket_id = 'assets-publicos' and public.puede_editar_catalogo());
drop policy if exists "assets_borrado_admin" on storage.objects;
create policy "assets_borrado_admin" on storage.objects
  for delete using (bucket_id = 'assets-publicos' and public.puede_editar_catalogo());
