// =====================================================================
// Logo de Panther Distribuciones: archivo real de la marca, subido por
// el cliente a assets/img/logo.png (huella de pata + "PANTHER
// DISTRIBUCIONES" en verde, fondo transparente).
// =====================================================================

const LOGO_DATA_URL = "assets/img/logo.png";

// Apenas carga el DOM, si existe el <img id="header-logo"> (index.html
// y pedido.html), se le asigna el logo.
document.addEventListener("DOMContentLoaded", function () {
  const headerLogo = document.getElementById("header-logo");
  if (headerLogo) {
    headerLogo.src = LOGO_DATA_URL;
  }
});
