// =====================================================================
// Logo de Panther Distribuciones: archivo real de la marca, subido por
// el cliente a assets/img/logo.png (huella de pata + "PANTHER
// DISTRIBUCIONES" en verde, fondo transparente).
// =====================================================================

const LOGO_DATA_URL = "assets/img/logo.png";

// Apenas carga el DOM, a cualquier <img class="header-logo-img"> que
// exista en la página (index.html, pedido.html, admin.html: este último
// tiene dos, uno en la pantalla de bloqueo y otro en el header del
// panel, por eso se recorren todas en vez de buscar un único id) se le
// asigna el logo.
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".header-logo-img").forEach(function (img) {
    img.src = LOGO_DATA_URL;
  });
});
