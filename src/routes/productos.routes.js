// src/routes/productos.routes.js
import { Router } from "express";
import { listarProductos, obtenerProductoPorSlug } from "../controllers/productos.controller.js";

const router = Router();

router.get("/", listarProductos);
router.get("/:slug", obtenerProductoPorSlug);

export default router;
