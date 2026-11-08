import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./index.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function migrar() {
  await pool.query("CREATE TABLE IF NOT EXISTS _migracoes (nome text PRIMARY KEY, aplicada_em timestamptz DEFAULT now())");
  const feitas = new Set((await pool.query("SELECT nome FROM _migracoes")).rows.map((r) => r.nome));
  for (const f of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    if (feitas.has(f)) continue;
    const sql = await readFile(path.join(dir, f), "utf8");
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(sql);
      await c.query("INSERT INTO _migracoes (nome) VALUES ($1)", [f]);
      await c.query("COMMIT");
      console.log(`migração aplicada: ${f}`);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrar().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
