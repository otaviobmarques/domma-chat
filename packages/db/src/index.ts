import pg from "pg";

const { Pool } = pg;
// numeric -> number, bigint -> number (valores monetários pequenos)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://domma:domma@localhost:5432/domma",
  max: Number(process.env.DB_POOL_MAX ?? 10),
});

// Na Supabase as tabelas ficam no schema "domma" (fora da API pública). Localmente, "public".
const schema = process.env.DB_SCHEMA;
if (schema) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("DB_SCHEMA inválido");
  pool.on("connect", (c) => { c.query(`SET search_path TO ${schema}, extensions, public`).catch(() => {}); });
}

export type Executor = Pick<pg.PoolClient, "query">;

export async function q<T = any>(sql: string, params: unknown[] = [], ex: Executor = pool): Promise<T[]> {
  const r = await ex.query(sql, params as any[]);
  return r.rows as T[];
}

export async function q1<T = any>(sql: string, params: unknown[] = [], ex: Executor = pool): Promise<T | null> {
  const rows = await q<T>(sql, params, ex);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

export async function auditar(
  contaId: string,
  ator: "usuario" | "ia" | "sistema",
  acao: string,
  alvo?: string,
  dados?: unknown,
  usuarioId?: string | null,
) {
  await q(
    "INSERT INTO eventos_auditoria (conta_id, usuario_id, ator, acao, alvo, dados) VALUES ($1,$2,$3,$4,$5,$6)",
    [contaId, usuarioId ?? null, ator, acao, alvo ?? null, dados ? JSON.stringify(dados) : null],
  );
}
