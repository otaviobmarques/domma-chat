import type { Job } from "bullmq";
import { q, q1 } from "@domma/db";
import { enfileirarProcessamento, guardarArquivo, publicar } from "@domma/core";
import { executarComFallback } from "@domma/ia";
import { canalDaConexao } from "@domma/whatsapp";

export interface JobMidia { mensagemId: string; midia: { mediaId?: string; base64?: string; mime?: string; nomeArquivo?: string } }

/** Baixa a mídia, guarda no armazenamento e transcreve/lê com a IA (seção 3.1, passo 2). */
export async function processarMidia(job: Job<JobMidia>) {
  const m = await q1<any>(
    `SELECT m.*, cx.tipo AS cx_tipo, cx.credenciais, cx.id AS cx_id FROM mensagens m JOIN conversas cv ON cv.id = m.conversa_id JOIN conexoes cx ON cx.id = cv.conexao_id WHERE m.id = $1`, [job.data.mensagemId]);
  if (!m) return "sem-mensagem";
  let chave = m.midia_url as string | null;
  let dados: Buffer | null = null, mime = m.midia_mime ?? job.data.midia.mime ?? "application/octet-stream";
  if (!chave) {
    const canal = canalDaConexao({ id: m.cx_id, conta_id: m.conta_id, tipo: m.cx_tipo, credenciais: m.credenciais });
    const b = await canal.baixarMidia(job.data.midia, m.id_externo);
    dados = b.dados; mime = b.mime;
    if (dados.length) chave = await guardarArquivo(m.conta_id, dados, mime);
    await q("UPDATE mensagens SET midia_url = $2, midia_mime = $3 WHERE id = $1", [m.id, chave, mime]);
  } else {
    const { lerArquivo } = await import("@domma/core");
    dados = await lerArquivo(chave);
  }

  let leitura: string | null = null;
  try {
    if (m.tipo === "audio" && dados?.length) {
      leitura = (await executarComFallback(m.conta_id, "transcricao", (p) => p.transcrever?.(dados!, mime, 30000), { conversaId: m.conversa_id })).texto;
    } else if ((m.tipo === "imagem" || (m.tipo === "documento" && mime.startsWith("image/"))) && dados?.length) {
      leitura = (await executarComFallback(m.conta_id, "imagem", (p) => p.lerImagem?.(dados!, mime, "O que há nesta imagem? Se for documento (CRLV, CNH, comprovante, print), transcreva os dados principais (placa, modelo, nomes, valores). Responda em uma ou duas frases.", 30000), { conversaId: m.conversa_id })).texto;
    } else if (m.tipo === "documento" && mime === "application/pdf" && dados?.length) {
      leitura = `PDF recebido (${job.data.midia.nomeArquivo ?? "documento"}).`;
    }
  } catch (e) {
    leitura = null;
    console.warn("[midia] leitura falhou:", (e as Error).message);
  }
  const atual = await q1("UPDATE mensagens SET leitura = $2 WHERE id = $1 RETURNING *", [m.id, leitura]);
  await publicar(m.conta_id, "mensagem.status", atual);
  await enfileirarProcessamento(m.conversa_id, "mensagem", 500);
  return leitura ? "lido" : "sem-leitura";
}
