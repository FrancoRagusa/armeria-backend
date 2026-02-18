// src/controllers/categorias.controller.js
import { consulta } from "../db.js";

// GET /api/categorias
export async function listarCategorias(req, res) {
  try {
    const sql = `
      SELECT id, nombre, slug, id_categoria_padre, fecha_creacion
      FROM categorias
      ORDER BY nombre ASC;
    `;
    const r = await consulta(sql);
    res.json({ ok: true, items: r.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "Error al listar categorías" });
  }
}
