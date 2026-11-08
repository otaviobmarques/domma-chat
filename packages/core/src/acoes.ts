import { q1 } from "@domma/db";
import { interpretarRetorno } from "@domma/shared";
import { configConta } from "./config.ts";
import { agendarRetorno, aplicarEtiquetas, enfileirarFala } from "./conversas.ts";
import { publicar } from "./redis.ts";

/** Executa o resultado de uma instrução do "Fale com a IA". No modo IA envia na hora; nos modos IA sugere e Humano vira sugestão para aprovar. */
export async function executarAcoes(conv: any, a: { mensagens: string[]; retorno?: string | null; etiquetas?: string[]; materiais?: string[] }) {
  if (a.etiquetas?.length) await aplicarEtiquetas(conv.id, a.etiquetas);
  if (a.retorno) {
    const cfg = await configConta(conv.conta_id);
    const p = interpretarRetorno(`me chama ${a.retorno}`, new Date(), cfg.horario);
    if (p?.tipo === "agendar") await agendarRetorno(conv.id, p.quando, "equipe", "ia", p.rotulo);
  }
  if (!a.mensagens.length && !a.materiais?.length) return;
  if (conv.modo === "ia") await enfileirarFala(conv.id, a.mensagens, { materiais: a.materiais });
  else {
    const partes = [...a.mensagens, ...(a.materiais ?? []).map((id) => `[[material:${id}]]`)];
    const s = await q1<any>("INSERT INTO sugestoes_ia (conta_id, conversa_id, partes) VALUES ($1,$2,$3) RETURNING *", [conv.conta_id, conv.id, partes]);
    await publicar(conv.conta_id, "sugestao.pronta", { ...s, conversaId: conv.id });
  }
}
