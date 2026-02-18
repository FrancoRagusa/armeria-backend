// src/routes/categorias.routes.js
import { Router } from "express";
import { listarCategorias } from "../controllers/categorias.controller.js";

const router = Router();

router.get("/", listarCategorias);

export default router;
