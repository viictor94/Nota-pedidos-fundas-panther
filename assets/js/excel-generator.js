// =====================================================================
// Generador del Excel del pedido (usa SheetJS / XLSX, cargado como
// <script> en index.html).
// =====================================================================

function generarExcelPedido(pedido) {
  const filas = pedido.items.map(function (item) {
    return {
      sku: item.sku,
      descripcion: item.productoNombre + " " + item.modelo,
      cantidad: item.cantidad,
      precio: item.precioUnitario,
    };
  });

  // Fila de total al final de la planilla.
  filas.push({
    sku: "",
    descripcion: "TOTAL",
    cantidad: pedido.cantidadArticulos,
    precio: pedido.total,
  });

  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Pedido");

  // Encabezado con datos del cliente en una segunda hoja.
  const hojaCliente = XLSX.utils.json_to_sheet([
    {
      Cliente: pedido.clienteNombre,
      Telefono: pedido.clienteTelefono,
      Fecha: new Date(pedido.fecha).toLocaleString("es-AR"),
      "Total Articulos": pedido.cantidadArticulos,
      "Total a Pagar": pedido.total,
    },
  ]);
  XLSX.utils.book_append_sheet(libro, hojaCliente, "Datos Cliente");

  const arrayBuffer = XLSX.write(libro, { type: "array", bookType: "xlsx" });
  const blob = new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const nombreArchivo = "pedido-" + (pedido.id || Date.now()) + ".xlsx";
  return new File([blob], nombreArchivo, { type: blob.type });
}
