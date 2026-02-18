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

dotenv.config();

const app = express(); // 👈 PRIMERO se declara app

app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));

app.get("/health", (req, res) => {
  res.json({ ok: true, servicio: "armeria-backend" });
});
console.log("testRutas:", typeof testRutas);
console.log("productosRutas:", typeof productosRutas);
console.log("categoriasRutas:", typeof categoriasRutas);
console.log("marcasRutas:", typeof marcasRutas);

app.use("/api/test", testRutas); // 👈 ahora sí
app.use("/api/productos", productosRutas);
app.use("/api/categorias", categoriasRutas);
app.use("/api/marcas", marcasRutas);
app.use("/api/filtros", filtrosRutas);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Ruta no encontrada" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend listo en http://localhost:${PORT}`);
});
