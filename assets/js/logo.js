// =====================================================================
// Logo de Panther Distribuciones.
//
// Recreación vectorial (SVG) del logo real de la marca: huella de pata
// negra + "PANTHER DISTRIBUCIONES" en verde. Se redibujó a mano porque
// el archivo original se compartió como imagen dentro del chat, sin
// quedar disponible como archivo en este entorno para copiarlo tal
// cual. Si en algún momento se cuenta con el archivo original
// (PNG/JPG de mejor calidad):
// 1. Subilo a assets/img/logo.png.
// 2. Reemplazá el valor de LOGO_DATA_URL por esa ruta ("assets/img/logo.png").
// No hace falta tocar ningún otro archivo: el header de index.html,
// admin.html y pedido.html leen esta misma constante.
// =====================================================================

const LOGO_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="700" height="220" viewBox="0 0 700 220">
    <g fill="#1a1a1a">
      <!-- Almohadilla principal -->
      <path d="M55,150 C33,118 44,84 88,78 C133,72 172,94 178,136 C184,174 156,208 112,213 C74,217 50,187 55,150 Z"/>
      <!-- Dedos -->
      <ellipse cx="50" cy="72" rx="25" ry="33" transform="rotate(-22 50 72)"/>
      <ellipse cx="98" cy="42" rx="31" ry="41" transform="rotate(-8 98 42)"/>
      <ellipse cx="155" cy="40" rx="31" ry="41" transform="rotate(8 155 40)"/>
      <ellipse cx="200" cy="66" rx="27" ry="35" transform="rotate(24 200 66)"/>
      <!-- Garras -->
      <path d="M14,92 L32,80 L28,104 Z" transform="rotate(-25 24 92)"/>
      <path d="M70,26 L86,14 L84,38 Z"/>
      <path d="M168,24 L184,14 L182,38 Z"/>
      <path d="M220,50 L238,42 L228,66 Z" transform="rotate(18 228 54)"/>
    </g>
    <text x="255" y="105" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="800" fill="#3e863c">PANTHER</text>
    <text x="255" y="158" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="600" letter-spacing="2" fill="#3e863c">DISTRIBUCIONES</text>
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
