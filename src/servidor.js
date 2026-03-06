import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";

import productosRutas from "./routes/productos.routes.js";
import categoriasRutas from "./routes/categorias.routes.js";
import marcasRutas from "./routes/marcas.routes.js";
import testRutas from "./routes/test.routes.js";
import filtrosRutas from "./routes/filtros.routes.js";

// ✅ Admin
import adminRutas from "./routes/admin.routes.js";

dotenv.config();

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));

app.get("/health", (req, res) => {
  res.json({ ok: true, servicio: "armeria-backend" });
});

app.use("/api/test", testRutas);
app.use("/api/productos", productosRutas);
app.use("/api/categorias", categoriasRutas);
app.use("/api/marcas", marcasRutas);
app.use("/api/filtros", filtrosRutas);

// ✅ Panel admin (protegido por token)
app.use("/api/admin", adminRutas);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Ruta no encontrada" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend listo en http://localhost:${PORT}`);
});