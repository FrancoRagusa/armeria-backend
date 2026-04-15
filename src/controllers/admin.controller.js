import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { pool } from "../db.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

const LOGIN_ATTEMPTS = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const CATEGORIAS_PRINCIPALES = new Set([
  "arma-corta",
  "arma-larga",
  "opticas",
  "municiones",
  "accesorios",
  "recarga",
  "cuchilleria",
  "promociones",
]);

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return req.ip || req.connection?.remoteAddress || "unknown";
}

function isLoginBlocked(key) {
  const now = Date.now();
  const data = LOGIN_ATTEMPTS.get(key);

  if (!data) return false;
  if (now - data.firstAttemptAt > LOGIN_WINDOW_MS) {
    LOGIN_ATTEMPTS.delete(key);
    return false;
  }

  return data.count >= MAX_LOGIN_ATTEMPTS;
}

function registerFailedLogin(key) {
  const now = Date.now();
  const data = LOGIN_ATTEMPTS.get(key);

  if (!data || now - data.firstAttemptAt > LOGIN_WINDOW_MS) {
    LOGIN_ATTEMPTS.set(key, {
      count: 1,
      firstAttemptAt: now,
    });
    return;
  }

  data.count += 1;
  LOGIN_ATTEMPTS.set(key, data);
}

function clearFailedLogins(key) {
  LOGIN_ATTEMPTS.delete(key);
}

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

function cleanText(value, maxLen = 255) {
  return String(value || "").trim().slice(0, maxLen);
}

function normalizeEstadoStock(v) {
  const allowed = new Set(["en_stock", "agotado", "consultar_disponibilidad"]);
  if (!v) return "consultar_disponibilidad";
  const x = String(v).trim().toLowerCase();
  return allowed.has(x) ? x : "consultar_disponibilidad";
}

function parsePrecio(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}

