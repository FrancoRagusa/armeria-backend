// src/controllers/productos.controller.js
import { consulta } from "../db.js";

// GET /api/productos?buscar=&categoria_slug=&marca_slug=&calibre=&precioMin=&precioMax=&ordenar=&destacados=&pagina=&limite=
export async function listarProductos(req, res) {
  try {
    const {
      buscar = "",
      categoria_slug = "",
      marca_slug = "",
      calibre = "",
      precioMin = "",
      precioMax = "",
      ordenar = "recientes",     // recientes | precio_asc | precio_desc
      destacados = "",           // "1" para traer solo destacados
      pagina = "1",
      limite = "24",
    } = req.query;

    const page = Math.max(parseInt(pagina, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limite, 10) || 24, 1), 100);
    const offset = (page - 1) * limit;

    const filtros = [];
    const params = [];

    // Base
    filtros.push(`p.activo = TRUE`);

    // Buscar
    if (buscar.trim()) {
      params.push(`%${buscar.trim()}%`);
      filtros.push(
        `(p.titulo ILIKE $${params.length} OR p.descripcion ILIKE $${params.length} OR p.sku ILIKE $${params.length})`
      );
    }

    // Categoria por slug
    if (categoria_slug.trim()) {
      params.push(categoria_slug.trim());
      filtros.push(`c.slug = $${params.length}`);
    }

    // Marca por slug
    if (marca_slug.trim()) {
      params.push(marca_slug.trim());
      filtros.push(`m.slug = $${params.length}`);
    }

    // Calibre (armas + municiones)
    if (calibre.trim()) {
      params.push(calibre.trim());
      filtros.push(`p.calibre = $${params.length}`);
    }

    // Precio min / max
    if (precioMin !== "" && !Number.isNaN(Number(precioMin))) {
      params.push(Number(precioMin));
      filtros.push(`p.precio >= $${params.length}`);
    }

    if (precioMax !== "" && !Number.isNaN(Number(precioMax))) {
      params.push(Number(precioMax));
      filtros.push(`p.precio <= $${params.length}`);
    }

    // Destacados
    if (destacados === "1") {
      filtros.push(`p.destacado = TRUE`);
    }

    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

    // Orden
    let orderBy = `ORDER BY p.fecha_creacion DESC`;
    if (ordenar === "precio_asc") orderBy = `ORDER BY p.precio ASC NULLS LAST`;
    if (ordenar === "precio_desc") orderBy = `ORDER BY p.precio DESC NULLS LAST`;

    // TOTAL
    const totalSql = `
      SELECT COUNT(*)::int AS total
      FROM productos p
      LEFT JOIN categorias c ON c.id = p.id_categoria
      LEFT JOIN marcas m ON m.id = p.id_marca
      ${where};
    `;
    const totalRes = await consulta(totalSql, params);
    const total = totalRes.rows[0]?.total ?? 0;

    // ITEMS
    const itemsParams = [...params, limit, offset];
    const itemsSql = `
      SELECT
        p.id,
        p.titulo,
        p.slug,
        p.descripcion,
        p.precio,
        p.moneda,
        p.activo,
        p.sku,
        p.calibre,
        p.aumento,
        p.estado_stock,
        p.destacado,
        p.fecha_creacion,
        p.fecha_actualizacion,
        c.nombre AS categoria_nombre,
        c.slug AS categoria_slug,
        m.nombre AS marca_nombre,
        m.slug AS marca_slug,
        (
          SELECT ip.url
          FROM imagenes_producto ip
          WHERE ip.id_producto = p.id
          ORDER BY ip.orden ASC, ip.id ASC
          LIMIT 1
        ) AS imagen_principal
      FROM productos p
      LEFT JOIN categorias c ON c.id = p.id_categoria
      LEFT JOIN marcas m ON m.id = p.id_marca
      ${where}
      ${orderBy}
      LIMIT $${itemsParams.length - 1} OFFSET $${itemsParams.length};
    `;

    const itemsRes = await consulta(itemsSql, itemsParams);

    res.json({
      ok: true,
      pagina: page,
      limite: limit,
      total,
      totalPaginas: Math.ceil(total / limit),
      items: itemsRes.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "Error al listar productos" });
  }
}

// GET /api/productos/:slug
export async function obtenerProductoPorSlug(req, res) {
  try {
    const { slug } = req.params;

    const sql = `
      SELECT
        p.id,
        p.titulo,
        p.slug,
        p.descripcion,
        p.precio,
        p.moneda,
        p.activo,
        p.sku,
        p.calibre,
        p.aumento,
        p.estado_stock,
        p.destacado,
        p.fecha_creacion,
        p.fecha_actualizacion,
        c.nombre AS categoria_nombre,
        c.slug AS categoria_slug,
        m.nombre AS marca_nombre,
        m.slug AS marca_slug
      FROM productos p
      LEFT JOIN categorias c ON c.id = p.id_categoria
      LEFT JOIN marcas m ON m.id = p.id_marca
      WHERE p.slug = $1
      LIMIT 1;
    `;

    const r = await consulta(sql, [slug]);
    const producto = r.rows[0];

    if (!producto) {
      return res.status(404).json({ ok: false, error: "Producto no encontrado" });
    }

    const imgs = await consulta(
      `
      SELECT id, url, texto_alternativo, orden
      FROM imagenes_producto
      WHERE id_producto = $1
      ORDER BY orden ASC, id ASC;
      `,
      [producto.id]
    );

    res.json({ ok: true, producto, imagenes: imgs.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "Error al obtener producto" });
  }
}
