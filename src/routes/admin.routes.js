import { Router } from "express";
import AdminController from "../controllers/admin.controller.js";
import { requireAdmin } from "../middlewares/adminAuth.js";

const router = Router();

router.post("/login", AdminController.login);
router.post("/logout", requireAdmin, AdminController.logout);
router.get("/me", requireAdmin, AdminController.me);

router.get("/productos", requireAdmin, AdminController.listProductos);
router.put("/productos/:id", requireAdmin, AdminController.updateProducto);
router.patch("/productos/:id/toggle-activo", requireAdmin, AdminController.toggleProductoActivo);

// Imágenes manuales
router.get("/productos/:id/imagenes", requireAdmin, AdminController.listImagenes);
router.post("/productos/:id/imagenes", requireAdmin, AdminController.addImagen);
router.put("/imagenes/:id", requireAdmin, AdminController.updateImagen);
router.delete("/imagenes/:id", requireAdmin, AdminController.deleteImagen);

// Import productos
router.post(
  "/import/csv",
  requireAdmin,
  AdminController.csvUploadMiddleware(),
  AdminController.importCSV
);

// Import imágenes
router.post(
  "/import/imagenes",
  requireAdmin,
  AdminController.csvUploadMiddleware(),
  AdminController.importImagenesCSV
);

export default router;