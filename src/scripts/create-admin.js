import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
dotenv.config();

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  const nombre = process.argv[4] || "Administrador";

  if (!email || !password) {
    console.log("❌ Uso:");
    console.log("node scripts/create-admin.js email password nombre");
    process.exit(1);
  }

  console.log("🔐 Generando hash...");
  const passwordHash = await bcrypt.hash(password, 12);

  console.log("💾 Guardando en DB...");

  const { rows } = await pool.query(
    `
    INSERT INTO armeria_app.admin_users (email, password_hash, nombre, rol, activo)
    VALUES ($1, $2, $3, 'admin', true)
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          nombre = EXCLUDED.nombre,
          activo = true,
          updated_at = NOW()
    RETURNING id, email, nombre, rol, activo;
    `,
    [email, passwordHash, nombre]
  );

  console.log("✅ Admin creado/actualizado:");
  console.log(rows[0]);

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});