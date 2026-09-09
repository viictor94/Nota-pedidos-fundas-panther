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
-- Excel (ahí pasa a "asignado" automáticamente), y qué vendedor/a quedó
-- a cargo. Se agregan con alter (en vez de solo en el create table de
-- arriba) para que el script sea seguro de re-ejecutar sobre una base
-- ya provisionada de antes.
alter table public.pedidos add column if not exists estado text not null default 'nuevo'
  check (estado in ('nuevo', 'asignado'));
alter table public.pedidos add column if not exists vendedor_id uuid references public.vendedores(id) on delete set null;

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
create or replace function public.actualizar_precios_stock_masivo(p_filas jsonb)
returns integer
language plpgsql
as $$
declare
  v_fila jsonb;
  v_actualizadas integer := 0;
begin
  for v_fila in select * from jsonb_array_elements(p_filas)
  loop
    update public.variantes
      set precio_actual = coalesce((v_fila->>'precio')::numeric, precio_actual),
          stock_cantidad = coalesce((v_fila->>'stock_cantidad')::numeric, stock_cantidad),
          stock_estado = public.calcular_stock_estado(
            coalesce((v_fila->>'stock_cantidad')::numeric, stock_cantidad)
          )
      where sku = v_fila->>'sku';

    if found then
      v_actualizadas := v_actualizadas + 1;
    end if;
  end loop;

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
create or replace function public.obtener_pedido_publico(p_id uuid)
returns table (
  cliente_nombre     text,
  cliente_telefono   text,
  items              jsonb,
  total              numeric,
  cantidad_articulos integer,
  created_at         timestamptz
)
language sql
security definer
set search_path = public
as $$
  select cliente_nombre, cliente_telefono, items, total, cantidad_articulos, created_at
  from public.pedidos
  where id = p_id;
$$;

revoke all on function public.obtener_pedido_publico(uuid) from public;
grant execute on function public.obtener_pedido_publico(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.productos enable row level security;
alter table public.variantes enable row level security;
alter table public.app_config enable row level security;
alter table public.pedidos enable row level security;
alter table public.vendedores enable row level security;

create policy "productos_lectura_publica" on public.productos
  for select using (true);
create policy "productos_escritura_admin" on public.productos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "variantes_lectura_publica" on public.variantes
  for select using (true);
create policy "variantes_escritura_admin" on public.variantes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "config_lectura_publica" on public.app_config
  for select using (true);
create policy "config_escritura_admin" on public.app_config
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "pedidos_insert_publico" on public.pedidos
  for insert with check (true);
create policy "pedidos_lectura_admin" on public.pedidos
  for select using (auth.role() = 'authenticated');
create policy "pedidos_escritura_admin" on public.pedidos
  for update using (auth.role() = 'authenticated');
create policy "pedidos_borrado_admin" on public.pedidos
  for delete using (auth.role() = 'authenticated');

-- Vendedores: son datos internos de la empresa (no hace falta que el
-- cliente los vea), así que a diferencia del catálogo van sin lectura
-- pública, solo admin autenticado.
create policy "vendedores_lectura_admin" on public.vendedores
  for select using (auth.role() = 'authenticated');
create policy "vendedores_escritura_admin" on public.vendedores
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------
-- Storage: bucket público de fotos de producto y placeholder.
-- Lectura pública, escritura solo admin autenticado.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('assets-publicos', 'assets-publicos', true)
on conflict (id) do nothing;

create policy "assets_lectura_publica" on storage.objects
  for select using (bucket_id = 'assets-publicos');
create policy "assets_escritura_admin" on storage.objects
  for insert with check (bucket_id = 'assets-publicos' and auth.role() = 'authenticated');
create policy "assets_actualizacion_admin" on storage.objects
  for update using (bucket_id = 'assets-publicos' and auth.role() = 'authenticated');
create policy "assets_borrado_admin" on storage.objects
  for delete using (bucket_id = 'assets-publicos' and auth.role() = 'authenticated');
