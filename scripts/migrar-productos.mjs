// =====================================================================
// Migra el catálogo real desde Productos.xlsx (69 hojas: 1 auxiliar +
// 68 de producto) hacia Supabase (tablas productos/variantes + bucket
// de Storage "assets-publicos").
//
// Uso:
//   cd scripts
//   npm install
//   cp .env.example .env   # completar SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
//   npm run migrar:dry-run   # valida el parseo sin tocar Supabase (recomendado primero)
//   npm run migrar           # migra de verdad (usa --truncate para reiniciar antes)
//
// Por qué service_role key y no la anon key: este script necesita
// escribir sin las restricciones de Row Level Security (inserta todo
// el catálogo de una sola vez). La service_role key es secreta y NUNCA
// debe usarse en el navegador; por eso este script vive aparte, en
// scripts/, con su propio .env que no se commitea.
// =====================================================================

import "dotenv/config";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUTA_EXCEL = path.join(__dirname, "..", "Productos.xlsx");
const HOJA_A_EXCLUIR = "LISTAS-MOTOR";
const ESTADOS_STOCK_VALIDOS = ["HAY STOCK", "POCO STOCK", "POR AGOTARSE", "SIN STOCK"];

const esDryRun = process.argv.includes("--dry-run");
const debeTruncar = process.argv.includes("--truncate");

async function main() {
  console.log("Leyendo " + RUTA_EXCEL + " ...");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(RUTA_EXCEL);

  const hojasProducto = workbook.worksheets.filter(function (hoja) {
    return hoja.name !== HOJA_A_EXCLUIR;
  });
  console.log("Hojas de producto encontradas: " + hojasProducto.length);

  const productos = [];
  const advertencias = [];

  for (const hoja of hojasProducto) {
    const producto = procesarHojaProducto(workbook, hoja, advertencias);
    if (producto) {
      productos.push(producto);
    }
  }

  const totalVariantes = productos.reduce(function (total, p) {
    return total + p.variantes.length;
  }, 0);
  console.log("Productos parseados: " + productos.length);
  console.log("Variantes parseadas: " + totalVariantes);
  if (advertencias.length > 0) {
    console.log("Advertencias (" + advertencias.length + "):");
    advertencias.forEach(function (a) {
      console.log("  - " + a);
    });
  }

  if (esDryRun) {
    await guardarResultadoDryRun(productos);
    return;
  }

  await migrarASupabase(productos, debeTruncar);
}

// ---------------------------------------------------------------------
// Parseo de una hoja de producto
// ---------------------------------------------------------------------

function procesarHojaProducto(workbook, hoja, advertencias) {
  const nombreProducto = hoja.name.trim();
  const variantes = [];

  // Los datos empiezan en la fila 3 (fila 1 = banner, fila 2 = encabezados).
  for (let numeroFila = 3; numeroFila <= hoja.rowCount; numeroFila++) {
    const fila = hoja.getRow(numeroFila);
    const codigo = valorCelda(fila.getCell(1));

    // Fila en blanco: puede ser el final de la tabla o un simple
    // espaciador antes de una sub-sección (algunas hojas repiten los
    // encabezados en el medio); se salta sin cortar la lectura, la
    // fila de pie "SUBTOTAL PAGINA" es la que realmente marca el final.
    if (codigo === null || codigo === "") {
      continue;
    }

    // Todas las hojas terminan con una fila de pie "SUBTOTAL PAGINA"
    // (a veces pegada directo a la última variante, sin fila en blanco
    // en el medio). No es un producto: se corta ahí también.
    if (String(codigo).trim().toUpperCase().includes("SUBTOTAL")) {
      break;
    }

    // Algunas hojas repiten la fila de encabezados ("CODIGO",
    // "DESCRIPCION", ...) en medio de la tabla, como separador de una
    // sub-sección dentro del mismo producto. No es una variante: se
    // salta (sin cortar la lectura, porque después siguen datos reales).
    if (String(codigo).trim().toUpperCase() === "CODIGO") {
      continue;
    }

    const descripcion = String(valorCelda(fila.getCell(2)) || "").trim();
    const antes = numeroONull(valorCelda(fila.getCell(3)));
    const ahora = numeroONull(valorCelda(fila.getCell(4)));
    const stockTexto = String(valorCelda(fila.getCell(9)) || "").trim().toUpperCase();

    const modelo = derivarModelo(nombreProducto, descripcion);
    const stockEstado = ESTADOS_STOCK_VALIDOS.includes(stockTexto) ? stockTexto : "SIN STOCK";

    if (!ESTADOS_STOCK_VALIDOS.includes(stockTexto)) {
      advertencias.push(
        '"' + nombreProducto + '" fila ' + numeroFila + ": stock \"" + stockTexto + '" no reconocido, se usó SIN STOCK.'
      );
    }

    variantes.push({
      sku: String(codigo).trim(),
      modelo: modelo,
      descripcion_completa: descripcion,
      precio_anterior: antes,
      precio_actual: ahora !== null ? ahora : 0,
      stock_estado: stockEstado,
    });
  }

  if (variantes.length === 0) {
    advertencias.push('"' + nombreProducto + '" no tiene ninguna variante, se omite.');
    return null;
  }

  const imagen = extraerImagenDeHoja(workbook, hoja);
  if (!imagen) {
    advertencias.push('"' + nombreProducto + '" no tiene imagen incrustada, usará el placeholder.');
  }

  return {
    nombre: nombreProducto,
    imagen: imagen, // { buffer, extension } o null
    variantes: variantes,
  };
}

