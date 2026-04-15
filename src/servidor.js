import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";

import productosRutas from "./routes/productos.routes.js";
import categoriasRutas from "./routes/categorias.routes.js";
import marcasRutas from "./routes/marcas.routes.js";
import testRutas from "./routes/test.routes.js";
import filtrosRutas from "./routes/filtros.routes.js";
import adminRutas from "./routes/admin.routes.js";

dotenv.config();

const app = express();
const isProd = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);

function parseAllowedOrigins(value) {
  if (!value || !String(value).trim()) {
    return ["http://localhost:5173"];
  }

  return String(value)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origen no permitido por CORS"));
    },
    credentials: true,
  })
);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 300 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    message: "Demasiadas solicitudes. Probá de nuevo en unos minutos.",
  },
});

app.use(globalLimiter);

app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(morgan(isProd ? "combined" : "dev"));

app.get("/health", (_req, res) => {
  res.json({ ok: true, servicio: "armeria-backend" });
});

app.use("/api/test", testRutas);
app.use("/api/productos", productosRutas);
app.use("/api/categorias", categoriasRutas);
app.use("/api/marcas", marcasRutas);
app.use("/api/filtros", filtrosRutas);
app.use("/api/admin", adminRutas);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Ruta no encontrada" });
});

app.use((err, _req, res, _next) => {
  console.error("server.error", err);

  if (err?.message === "Origen no permitido por CORS") {
    return res.status(403).json({
      ok: false,
      message: "Origen no permitido",
    });
  }

  return res.status(500).json({
    ok: false,
    message: "Error interno del servidor",
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend listo en http://localhost:${PORT}`);
});