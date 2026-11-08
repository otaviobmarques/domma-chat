import { q, q1 } from "@domma/db";
import { buscarTrechos, montarSistema, type ConfigAgente, type Msg, type MaterialPrompt } from "@domma/ia";
import { configConta } from "@domma/core";

export async function carregarAgente(contaId: string) {
  const a = await q1<any>("SELECT * FROM agentes_ia WHERE conta_id = $1", [contaId]);
  const cfg = await configConta(contaId);
  const agente: ConfigAgente = {
    personalidade: a?.personalidade ?? "consultora", nome: a?.nome ?? "Duda", emojis: a?.emojis ?? "poucos", tratamento: a?.tratamento ?? "voce",
    instrucoes: a?.instrucoes ?? "", nomeEmpresa: cfg.nome,
    regras: { ...(a?.regras ?? {}), descontoMaximo: a?.regras?.descontoMaximo ?? cfg.descontoMaximo },
    interesses: a?.classificacao?.interesses ?? [],
  };
  return { agente, linha: a, cfg };
}

/** Monta o histórico para a IA: últimas N mensagens, com transcrições e leituras no lugar das mídias. */
export async function historico(conversaId: string, n = 24): Promise<Msg[]> {
  const rows = await q<any>(
    `SELECT autor, tipo, conteudo, leitura FROM (
       SELECT * FROM mensagens WHERE conversa_id = $1 AND autor IN ('cliente','ia','humano','nota') AND status <> 'cancelada' AND tipo <> 'evento'
       ORDER BY criado_em DESC LIMIT $2) x ORDER BY criado_em`, [conversaId, n]);
  return rows.map((m) => {
    const midia = m.tipo === "audio" ? `[áudio do cliente] ${m.leitura ?? "(sem transcrição)"}` : m.tipo === "imagem" ? `[foto] ${m.leitura ?? ""}` : m.tipo === "documento" ? `[documento] ${m.leitura ?? ""}` : "";
    const texto = [midia, m.conteudo].filter(Boolean).join(" ");
    return { papel: m.autor === "cliente" ? "cliente" : m.autor === "nota" ? "equipe" : "assistente", texto: m.autor === "humano" ? `(atendente) ${texto}` : texto } as Msg;
  });
}

export async function materiaisDisponiveis(contaId: string, conversaId: string, interesse?: string | null): Promise<(MaterialPrompt & { idCompleto: string })[]> {
  const rows = await q<any>(
    `SELECT m.id, m.titulo, m.quando_enviar,
            EXISTS (SELECT 1 FROM mensagens x WHERE x.conversa_id = $2 AND x.material_id = m.id) AS ja
            , m.interesses
       FROM materiais_ia m WHERE m.conta_id = $1 AND m.ativo`, [contaId, conversaId]);
  // Todos os materiais ativos entram; o interesse indicado ajuda a IA a decidir (o interesse do lead pode mudar na conversa).
  void interesse;
  return rows.map((r) => ({ id: r.id.slice(0, 8), idCompleto: r.id, titulo: r.titulo, quando: r.quando_enviar + (r.interesses?.length ? ` (indicado para: ${r.interesses.join(", ")})` : ""), jaEnviado: r.ja }));
}

export async function montarPedido(conv: any, opts: { objetivo?: string | null; extraSistema?: string } = {}) {
  const { agente, linha, cfg } = await carregarAgente(conv.conta_id);
  const hist = await historico(conv.id);
  const ultimaCliente = [...hist].reverse().find((m) => m.papel === "cliente")?.texto ?? "";
  const trechos = await buscarTrechos(conv.conta_id, ultimaCliente || conv.resumo_ia || "atendimento");
  const materiais = await materiaisDisponiveis(conv.conta_id, conv.id, conv.interesse);
  const contato = { nome: conv.contato_nome, cidade: conv.cidade, interesse: conv.interesse, temperatura: conv.temperatura, ...(conv.dados_extraidos ?? {}) };
  let sistema = montarSistema(agente, { trechos, materiais, resumo: conv.resumo_ia, objetivoCampanha: opts.objetivo, contato });
  if (opts.extraSistema) sistema += "\n\n" + opts.extraSistema;
  return { sistema, hist, trechos, materiais, agente, linha, cfg };
}
