# Nota de Pedidos Fundas - Panther Distribuciones

App web de catálogo y pedidos para Panther Distribuciones. El cliente arma
su pedido de fundas de celular sin necesidad de crear cuenta, y lo envía
como PDF + Excel por WhatsApp a un vendedor. Un panel de administración
protegido por PIN permite gestionar precios, stock, fotos y productos.

## Stack

- HTML5 + CSS3 + JavaScript vanilla (sin frameworks ni build step).
- [Supabase](https://supabase.com) como backend: base de datos Postgres,
  autenticación del panel admin y Storage para las fotos de producto.
- `html2pdf.js` y `SheetJS` (vía CDN) para generar el PDF y el Excel del
  pedido en el navegador.

## 1. Crear el proyecto de Supabase

1. Creá un proyecto nuevo en [supabase.com](https://supabase.com/dashboard).
2. Andá a **SQL Editor** y ejecutá todo el contenido de
   [`supabase/schema.sql`](supabase/schema.sql). Esto crea las tablas
   (`productos`, `variantes`, `app_config`, `pedidos`), las políticas de
   Row Level Security, y el bucket público `assets-publicos`.
3. Andá a **Authentication → Settings** y bajá el "Minimum password
   length" a `4` (el PIN de admin funciona como contraseña de un único
   usuario).
4. Andá a **Authentication → Users → Add user** y creá **un solo
   usuario**:
   - Email: `admin@panther.internal` (interno, el cliente nunca lo ve)
   - Password: el PIN inicial que quieras (ej. `1234`)
   - Marcá "Auto Confirm User".
5. Andá a **Project Settings → API** y copiá:
   - **Project URL**
   - **anon public key**

## 2. Configurar el frontend con tus credenciales de Supabase

Editá [`assets/js/supabase-client.js`](assets/js/supabase-client.js) y
reemplazá `SUPABASE_URL` y `SUPABASE_ANON_KEY` por los valores del paso
anterior. La anon key es segura para commitear: no es un secreto, la
seguridad la dan las políticas de RLS (ver comentarios en el archivo y
en `supabase/schema.sql`).

## 3. Migrar el catálogo real desde Productos.xlsx

```bash
cd scripts
npm install
cp .env.example .env
# completar SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en scripts/.env
# (Project Settings > API > service_role — esta clave SÍ es secreta,
# nunca se usa en el frontend, solo en este script local)

npm run migrar:dry-run   # valida el parseo sin tocar Supabase
npm run migrar           # migra de verdad (agrega --truncate para reiniciar)
```

Ver [`scripts/migrar-productos.mjs`](scripts/migrar-productos.mjs) para el
detalle de cómo se mapean las 68 hojas de producto a `productos` +
`variantes`, y cómo se extraen las fotos incrustadas en el Excel.

## 4. Logo pendiente

Todavía no existe un archivo de logo real de Panther Distribuciones en el
proyecto. Mientras tanto, `assets/js/logo.js` genera un logo de texto de
reemplazo. Cuando tengas el logo real (PNG o SVG), reemplazá el valor de
`LOGO_DATA_URL` en ese archivo — no hace falta tocar nada más, tanto el
header del catálogo como el PDF lo toman de ahí.

## 5. Probar localmente

Al ser una app 100% estática, cualquier servidor de archivos sirve:

```bash
npx serve .
# o
npx http-server .
```

Abrí `index.html` para el catálogo y `admin.html` para el panel de
administración. El flujo de "compartir" (`navigator.share`) con PDF+Excel
adjuntos solo funciona en navegadores móviles (Android Chrome / iOS
Safari); en desktop cae automáticamente al modo de descarga.

## 6. Deploy

Sin build step: en Netlify o Vercel, configurá el proyecto como sitio
estático con la raíz del repo como "publish directory" y sin comando de
build.

## Estructura del proyecto

```
index.html              Catálogo cliente + checkout
admin.html               Panel de administración
assets/css/styles.css    Estilos (mobile-first, sin frameworks)
assets/js/
  supabase-client.js      Cliente único de Supabase
  data.js                 Capa de acceso a datos (compartida)
  logo.js                 Logo (placeholder hasta tener el real)
  app.js                  Lógica del catálogo/checkout
  admin.js                Lógica del panel admin
  pdf-generator.js         Genera el PDF del pedido
  excel-generator.js       Genera el Excel del pedido
supabase/schema.sql       Esquema completo de la base de datos
scripts/migrar-productos.mjs  Migración de Productos.xlsx a Supabase
AGENTS.md                  Brief de producto original
```
