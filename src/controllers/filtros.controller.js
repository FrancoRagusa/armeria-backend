// src/controllers/filtros.controller.js
import { consulta } from "../db.js";

export const obtenerFiltros = async (req, res) => {
  try {
    const [marcas, calibres, aumentos, precios, categorias] = await Promise.all([
      consulta(`
        SELECT id, nombre, slug
        FROM marcas
        ORDER BY nombre ASC
      `),
      consulta(`
        SELECT DISTINCT calibre
        FROM productos
        WHERE calibre IS NOT NULL AND TRIM(calibre) <> ''
        ORDER BY calibre ASC
      `),
      // Aumentos (solo si estás cargando ópticas con el campo aumento)
      consulta(`
        SELECT DISTINCT aumento
        FROM productos
        WHERE aumento IS NOT NULL AND TRIM(aumento) <> ''
        ORDER BY aumento ASC
      `),
      consulta(`
        SELECT
          COALESCE(MIN(precio), 0) AS min_precio,
          COALESCE(MAX(precio), 0) AS max_precio
        FROM productos
        WHERE activo = TRUE
      `),
      consulta(`
        SELECT id, nombre, slug, id_categoria_padre
        FROM categorias
        ORDER BY nombre ASC
      `),
    ]);

    res.json({
      ok: true,
      marcas: marcas.rows,
      calibres: calibres.rows.map((r) => r.calibre),
      aumentos: aumentos.rows.map((r) => r.aumento),
      precios: precios.rows[0],
      categorias: categorias.rows,
    });
  } catch (error) {
    console.error("obtenerFiltros:", error);
    res.status(500).json({ ok: false, error: "Error obteniendo filtros" });
  }
};
