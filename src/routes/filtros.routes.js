import { Router } from "express";
import { obtenerFiltros } from "../controllers/filtros.controller.js";

const router = Router();

router.get("/", obtenerFiltros);

export default router;
