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

-- El check de "estado" se agregó sin nombre explícito en una versión
-- anterior de este archivo (quedó autonombrado "pedidos_estado_check");
-- se reemplaza para poder sumarle "completado" sin duplicar la regla.
alter table public.pedidos drop constraint if exists pedidos_estado_check;
alter table public.pedidos add constraint pedidos_estado_check
  check (estado in ('nuevo', 'asignado', 'completado'));

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
-- como se le suma "items_marcados", hay que borrarla primero.
drop function if exists public.obtener_pedido_publico(uuid);

create or replace function public.obtener_pedido_publico(p_id uuid)
returns table (
  cliente_nombre     text,
  cliente_telefono   text,
  items              jsonb,
  total              numeric,
  cantidad_articulos integer,
  created_at         timestamptz,
  vendedor_nombre    text,
  items_marcados     jsonb
)
language sql
security definer
set search_path = public
as $$
  select p.cliente_nombre, p.cliente_telefono, p.items, p.total, p.cantidad_articulos, p.created_at, v.nombre_completo, p.items_marcados
  from public.pedidos p
  left join public.vendedores v on v.id = p.vendedor_id
  where p.id = p_id;
$$;

revoke all on function public.obtener_pedido_publico(uuid) from public;
grant execute on function public.obtener_pedido_publico(uuid) to anon, authenticated;

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
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.productos enable row level security;
alter table public.variantes enable row level security;
alter table public.app_config enable row level security;
alter table public.pedidos enable row level security;
alter table public.vendedores enable row level security;

-- "create policy" no admite "if not exists": para que el archivo entero
-- sea seguro de re-ejecutar (ya pasó que una corrida anterior dejó
-- creadas las de "productos" y volver a correr todo el script rompía
-- ahí), se borra primero la policy si ya existe.
drop policy if exists "productos_lectura_publica" on public.productos;
create policy "productos_lectura_publica" on public.productos
  for select using (true);
drop policy if exists "productos_escritura_admin" on public.productos;
create policy "productos_escritura_admin" on public.productos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "variantes_lectura_publica" on public.variantes;
create policy "variantes_lectura_publica" on public.variantes
  for select using (true);
drop policy if exists "variantes_escritura_admin" on public.variantes;
create policy "variantes_escritura_admin" on public.variantes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "config_lectura_publica" on public.app_config;
create policy "config_lectura_publica" on public.app_config
  for select using (true);
drop policy if exists "config_escritura_admin" on public.app_config;
create policy "config_escritura_admin" on public.app_config
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "pedidos_insert_publico" on public.pedidos;
create policy "pedidos_insert_publico" on public.pedidos
  for insert with check (true);
drop policy if exists "pedidos_lectura_admin" on public.pedidos;
create policy "pedidos_lectura_admin" on public.pedidos
  for select using (auth.role() = 'authenticated');
drop policy if exists "pedidos_escritura_admin" on public.pedidos;
create policy "pedidos_escritura_admin" on public.pedidos
  for update using (auth.role() = 'authenticated');
drop policy if exists "pedidos_borrado_admin" on public.pedidos;
create policy "pedidos_borrado_admin" on public.pedidos
  for delete using (auth.role() = 'authenticated');

-- Vendedores: son datos internos de la empresa (no hace falta que el
-- cliente los vea), así que a diferencia del catálogo van sin lectura
-- pública, solo admin autenticado.
drop policy if exists "vendedores_lectura_admin" on public.vendedores;
create policy "vendedores_lectura_admin" on public.vendedores
  for select using (auth.role() = 'authenticated');
drop policy if exists "vendedores_escritura_admin" on public.vendedores;
create policy "vendedores_escritura_admin" on public.vendedores
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

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
  for insert with check (bucket_id = 'assets-publicos' and auth.role() = 'authenticated');
drop policy if exists "assets_actualizacion_admin" on storage.objects;
create policy "assets_actualizacion_admin" on storage.objects
  for update using (bucket_id = 'assets-publicos' and auth.role() = 'authenticated');
drop policy if exists "assets_borrado_admin" on storage.objects;
create policy "assets_borrado_admin" on storage.objects
  for delete using (bucket_id = 'assets-publicos' and auth.role() = 'authenticated');
