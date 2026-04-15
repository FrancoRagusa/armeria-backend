import jwt from "jsonwebtoken";

function extractToken(req) {
  const cookieToken = req.cookies?.admin_token;
  if (cookieToken) return cookieToken;

  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);

  return null;
}

export function requireAdmin(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ ok: false, message: "No autenticado" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || decoded.role !== "admin") {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    req.admin = {
      id: decoded.sub,
      email: decoded.email,
      nombre: decoded.nombre,
      role: decoded.role,
    };

    return next();
  } catch (_err) {
    return res.status(401).json({ ok: false, message: "Sesión inválida o vencida" });
  }
}