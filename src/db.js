// src/db.js
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

export const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});

// helper para consultar siempre en tu schema
export async function consulta(texto, params = []) {
  const cliente = await pool.connect();
  try {
    const schema = process.env.DB_SCHEMA || "public";
    await cliente.query(`SET search_path TO ${schema}, public;`);
    const res = await cliente.query(texto, params);
    return res;
  } finally {
    cliente.release();
  }
}
