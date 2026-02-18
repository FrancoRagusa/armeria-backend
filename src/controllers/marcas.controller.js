// src/controllers/marcas.controller.js
import { consulta } from "../db.js";

// GET /api/marcas
export async function listarMarcas(req, res) {
  try {
    const sql = `
      SELECT id, nombre, slug, fecha_creacion
      FROM marcas
      ORDER BY nombre ASC;
    `;
    const r = await consulta(sql);
    res.json({ ok: true, items: r.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "Error al listar marcas" });
  }
}
