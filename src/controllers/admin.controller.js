// src/controllers/admin.controller.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { pool } from "../db.js";

const upload = multer({ storage: multer.memoryStorage() });

function safeSlug(str = "") {
  return String(str)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeEstadoStock(v) {
  const allowed = new Set(["en_stock", "agotado", "consultar_disponibilidad"]);
  if (!v) return "consultar_disponibilidad";
  const x = String(v).trim().toLowerCase();
  return allowed.has(x) ? x : "consultar_disponibilidad";
}

async function ensureCategoriaMuniciones(client) {
  const ins = await client.query(
    `
    INSERT INTO armeria_app.categorias (nombre, slug, id_categoria_padre)
    SELECT 'Municiones', 'municiones', NULL::integer
    WHERE NOT EXISTS (SELECT 1 FROM armeria_app.categorias WHERE slug='municiones')
    RETURNING id;
    `
  );

  if (ins.rows?.[0]?.id) return ins.rows[0].id;

  const sel = await client.query(
    `SELECT id FROM armeria_app.categorias WHERE slug='municiones' LIMIT 1;`
  );
  return sel.rows[0].id;
}

async function ensureSubcategoria(client, slug, padreId) {
  const exists = await client.query(
    `SELECT id FROM armeria_app.categorias WHERE slug=$1 LIMIT 1;`,
    [slug]
  );
  if (exists.rows[0]?.id) return exists.rows[0].id;

  const ins = await client.query(
    `INSERT INTO armeria_app.categorias (nombre, slug, id_categoria_padre)
     VALUES ($1, $2, $3) RETURNING id;`,
    [slug, slug, padreId]
  );
  return ins.rows[0].id;
}

// ✅ FIX: devuelve SIEMPRE el id aunque ya exista (sin violar unique)
async function ensureMarca(client, nombreMarca) {
  const nombre = (nombreMarca || "").trim();
  if (!nombre) return null;

  // slug consistente
  const { rows: slugRows } = await client.query(
    `SELECT LOWER(REGEXP_REPLACE(unaccent($1), '\\s+', '-', 'g')) AS slug`,
    [nombre]
  );
  const slug = slugRows[0].slug;

  // try insert
  try {
    const ins = await client.query(
      `
      INSERT INTO armeria_app.marcas (nombre, slug)
      VALUES ($1, $2)
      RETURNING id;
      `,
      [nombre, slug]
    );
    return ins.rows[0].id;
  } catch (e) {
    // si ya existe, traer id y (opcional) actualizar nombre
    if (e?.code !== "23505") throw e;

    const sel = await client.query(
      `SELECT id FROM armeria_app.marcas WHERE slug=$1 LIMIT 1;`,
      [slug]
    );

    if (sel.rows[0]?.id) {
      await client.query(`UPDATE armeria_app.marcas SET nombre=$1 WHERE id=$2;`, [
        nombre,
        sel.rows[0].id,
      ]);
      return sel.rows[0].id;
    }

    throw e;
  }
}

class AdminController {
  static async login(req, res) {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res
          .status(400)
          .json({ ok: false, message: "Email y password requeridos" });
      }

      const adminEmail = process.env.ADMIN_EMAIL;
      const adminPass = process.env.ADMIN_PASSWORD;

      if (!adminEmail || !adminPass || !process.env.JWT_SECRET) {
        return res
          .status(500)
          .json({ ok: false, message: "Config admin faltante en .env" });
      }

      if (
        String(email).trim().toLowerCase() !==
        String(adminEmail).trim().toLowerCase()
      ) {
        return res.status(401).json({ ok: false, message: "Credenciales inválidas" });
      }

      const ok = await bcrypt.compare(password, await bcrypt.hash(adminPass, 10));
      if (!ok) return res.status(401).json({ ok: false, message: "Credenciales inválidas" });

      const token = jwt.sign(
        { role: "admin", email: adminEmail },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.json({ ok: true, token });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, message: "Error login" });
    }
  }

  static async me(req, res) {
    return res.json({ ok: true, admin: req.admin });
  }

  static async listProductos(req, res) {
    try {
      const { page = 1, limit = 20, q = "" } = req.query;
      const p = Math.max(parseInt(page, 10) || 1, 1);
      const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const offset = (p - 1) * l;

      const search = `%${String(q).trim().toLowerCase()}%`;
      const where = q ? `WHERE LOWER(p.titulo) LIKE $1 OR LOWER(p.slug) LIKE $1` : "";
      const params = q ? [search, l, offset] : [l, offset];

      const totalQ = await pool.query(
        `SELECT COUNT(*)::int AS total FROM armeria_app.productos p ${where};`,
        q ? [search] : []
      );

      const rowsQ = await pool.query(
        `SELECT
            p.id, p.titulo, p.slug, p.precio, p.moneda, p.activo,
            p.calibre, p.estado_stock, p.destacado,
            p.fecha_creacion, p.fecha_actualizacion,
            m.nombre AS marca,
            c.nombre AS categoria
         FROM armeria_app.productos p
         LEFT JOIN armeria_app.marcas m ON m.id = p.id_marca
         LEFT JOIN armeria_app.categorias c ON c.id = p.id_categoria
         ${where}
         ORDER BY p.id DESC
         LIMIT $${q ? 2 : 1} OFFSET $${q ? 3 : 2};`,
        params
      );

      return res.json({
        ok: true,
        total: totalQ.rows[0].total,
        page: p,
        limit: l,
        items: rowsQ.rows,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, message: "Error list productos" });
    }
  }

  static async updateProducto(req, res) {
    try {
      const { id } = req.params;
      const { precio, estado_stock, activo, destacado } = req.body || {};

      const estado = estado_stock !== undefined ? normalizeEstadoStock(estado_stock) : undefined;

      const q = `
        UPDATE armeria_app.productos
        SET
          precio = COALESCE($1, precio),
          estado_stock = COALESCE($2, estado_stock),
          activo = COALESCE($3, activo),
          destacado = COALESCE($4, destacado),
          fecha_actualizacion = NOW()
        WHERE id = $5
        RETURNING id, titulo, slug, precio, moneda, estado_stock, activo, destacado;
      `;

      const params = [
        precio === "" ? null : (precio === undefined ? null : precio),
        estado === undefined ? null : estado,
        activo === undefined ? null : !!activo,
        destacado === undefined ? null : !!destacado,
        id,
      ];

      const { rows } = await pool.query(q, params);
      if (!rows[0]) return res.status(404).json({ ok: false, message: "No encontrado" });

      return res.json({ ok: true, item: rows[0] });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, message: "Error update producto" });
    }
  }

  static csvUploadMiddleware() {
    return upload.single("file");
  }

  // ✅ Productos (tu import actual)
  static async importCSV(req, res) {
    const client = await pool.connect();
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, message: "Falta archivo CSV (field: file)" });
      }

      const content = req.file.buffer.toString("utf-8");
      const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });

      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ ok: false, message: "CSV vacío" });
      }

      await client.query("BEGIN");
      const padreId = await ensureCategoriaMuniciones(client);

      let inserted = 0;
      let skipped = 0;

      for (const r of records) {
        const categoria_slug = (r.categoria_slug || r.categoria || r.subcategoria || "").trim();
        const calibre = (r.calibre || categoria_slug || "").trim();
        const marca = (r.marca || "").trim();
        const titulo = (r.titulo || "").trim();

        if (!categoria_slug || !marca || !titulo) {
          skipped++;
          continue;
        }

        const subCatId = await ensureSubcategoria(client, categoria_slug, padreId);
        const marcaId = await ensureMarca(client, marca);

        const baseSlug = r.slug ? safeSlug(r.slug) : safeSlug(titulo);
        const finalSlug = safeSlug(`${categoria_slug}-${baseSlug}`);

        const estado = normalizeEstadoStock(r.estado_stock);
        const precio = r.precio === "" || r.precio === undefined ? null : Number(r.precio);

        const exists = await client.query(
          `SELECT 1 FROM armeria_app.productos WHERE slug=$1 LIMIT 1;`,
          [finalSlug]
        );
        if (exists.rowCount) {
          skipped++;
          continue;
        }

        const moneda = (r.moneda || "ARS").trim() || "ARS";
        const descripcion = (r.descripcion || `Munición calibre ${calibre} - ${titulo}`).trim();

        const activo = r.activo === undefined ? true : String(r.activo).toLowerCase() !== "false";
        const destacado = r.destacado === undefined ? false : String(r.destacado).toLowerCase() === "true";

        const sku = safeSlug(`${finalSlug}-${subCatId}-${marcaId}`);

        await client.query(
          `
          INSERT INTO armeria_app.productos
          (titulo, slug, descripcion, precio, moneda, activo, id_categoria, id_marca, sku, calibre, estado_stock, destacado)
          VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          `,
          [
            titulo,
            finalSlug,
            descripcion,
            precio,
            moneda,
            activo,
            subCatId,
            marcaId,
            sku,
            calibre,
            estado,
            destacado,
          ]
        );

        inserted++;
      }

      await client.query("COMMIT");
      return res.json({ ok: true, inserted, skipped, total: records.length });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(err);
      return res.status(500).json({ ok: false, message: "Error import CSV", error: err.message });
    } finally {
      client.release();
    }
  }

  // ✅ NUEVO: Import de imágenes por CSV
  // CSV columnas:
  // - slug o titulo (recomendado: slug)
  // - imagen_url (obligatoria)
  // - orden (opcional, default 0)
  // - texto_alternativo (opcional)
  static async importImagenesCSV(req, res) {
    const client = await pool.connect();
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, message: "Falta archivo CSV (field: file)" });
      }

      const content = req.file.buffer.toString("utf-8");
      const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });

      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ ok: false, message: "CSV vacío" });
      }

      await client.query("BEGIN");

      let inserted = 0;
      let skipped = 0;
      let notFound = 0;

      for (const r of records) {
        const slug = (r.slug || "").trim();
        const titulo = (r.titulo || "").trim();
        const url = (r.imagen_url || r.url || "").trim();
        const orden = r.orden === undefined || r.orden === "" ? 0 : Number(r.orden);
        const texto = (r.texto_alternativo || r.alt || "").trim() || null;

        if (!url || (!slug && !titulo)) {
          skipped++;
          continue;
        }

        // Buscar producto
        let prod;
        if (slug) {
          const q = await client.query(
            `SELECT id, titulo, slug FROM armeria_app.productos WHERE slug=$1 LIMIT 1;`,
            [slug]
          );
          prod = q.rows[0];
        } else {
          // por título (case-insensitive). Si hay duplicados, tomamos el más nuevo
          const q = await client.query(
            `SELECT id, titulo, slug
             FROM armeria_app.productos
             WHERE LOWER(titulo)=LOWER($1)
             ORDER BY id DESC
             LIMIT 1;`,
            [titulo]
          );
          prod = q.rows[0];
        }

        if (!prod?.id) {
          notFound++;
          continue;
        }

        // Insert idempotente: si ya existe (id_producto,url) no duplica
        // Esto asume que agregaste el UNIQUE (id_producto, url).
        await client.query(
          `
          INSERT INTO armeria_app.imagenes_producto (id_producto, url, texto_alternativo, orden)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (id_producto, url) DO UPDATE
            SET texto_alternativo = COALESCE(EXCLUDED.texto_alternativo, armeria_app.imagenes_producto.texto_alternativo),
                orden = LEAST(armeria_app.imagenes_producto.orden, EXCLUDED.orden);
          `,
          [prod.id, url, texto, Number.isFinite(orden) ? orden : 0]
        );

        inserted++;
      }

      await client.query("COMMIT");
      return res.json({ ok: true, inserted, skipped, notFound, total: records.length });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(err);
      return res.status(500).json({ ok: false, message: "Error import imágenes CSV", error: err.message });
    } finally {
      client.release();
    }
  }
}

export default AdminController;