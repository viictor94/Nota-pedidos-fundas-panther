// =====================================================================
// Generador del Excel de un pedido (usa SheetJS / XLSX). Lo usa
// exclusivamente el panel admin (admin.html) para descargar el pedido
// que arma un cliente: el cliente nunca genera ni descarga este
// archivo, solo comparte el link de pedido.html.
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

// Historial de pedidos de un vendedor/a puntual (botón "Descargar
// historial" del reporte por vendedor/a en el admin). Una fila por
// pedido, con el link a pedido.html para poder abrir el detalle
// completo sin tener que buscarlo de nuevo en el panel.
function generarExcelHistorialVendedor(vendedor, pedidos) {
  const filas = pedidos.map(function (pedido) {
    return {
      "Fecha y hora": new Date(pedido.created_at).toLocaleString("es-AR"),
      Cliente: pedido.cliente_nombre,
      Telefono: pedido.cliente_telefono,
      "Importe Total": pedido.total,
      "Link del Pedido": window.location.origin + "/pedido.html?id=" + pedido.id,
    };
  });

  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Historial");

  const arrayBuffer = XLSX.write(libro, { type: "array", bookType: "xlsx" });
  const blob = new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const nombreArchivo = "historial-" + vendedor.nombre_completo.replace(/\s+/g, "-").toLowerCase() + ".xlsx";
  return new File([blob], nombreArchivo, { type: blob.type });
}
