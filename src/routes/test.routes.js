import { Router } from "express";
import { consulta } from "../db.js";

const router = Router();

router.get("/db", async (req, res) => {
  const r = await consulta("SELECT NOW() as ahora;");
  res.json({ ok: true, ahora: r.rows[0].ahora });
});

export default router;
