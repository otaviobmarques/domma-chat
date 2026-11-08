import { q } from "@domma/db";
import type { Trecho } from "./prompt.ts";

/** Quebra o documento em trechos de ~700 caracteres respeitando parágrafos. */
export function fatiar(texto: string, tamanho = 700): string[] {
  const out: string[] = [];
  let atual = "";
  for (const par of texto.split(/\n{2,}|\r\n\r\n/).map((p) => p.trim()).filter(Boolean)) {
    if ((atual + "\n" + par).length > tamanho && atual) { out.push(atual); atual = par; }
    else atual = atual ? atual + "\n" + par : par;
    while (atual.length > tamanho * 1.5) { out.push(atual.slice(0, tamanho)); atual = atual.slice(tamanho); }
  }
  if (atual) out.push(atual);
  return out;
}

export async function indexarDocumento(contaId: string, documentoId: string, conteudo: string) {
  await q("DELETE FROM base_trechos WHERE documento_id = $1", [documentoId]);
  for (const t of fatiar(conteudo)) {
    await q("INSERT INTO base_trechos (conta_id, documento_id, texto) VALUES ($1,$2,$3)", [contaId, documentoId, t]);
  }
}

/**
 * Recupera os trechos mais relevantes. Usa busca textual do PostgreSQL (português).
 * Para busca semântica com vetores (pgvector), adicionar coluna embedding em base_trechos — ver README.
 */
export async function buscarTrechos(contaId: string, pergunta: string, limite = 5): Promise<Trecho[]> {
  const rows = await q<{ id: string; titulo: string; texto: string }>(
    `SELECT t.id, d.titulo, t.texto
       FROM base_trechos t JOIN base_conhecimento d ON d.id = t.documento_id
      WHERE t.conta_id = $1 AND t.busca @@ websearch_to_tsquery('portuguese', $2)
      ORDER BY ts_rank(t.busca, websearch_to_tsquery('portuguese', $2)) DESC LIMIT $3`,
    [contaId, pergunta.split(/\s+/).filter((p) => p.length > 2).join(" OR ") || pergunta, limite],
  );
  // Informações rápidas (tipo texto) sempre entram no contexto: horários, endereço, formas de pagamento.
  const fixos = await q<{ id: string; titulo: string; texto: string }>(
    `SELECT t.id, d.titulo, t.texto FROM base_trechos t JOIN base_conhecimento d ON d.id = t.documento_id
      WHERE t.conta_id = $1 AND d.tipo = 'texto' LIMIT 5`, [contaId]);
  const vistos = new Set<string>();
  return [...fixos, ...rows].filter((r) => (vistos.has(r.id) ? false : (vistos.add(r.id), true))).map((r) => ({ ...r, id: r.id.slice(0, 8) }));
}
