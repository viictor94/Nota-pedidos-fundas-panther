// =====================================================================
// Logo de Panther Distribuciones.
//
// NOTA: todavía no existe un archivo de logo real (PNG/SVG de la marca)
// en el proyecto. Mientras el cliente no entregue el archivo definitivo,
// se usa un logo de texto generado como SVG embebido en base64, para no
// depender de ningún archivo externo que pueda faltar (evita el 404 que
// tenía la app original con "assets/img/Logos Clasico - .png").
//
// Cuando exista el logo real:
// 1. Subilo a assets/img/logo.png (o al bucket "assets-publicos" de
//    Supabase si preferís servirlo desde ahí).
// 2. Reemplazá el valor de LOGO_DATA_URL por esa ruta/URL.
// No hace falta tocar ningún otro archivo: tanto el header de
// index.html como el generador de PDF leen esta misma constante.
// =====================================================================

const LOGO_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="220" height="70" viewBox="0 0 220 70">
    <rect width="220" height="70" rx="12" fill="#3e863c"/>
    <text x="110" y="34" font-family="Arial, sans-serif" font-size="22" font-weight="800"
      fill="#ffffff" text-anchor="middle">PANTHER</text>
    <text x="110" y="54" font-family="Arial, sans-serif" font-size="11" font-weight="600"
      fill="#e9f7e9" text-anchor="middle" letter-spacing="1">DISTRIBUCIONES</text>
  </svg>
`;

const LOGO_DATA_URL = `data:image/svg+xml;base64,${btoa(LOGO_SVG)}`;

// Apenas carga el DOM, si existe el <img id="header-logo"> (solo en
// index.html), se le asigna el logo.
document.addEventListener("DOMContentLoaded", function () {
  const headerLogo = document.getElementById("header-logo");
  if (headerLogo) {
    headerLogo.src = LOGO_DATA_URL;
  }
});
