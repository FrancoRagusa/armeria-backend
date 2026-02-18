// src/routes/marcas.routes.js
import { Router } from "express";
import { listarMarcas } from "../controllers/marcas.controller.js";

const router = Router();

router.get("/", listarMarcas);

export default router;
