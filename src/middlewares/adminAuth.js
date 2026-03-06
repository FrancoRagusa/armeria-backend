// src/middlewares/adminAuth.js
import jwt from "jsonwebtoken";

export function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ ok: false, message: "No token" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || decoded.role !== "admin") {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    req.admin = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Invalid token" });
  }
}