function isValidHttpUrl(value = "") {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeCategoriaPrincipalInput(value = "") {
  const raw = cleanText(value, 120);
  const slug = safeSlug(raw);

  const aliases = {
    "arma-corta": "arma-corta",
    "armas-cortas": "arma-corta",
    "arma-cortas": "arma-corta",
    "pistolas": "arma-corta",
    "revolveres": "arma-corta",
    "revolver": "arma-corta",

    "arma-larga": "arma-larga",
    "armas-largas": "arma-larga",
    "arma-largas": "arma-larga",
    "rifles": "arma-larga",
    "escopetas": "arma-larga",
    "carabinas": "arma-larga",

    opticas: "opticas",
    optica: "opticas",
    "ópticas": "opticas",
    "óptica": "opticas",

    municiones: "municiones",
    municion: "municiones",
    "munición": "municiones",

    accesorios: "accesorios",
    accesorio: "accesorios",

    recarga: "recarga",

    cuchilleria: "cuchilleria",
    cuchillería: "cuchilleria",
    cuchillos: "cuchilleria",

    promociones: "promociones",
    promocion: "promociones",
    "promoción": "promociones",
  };

  return aliases[slug] || slug;
}

/**
 * MODO NUEVO:
 * - usa categoria_principal + subcategoria si vienen
 * - o detecta categoria principal conocida
 *
 * MODO VIEJO:
 * - si NO viene categoria_principal
 * - y la categoría NO coincide con una principal conocida
 *   entonces se mantiene el comportamiento viejo:
 *   todo cae bajo Municiones, usando la categoría recibida como subcategoría
 */
function inferirCategoriasDesdeFila(r) {
  const categoriaPrincipalRaw =
    r.categoria_principal ||
    r.categoria_principal_slug ||
    r.categoria_padre ||
    "";

  const categoriaRaw = r.categoria || "";
  const categoriaSlugRaw = r.categoria_slug || "";
  const subcategoriaRaw = r.subcategoria || r.subcategoria_slug || "";

  let categoriaPrincipal = normalizeCategoriaPrincipalInput(categoriaPrincipalRaw);
  let subcategoria = cleanText(subcategoriaRaw || "", 120);

  const categoria = cleanText(categoriaRaw || "", 120);
  const categoriaSlug = cleanText(categoriaSlugRaw || "", 120);

  // ----------------------------
  // MODO NUEVO EXPLÍCITO
  // ----------------------------
  if (categoriaPrincipal) {
    if (!subcategoria && categoriaSlug) {
      const categoriaSlugNormalizada = normalizeCategoriaPrincipalInput(categoriaSlug);
      if (
        categoriaSlugNormalizada &&
        categoriaSlugNormalizada !== categoriaPrincipal &&
        !CATEGORIAS_PRINCIPALES.has(categoriaSlugNormalizada)
      ) {
        subcategoria = categoriaSlug;
      }
    }

    if (!subcategoria && categoria) {
      const categoriaNormalizada = normalizeCategoriaPrincipalInput(categoria);
      if (
        categoriaNormalizada &&
        categoriaNormalizada !== categoriaPrincipal &&
        !CATEGORIAS_PRINCIPALES.has(categoriaNormalizada)
      ) {
        subcategoria = categoria;
      }
    }

    return {
      categoriaPrincipal,
      subcategoria,
      modoLegacyMuniciones: false,
    };
  }

  // ----------------------------
  // MODO NUEVO IMPLÍCITO
  // Si categoria/categoria_slug coincide con una principal conocida
  // ----------------------------
  const candidataPrincipal = normalizeCategoriaPrincipalInput(categoriaSlug || categoria);

  if (candidataPrincipal && CATEGORIAS_PRINCIPALES.has(candidataPrincipal)) {
    categoriaPrincipal = candidataPrincipal;

    return {
      categoriaPrincipal,
      subcategoria,
      modoLegacyMuniciones: false,
    };
  }

  // ----------------------------
  // MODO VIEJO
  // Todo sigue cayendo bajo Municiones
  // y lo recibido se usa como subcategoría
  // ----------------------------
  const legacySubcategoria = cleanText(
    subcategoria || categoriaSlug || categoria || "",
    120
  );

  return {
    categoriaPrincipal: "municiones",
    subcategoria: legacySubcategoria,
    modoLegacyMuniciones: true,
  };
}

function buildAdminToken(admin) {
  const jwtSecret = process.env.JWT_SECRET;
  const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "12h";

  if (!jwtSecret) {
    throw new Error("Falta JWT_SECRET en .env");
  }

  return jwt.sign(
    {
      sub: admin.id,
      role: admin.rol || "admin",
      email: admin.email,
      nombre: admin.nombre || null,
    },
    jwtSecret,
    { expiresIn: jwtExpiresIn }
  );
}

function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === "production";

  res.cookie("admin_token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearAuthCookie(res) {
  const isProd = process.env.NODE_ENV === "production";

  res.clearCookie("admin_token", {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
  });
}

async function ensureCategoriaRaiz(client, nombreOSlug) {
  const slug = safeSlug(nombreOSlug);
  const nombre = cleanText(nombreOSlug || slug, 120);

  if (!slug) return null;

  const exists = await client.query(
    `
    SELECT id
    FROM armeria_app.categorias
    WHERE slug = $1
    LIMIT 1;
    `,
    [slug]
  );

  if (exists.rows[0]?.id) return exists.rows[0].id;

  const ins = await client.query(
    `
    INSERT INTO armeria_app.categorias (nombre, slug, id_categoria_padre)
    VALUES ($1, $2, NULL)
    RETURNING id;
    `,
    [nombre || slug, slug]
  );

  return ins.rows[0].id;
}

async function ensureCategoriaMuniciones(client) {
  return ensureCategoriaRaiz(client, "municiones");
}

async function ensureSubcategoria(client, nombreOSlug, padreId) {
  const slug = safeSlug(nombreOSlug);
  const nombre = cleanText(nombreOSlug || slug, 120);

  if (!slug || !padreId) return padreId || null;

  const exists = await client.query(
    `
    SELECT id
    FROM armeria_app.categorias
    WHERE slug = $1 AND id_categoria_padre = $2
    LIMIT 1;
    `,
    [slug, padreId]
  );

  if (exists.rows[0]?.id) return exists.rows[0].id;

  const sameSlugAnyParent = await client.query(
    `
    SELECT id
    FROM armeria_app.categorias
    WHERE slug = $1
    LIMIT 1;
    `,
    [slug]
  );

  if (sameSlugAnyParent.rows[0]?.id) {
    return sameSlugAnyParent.rows[0].id;
  }

  const ins = await client.query(
    `
    INSERT INTO armeria_app.categorias (nombre, slug, id_categoria_padre)
    VALUES ($1, $2, $3)
    RETURNING id;
    `,
    [nombre || slug, slug, padreId]
  );

  return ins.rows[0].id;
}

async function ensureMarca(client, nombreMarca) {
  const nombre = String(nombreMarca || "").trim();
  if (!nombre) return null;

  const { rows: slugRows } = await client.query(
    `
    SELECT LOWER(REGEXP_REPLACE(unaccent($1), '\\s+', '-', 'g')) AS slug
    `,
    [nombre]
  );

  const slug = slugRows[0]?.slug || safeSlug(nombre);

  const { rows } = await client.query(
    `
    INSERT INTO armeria_app.marcas (nombre, slug)
    VALUES ($1, $2)
    ON CONFLICT (slug) DO UPDATE
      SET nombre = EXCLUDED.nombre
    RETURNING id;
    `,
    [nombre, slug]
  );

  return rows[0].id;
}

async function listImagenesByProducto(client, idProducto) {
  const { rows } = await client.query(
    `
    SELECT id, id_producto, url, texto_alternativo, orden
    FROM armeria_app.imagenes_producto
    WHERE id_producto = $1
    ORDER BY orden ASC, id ASC;
    `,
    [idProducto]
  );

  return rows;
}

class AdminController {
  // --------------------------
  // Auth
  // --------------------------
  static async login(req, res) {
    try {
      const { email, password } = req.body || {};

      if (!email || !password) {
        return res
          .status(400)
          .json({ ok: false, message: "Email y contraseña requeridos" });
      }

      const ip = getClientIp(req);
      const loginKey = `${String(email).trim().toLowerCase()}|${ip}`;

      if (isLoginBlocked(loginKey)) {
        return res.status(429).json({
          ok: false,
          message: "Demasiados intentos. Probá de nuevo en unos minutos.",
        });
      }

      const q = await pool.query(
        `
        SELECT id, email, password_hash, nombre, rol, activo
        FROM armeria_app.admin_users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1;
        `,
        [String(email).trim()]
      );

      const admin = q.rows[0];

      if (!admin || !admin.activo) {
        registerFailedLogin(loginKey);
        return res
          .status(401)
          .json({ ok: false, message: "Credenciales inválidas" });
      }

      const okPassword = await bcrypt.compare(
        String(password),
        String(admin.password_hash)
      );

      if (!okPassword) {
        registerFailedLogin(loginKey);
        return res
          .status(401)
          .json({ ok: false, message: "Credenciales inválidas" });
      }

      clearFailedLogins(loginKey);

      await pool.query(
        `
        UPDATE armeria_app.admin_users
        SET ultimo_login = NOW(),
            updated_at = NOW()
        WHERE id = $1;
        `,
        [admin.id]
      );

      const token = buildAdminToken(admin);
      setAuthCookie(res, token);

      return res.json({
        ok: true,
        admin: {
          id: admin.id,
          email: admin.email,
          nombre: admin.nombre,
          rol: admin.rol,
        },
      });
    } catch (err) {
      console.error("admin.login", err);
      return res.status(500).json({ ok: false, message: "Error login" });
    }
  }

  static async logout(req, res) {
    clearAuthCookie(res);
    return res.json({ ok: true });
  }

  static async me(req, res) {
    return res.json({
      ok: true,
      admin: {
        id: req.admin.id,
        email: req.admin.email,
        nombre: req.admin.nombre,
        rol: req.admin.role,
      },
    });
  }

  // --------------------------
  // Productos admin
  // --------------------------
  static async listProductos(req, res) {
    try {
      const { page = 1, limit = 20, q = "" } = req.query;

      const p = Math.max(parseInt(page, 10) || 1, 1);
      const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const offset = (p - 1) * l;

      const hasQuery = String(q).trim().length > 0;
      const search = `%${String(q).trim().toLowerCase()}%`;
      const where = hasQuery
        ? `WHERE LOWER(p.titulo) LIKE $1 OR LOWER(p.slug) LIKE $1`
        : "";

      const params = hasQuery ? [search, l, offset] : [l, offset];

      const totalQ = await pool.query(
        `
        SELECT COUNT(*)::int AS total
        FROM armeria_app.productos p
        ${where};
        `,
        hasQuery ? [search] : []
      );

      const rowsQ = await pool.query(
        `
        SELECT
          p.id,
          p.titulo,
          p.slug,
          p.precio,
          p.moneda,
          p.activo,
          p.calibre,
          p.estado_stock,
          p.destacado,
          p.fecha_creacion,
          p.fecha_actualizacion,
          m.nombre AS marca,
          c.nombre AS categoria
        FROM armeria_app.productos p
        LEFT JOIN armeria_app.marcas m ON m.id = p.id_marca
        LEFT JOIN armeria_app.categorias c ON c.id = p.id_categoria
        ${where}
        ORDER BY p.id DESC
        LIMIT $${hasQuery ? 2 : 1} OFFSET $${hasQuery ? 3 : 2};
        `,
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
      console.error("admin.listProductos", err);
      return res.status(500).json({ ok: false, message: "Error list productos" });
    }
  }

  static async updateProducto(req, res) {
    try {
      const { id } = req.params;
      const { precio, estado_stock, activo, destacado } = req.body || {};

      const currentQ = await pool.query(
        `
        SELECT id, titulo, slug, precio, moneda, estado_stock, activo, destacado
        FROM armeria_app.productos
        WHERE id = $1
        LIMIT 1;
        `,
        [id]
      );

      if (!currentQ.rows[0]) {
        return res.status(404).json({ ok: false, message: "No encontrado" });
      }

      const current = currentQ.rows[0];

      const nextPrecio =
        precio === undefined ? current.precio : precio === "" ? null : precio;

      const nextEstado =
        estado_stock === undefined
          ? current.estado_stock
          : normalizeEstadoStock(estado_stock);

      const nextActivo =
        activo === undefined ? current.activo : Boolean(activo);

      const nextDestacado =
        destacado === undefined ? current.destacado : Boolean(destacado);

      const q = `
        UPDATE armeria_app.productos
        SET
          precio = $1,
          estado_stock = $2,
          activo = $3,
          destacado = $4,
          fecha_actualizacion = NOW()
        WHERE id = $5
        RETURNING id, titulo, slug, precio, moneda, estado_stock, activo, destacado;
      `;

      const params = [nextPrecio, nextEstado, nextActivo, nextDestacado, id];
      const { rows } = await pool.query(q, params);

      return res.json({ ok: true, item: rows[0] });
    } catch (err) {
      console.error("admin.updateProducto", err);
      return res.status(500).json({ ok: false, message: "Error update producto" });
    }
  }

  static async toggleProductoActivo(req, res) {
    try {
      const { id } = req.params;

      const currentQ = await pool.query(
        `
        SELECT id, activo
        FROM armeria_app.productos
        WHERE id = $1
        LIMIT 1;
        `,
        [id]
      );

      if (!currentQ.rows[0]) {
        return res.status(404).json({ ok: false, message: "No encontrado" });
      }

      const current = currentQ.rows[0];
      const nextActivo = !current.activo;

      const q = await pool.query(
        `
        UPDATE armeria_app.productos
        SET activo = $1,
            fecha_actualizacion = NOW()
        WHERE id = $2
        RETURNING id, activo;
        `,
        [nextActivo, id]
      );

      return res.json({
        ok: true,
        item: q.rows[0],
        message: nextActivo
          ? "Producto activado correctamente"
          : "Producto desactivado correctamente",
      });
    } catch (err) {
      console.error("admin.toggleProductoActivo", err);
      return res
        .status(500)
        .json({ ok: false, message: "Error cambiando estado del producto" });
    }
  }

  // --------------------------
  // Upload middleware
  // --------------------------
  static csvUploadMiddleware() {
    return upload.single("file");
  }

  // --------------------------
  // Import productos CSV
  // --------------------------
  static async importCSV(req, res) {
    const client = await pool.connect();

    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ ok: false, message: "Falta archivo CSV (field: file)" });
      }

      const content = req.file.buffer.toString("utf-8");
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ ok: false, message: "CSV vacío" });
      }

      await client.query("BEGIN");

      let inserted = 0;
      let skipped = 0;

      for (const r of records) {
        const { categoriaPrincipal, subcategoria } = inferirCategoriasDesdeFila(r);

        const marca = cleanText(r.marca || "", 120);
        const titulo = cleanText(r.titulo || "", 255);
        const calibre = cleanText(r.calibre || "", 120);

        if (!categoriaPrincipal || !marca || !titulo || titulo.length < 3) {
          skipped++;
          continue;
        }

        let categoriaFinalId = null;
        let categoriaSlugParaProducto = safeSlug(categoriaPrincipal);

        // ----------------------------
        // MODO VIEJO VALIDADO
        // si no viene principal explícita y cae en legacy,
        // sigue usando Municiones como padre
        // ----------------------------
        if (categoriaPrincipal === "municiones" && subcategoria) {
          const padreId = await ensureCategoriaMuniciones(client);
          categoriaFinalId = await ensureSubcategoria(client, subcategoria, padreId);
          categoriaSlugParaProducto = `municiones-${safeSlug(subcategoria)}`;
        } else {
          // ----------------------------
          // MODO NUEVO
          // categoría principal real
          // ----------------------------
          const categoriaPrincipalId = await ensureCategoriaRaiz(client, categoriaPrincipal);

          if (!categoriaPrincipalId) {
            skipped++;
            continue;
          }

          categoriaFinalId = subcategoria
            ? await ensureSubcategoria(client, subcategoria, categoriaPrincipalId)
            : categoriaPrincipalId;

          categoriaSlugParaProducto = subcategoria
            ? `${safeSlug(categoriaPrincipal)}-${safeSlug(subcategoria)}`
            : safeSlug(categoriaPrincipal);
        }

        const marcaId = await ensureMarca(client, marca);

        const baseSlug = r.slug ? safeSlug(r.slug) : safeSlug(titulo);
        const finalSlug = safeSlug(`${categoriaSlugParaProducto}-${baseSlug}`);

        if (!finalSlug || !categoriaFinalId || !marcaId) {
          skipped++;
          continue;
        }

        const estado = normalizeEstadoStock(r.estado_stock);
        const precio = parsePrecio(r.precio);

        const exists = await client.query(
          `
          SELECT 1
          FROM armeria_app.productos
          WHERE slug = $1
          LIMIT 1;
          `,
          [finalSlug]
        );

        if (exists.rowCount) {
          skipped++;
          continue;
        }

        const moneda = cleanText(r.moneda || "ARS", 10) || "ARS";

        const descripcion = cleanText(
          r.descripcion ||
            [
              titulo,
              calibre ? `Calibre ${calibre}` : "",
              marca ? `Marca ${marca}` : "",
            ]
              .filter(Boolean)
              .join(" - "),
          3000
        );

        const activo =
          r.activo === undefined
            ? true
            : String(r.activo).toLowerCase() !== "false";

        const destacado =
          r.destacado === undefined
            ? false
            : String(r.destacado).toLowerCase() === "true";

        const sku = safeSlug(`${finalSlug}-${categoriaFinalId}-${marcaId}`);

        await client.query(
          `
          INSERT INTO armeria_app.productos
          (
            titulo,
            slug,
            descripcion,
            precio,
            moneda,
            activo,
            id_categoria,
            id_marca,
            sku,
            calibre,
            estado_stock,
            destacado
          )
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
            categoriaFinalId,
            marcaId,
            sku,
            calibre || null,
            estado,
            destacado,
          ]
        );

        inserted++;
      }

      await client.query("COMMIT");

      return res.json({
        ok: true,
        inserted,
        skipped,
        total: records.length,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("admin.importCSV", err);
      return res.status(500).json({
        ok: false,
        message: "Error import CSV",
      });
    } finally {
      client.release();
    }
  }

  // --------------------------
  // Imágenes manuales
  // --------------------------
  static async listImagenes(req, res) {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const idProducto = Number(id);

      if (!idProducto) {
        return res.status(400).json({ ok: false, message: "id inválido" });
      }

      const imgs = await listImagenesByProducto(client, idProducto);
      return res.json({ ok: true, items: imgs });
    } catch (err) {
      console.error("admin.listImagenes", err);
      return res.status(500).json({ ok: false, message: "Error list imagenes" });
    } finally {
      client.release();
    }
  }

  static async addImagen(req, res) {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const idProducto = Number(id);
      const { url, texto_alternativo = "", orden = 0 } = req.body || {};

      if (!idProducto) {
        return res.status(400).json({ ok: false, message: "id inválido" });
      }

      if (!url || !String(url).trim()) {
        return res.status(400).json({ ok: false, message: "Falta url" });
      }

      if (!isValidHttpUrl(url)) {
        return res.status(400).json({ ok: false, message: "URL inválida" });
      }

      await client.query("BEGIN");

      const ex = await client.query(
        `
        SELECT 1
        FROM armeria_app.productos
        WHERE id = $1
        LIMIT 1;
        `,
        [idProducto]
      );

      if (!ex.rowCount) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ ok: false, message: "Producto no encontrado" });
      }

      const ins = await client.query(
        `
        INSERT INTO armeria_app.imagenes_producto
          (id_producto, url, texto_alternativo, orden)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id_producto, url) DO UPDATE
          SET texto_alternativo = EXCLUDED.texto_alternativo,
              orden = EXCLUDED.orden
        RETURNING id, id_producto, url, texto_alternativo, orden;
        `,
        [
          idProducto,
          String(url).trim(),
          cleanText(texto_alternativo || "", 255),
          Number(orden) || 0,
        ]
      );

      await client.query("COMMIT");

      const items = await listImagenesByProducto(client, idProducto);
      return res.json({ ok: true, item: ins.rows[0], items });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("admin.addImagen", err);
      return res.status(500).json({ ok: false, message: "Error add imagen" });
    } finally {
      client.release();
    }
  }

  static async updateImagen(req, res) {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const idImg = Number(id);
      const { url, texto_alternativo, orden } = req.body || {};

      if (!idImg) {
        return res.status(400).json({ ok: false, message: "id inválido" });
      }

      const currentQ = await client.query(
        `
        SELECT id, id_producto, url, texto_alternativo, orden
        FROM armeria_app.imagenes_producto
        WHERE id = $1
        LIMIT 1;
        `,
        [idImg]
      );

      if (!currentQ.rowCount) {
        return res.status(404).json({ ok: false, message: "Imagen no encontrada" });
      }

      const current = currentQ.rows[0];
      const nextUrl =
        url === undefined ? current.url : String(url).trim();

      if (!isValidHttpUrl(nextUrl)) {
        return res.status(400).json({ ok: false, message: "URL inválida" });
      }

      const upd = await client.query(
        `
        UPDATE armeria_app.imagenes_producto
        SET
          url = $1,
          texto_alternativo = $2,
          orden = $3
        WHERE id = $4
        RETURNING id, id_producto, url, texto_alternativo, orden;
        `,
        [
          nextUrl,
          texto_alternativo === undefined
            ? current.texto_alternativo
            : cleanText(texto_alternativo, 255),
          orden === undefined ? current.orden : Number(orden) || 0,
          idImg,
        ]
      );

      const items = await listImagenesByProducto(client, upd.rows[0].id_producto);
      return res.json({ ok: true, item: upd.rows[0], items });
    } catch (err) {
      console.error("admin.updateImagen", err);
      return res.status(500).json({ ok: false, message: "Error update imagen" });
    } finally {
      client.release();
    }
  }

  static async deleteImagen(req, res) {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const idImg = Number(id);

      if (!idImg) {
        return res.status(400).json({ ok: false, message: "id inválido" });
      }

      const sel = await client.query(
        `
        SELECT id_producto
        FROM armeria_app.imagenes_producto
        WHERE id = $1
        LIMIT 1;
        `,
        [idImg]
      );

      if (!sel.rowCount) {
        return res.status(404).json({ ok: false, message: "Imagen no encontrada" });
      }

      const idProducto = sel.rows[0].id_producto;

      await client.query(
        `
        DELETE FROM armeria_app.imagenes_producto
        WHERE id = $1;
        `,
        [idImg]
      );

      const items = await listImagenesByProducto(client, idProducto);
      return res.json({ ok: true, items });
    } catch (err) {
      console.error("admin.deleteImagen", err);
      return res.status(500).json({ ok: false, message: "Error delete imagen" });
    } finally {
      client.release();
    }
  }

  // --------------------------
  // Import imágenes CSV
  // --------------------------
  static async importImagenesCSV(req, res) {
    const client = await pool.connect();

    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ ok: false, message: "Falta archivo CSV (field: file)" });
      }

      const content = req.file.buffer.toString("utf-8");
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ ok: false, message: "CSV vacío" });
      }

      await client.query("BEGIN");

      let inserted = 0;
      let skipped = 0;
      let notFound = 0;

      for (const r of records) {
        const slug = cleanText(r.slug || "", 255);
        const titulo = cleanText(r.titulo || "", 255);
        const url = cleanText(r.imagen_url || r.url || "", 2000);
        const orden =
          r.orden === undefined || r.orden === "" ? 0 : Number(r.orden);
        const texto =
          cleanText(r.texto_alternativo || r.alt || "", 255) || null;

        if (!url || (!slug && !titulo) || !isValidHttpUrl(url)) {
          skipped++;
          continue;
        }

        let prod = null;

        if (slug) {
          const q = await client.query(
            `
            SELECT id, titulo, slug
            FROM armeria_app.productos
            WHERE slug = $1
            LIMIT 1;
            `,
            [slug]
          );
          prod = q.rows[0] || null;
        } else {
          const q = await client.query(
            `
            SELECT id, titulo, slug
            FROM armeria_app.productos
            WHERE LOWER(titulo) = LOWER($1)
            ORDER BY id DESC
            LIMIT 1;
            `,
            [titulo]
          );
          prod = q.rows[0] || null;
        }

        if (!prod?.id) {
          notFound++;
          continue;
        }

        await client.query(
          `
          INSERT INTO armeria_app.imagenes_producto
            (id_producto, url, texto_alternativo, orden)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id_producto, url) DO UPDATE
            SET texto_alternativo = COALESCE(
                  EXCLUDED.texto_alternativo,
                  armeria_app.imagenes_producto.texto_alternativo
                ),
                orden = EXCLUDED.orden;
          `,
          [prod.id, url, texto, Number.isFinite(orden) ? orden : 0]
        );

        inserted++;
      }

      await client.query("COMMIT");

      return res.json({
        ok: true,
        inserted,
        skipped,
        notFound,
        total: records.length,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("admin.importImagenesCSV", err);
      return res.status(500).json({
        ok: false,
        message: "Error import imágenes CSV",
      });
    } finally {
      client.release();
    }
  }
}

export default AdminController;