function valorCelda(celda) {
  if (!celda) return null;
  const valor = celda.value;
  if (valor === null || valor === undefined) return null;
  // Algunas celdas numéricas con fórmula vienen como { result: n }.
  if (typeof valor === "object" && "result" in valor) return valor.result;
  return valor;
}

function numeroONull(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isNaN(numero) ? null : numero;
}

// Quita el nombre del producto (prefijo de la hoja) de la descripción
// completa de la variante, para quedarse solo con el modelo de
// teléfono. Si no matchea el prefijo exacto, devuelve la descripción
// completa tal cual (mejor tener de más que perder información).
function derivarModelo(nombreProducto, descripcion) {
  const prefijo = nombreProducto.toUpperCase();
  const descripcionUpper = descripcion.toUpperCase();

  if (descripcionUpper.startsWith(prefijo)) {
    const resto = descripcion.slice(prefijo.length).trim();
    return resto.length > 0 ? resto : descripcion;
  }

  return descripcion;
}

// Extrae la (única) imagen anclada en la hoja, si existe.
function extraerImagenDeHoja(workbook, hoja) {
  const imagenes = hoja.getImages();
  if (!imagenes || imagenes.length === 0) {
    return null;
  }

  const idImagen = imagenes[0].imageId;
  const imagen = workbook.model.media.find(function (m) {
    return m.index === idImagen;
  });

  if (!imagen || !imagen.buffer) {
    return null;
  }

  return { buffer: Buffer.from(imagen.buffer), extension: imagen.extension || "png" };
}

// ---------------------------------------------------------------------
// Modo dry-run: guarda un resumen local sin tocar Supabase
// ---------------------------------------------------------------------

async function guardarResultadoDryRun(productos) {
  const dirSalida = path.join(__dirname, "salida-dry-run");
  const dirImagenes = path.join(dirSalida, "imagenes");
  fs.mkdirSync(dirImagenes, { recursive: true });

  const resumen = productos.map(function (producto, indice) {
    let rutaImagen = null;
    if (producto.imagen) {
      rutaImagen = path.join(dirImagenes, indice + "-" + sanitizarNombreArchivo(producto.nombre) + "." + producto.imagen.extension);
      fs.writeFileSync(rutaImagen, producto.imagen.buffer);
    }

    return {
      nombre: producto.nombre,
      imagen: rutaImagen,
      cantidad_variantes: producto.variantes.length,
      variantes_muestra: producto.variantes.slice(0, 3),
    };
  });

  fs.writeFileSync(path.join(dirSalida, "resumen.json"), JSON.stringify(resumen, null, 2));
  console.log("Dry-run OK. Resumen guardado en " + path.join(dirSalida, "resumen.json"));
}

function sanitizarNombreArchivo(texto) {
  return texto.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// ---------------------------------------------------------------------
// Migración real a Supabase
// ---------------------------------------------------------------------

async function migrarASupabase(productos, truncar) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en scripts/.env");
  }

  const supabase = createClient(url, serviceKey);

  if (truncar) {
    console.log("Vaciando productos y variantes existentes (--truncate) ...");
    await supabase.from("variantes").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("productos").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }

  let productosCreados = 0;
  let variantesCreadas = 0;
  let imagenesSubidas = 0;

  for (let i = 0; i < productos.length; i++) {
    const producto = productos[i];

    const { data: filaProducto, error: errorProducto } = await supabase
      .from("productos")
      .insert({ nombre: producto.nombre, orden: i })
      .select()
      .single();

    if (errorProducto) {
      console.error('Error creando "' + producto.nombre + '": ' + errorProducto.message);
      continue;
    }
    productosCreados++;

    if (producto.imagen) {
      const ruta = "productos/" + filaProducto.id + "." + producto.imagen.extension;
      const { error: errorSubida } = await supabase.storage
        .from("assets-publicos")
        .upload(ruta, producto.imagen.buffer, { upsert: true, contentType: "image/" + producto.imagen.extension });

      if (!errorSubida) {
        const { data: urlPublica } = supabase.storage.from("assets-publicos").getPublicUrl(ruta);
        await supabase.from("productos").update({ imagen_url: urlPublica.publicUrl }).eq("id", filaProducto.id);
        imagenesSubidas++;
      } else {
        console.error('Error subiendo imagen de "' + producto.nombre + '": ' + errorSubida.message);
      }
    }

    const filasVariantes = producto.variantes.map(function (v) {
      return {
        producto_id: filaProducto.id,
        sku: v.sku,
        modelo: v.modelo,
        descripcion_completa: v.descripcion_completa,
        precio_anterior: v.precio_anterior,
        precio_actual: v.precio_actual,
        stock_estado: v.stock_estado,
      };
    });

    const { error: errorVariantes } = await supabase.from("variantes").insert(filasVariantes);
    if (errorVariantes) {
      console.error('Error insertando variantes de "' + producto.nombre + '": ' + errorVariantes.message);
    } else {
      variantesCreadas += filasVariantes.length;
    }

    console.log("[" + (i + 1) + "/" + productos.length + '] "' + producto.nombre + '" migrado.');
  }

  console.log("---");
  console.log("Productos creados: " + productosCreados);
  console.log("Variantes creadas: " + variantesCreadas);
  console.log("Imágenes subidas: " + imagenesSubidas);
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
