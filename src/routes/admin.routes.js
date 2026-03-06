// src/routes/admin.routes.js
import { Router } from "express";
import AdminController from "../controllers/admin.controller.js";
import { requireAdmin } from "../middlewares/adminAuth.js";

const router = Router();

router.post("/login", AdminController.login);
router.get("/me", requireAdmin, AdminController.me);

router.get("/productos", requireAdmin, AdminController.listProductos);
router.put("/productos/:id", requireAdmin, AdminController.updateProducto);

// Import productos
router.post(
  "/import/csv",
  requireAdmin,
  AdminController.csvUploadMiddleware(),
  AdminController.importCSV
);

// ✅ Import imágenes
router.post(
  "/import/imagenes",
  requireAdmin,
  AdminController.csvUploadMiddleware(),
  AdminController.importImagenesCSV
);

export default router;