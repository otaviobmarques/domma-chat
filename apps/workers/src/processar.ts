import { auditar, q, q1 } from "@domma/db";
import {
  agendarRetorno, aplicarEtiquetas, cancelarRetornos, conversaCompleta, criarAlerta, emitirConversa, enfileirarFala, enviarSistema,
  evento, inserirMensagem, publicar, transferirParaHumano, trocarModo, redis,
} from "@domma/core";
import { classificarIntencao, ehDespedidaDaIA, ESQUEMA_RESPOSTA, extrairJson, gerarComFallback, SaidaResposta, TodosProvedoresFalharam } from "@domma/ia";
import { dentroDoHorario, interpretarRetorno, mascararSensiveis, proximaAbertura, rotular } from "@domma/shared";
import { montarPedido } from "./contexto.ts";
import { excedeuRespostas, marcarRespostaIA, registrarMensagemCliente, suspeitaRobo } from "./porteiro.ts";

const log = (...a: unknown[]) => console.log("[processar]", ...a);

/** Mensagens do cliente ainda não respondidas (depois da última fala da IA/atendente). */
async function pendentesDoCliente(conversaId: string) {
  return q<any>(
    `SELECT * FROM mensagens WHERE conversa_id = $1 AND autor = 'cliente'
        AND criado_em > COALESCE((SELECT max(criado_em) FROM mensagens WHERE conversa_id = $1 AND autor IN ('ia','humano') AND status <> 'cancelada'), 'epoch')
      ORDER BY criado_em`, [conversaId]);
}

async function feriadosDe(contaId: string) {
  return new Set((await q<{ dia: string }>("SELECT to_char(dia,'YYYY-MM-DD') AS dia FROM feriados WHERE conta_id = $1", [contaId])).map((r) => r.dia));
}

/** Primeiro passo de todo job (seção 7.2): o porteiro decide se a IA é chamada. */
export async function processarConversa(conversaId: string, gatilho: string) {
  const conv = await conversaCompleta(conversaId);
  if (!conv || conv.estado !== "aberta") return "sem-conversa";
  if (conv.opt_out && gatilho !== "mensagem") return "opt-out";
  const pend = await pendentesDoCliente(conversaId);

  if (gatilho === "mensagem") {
    if (!pend.length) return "nada-pendente";
    // Cliente escreveu: cancela retornos agendados (seção 2.11).
    const soDespedida = pend.every((m) => ["figurinha", "reacao"].includes(m.tipo) || classificarIntencao(m.conteudo ?? "") === "despedida");
    if (conv.retorno && !soDespedida) { await cancelarRetornos(conversaId); await evento(conv.conta_id, conversaId, "Retorno agendado cancelado: o cliente escreveu antes."); }
  }

  // Opt-out e LGPD valem em qualquer modo, inclusive Humano.
  if (gatilho === "mensagem") {
    const intencoes = pend.map((m) => classificarIntencao(m.conteudo ?? ""));
    const intencao = intencoes.includes("exclusao_dados") ? "exclusao_dados" : intencoes.includes("opt_out") ? "opt_out" : "outro";
      if (intencao === "opt_out" || intencao === "exclusao_dados") {
        await q("UPDATE contatos SET opt_out = true, opt_out_em = now() WHERE id = $1", [conv.contato_id]);
        await cancelarRetornos(conversaId);
        await auditar(conv.conta_id, "sistema", intencao === "exclusao_dados" ? "lgpd:pedido_exclusao" : "lgpd:opt_out", conv.contato_id);
        if (intencao === "exclusao_dados") await criarAlerta(conv.conta_id, { nivel: "atencao", tipo: "lgpd", titulo: "Pedido de exclusão de dados (LGPD)", detalhe: `${conv.contato_nome ?? conv.telefone} pediu a exclusão dos dados.`, chave: `lgpd:${conv.contato_id}`, alvo: { conversaId } });
        await enviarSistema(conversaId, intencao === "exclusao_dados"
          ? "Pedido registrado. Você não vai mais receber mensagens nossas e seus dados serão excluídos conforme a LGPD."
          : "Pronto, você não vai mais receber mensagens nossas. Se precisar, é só chamar por aqui.", { forcar: true });
        await trocarModo(conversaId, "humano", { motivo: "opt-out do cliente", ator: "sistema" });
        return "opt-out";
      }
  }

  if (conv.modo === "humano") {
    if (gatilho === "mensagem" && conv.responsavel_id) {
      const { notificar } = await import("@domma/core");
      await notificar([conv.responsavel_id], `Nova mensagem de ${conv.contato_nome ?? conv.telefone}`, pend.at(-1)?.conteudo ?? "Mídia", `/atendimento/${conversaId}`);
    }
    return "modo-humano";
  }

  const { cfg } = await import("./contexto.ts").then((m) => m.carregarAgente(conv.conta_id));
  const textoCliente = pend.map((m) => [m.conteudo, m.leitura].filter(Boolean).join(" ")).join("\n").trim();
  const ultima = pend.at(-1);

  if (gatilho === "mensagem") {
    // Só figurinha/reação: não chama a IA.
    if (pend.every((m) => ["figurinha", "reacao"].includes(m.tipo))) return "ignorado-figurinha";

    // Vídeo ou áudio sem transcrição: pede para reenviar; se persistir, humano.
    if (pend.every((m) => m.tipo === "video" || (m.tipo === "audio" && !m.leitura))) {
      const n = await redis.incr(`inaudivel:${conversaId}`); await redis.expire(`inaudivel:${conversaId}`, 3600);
      if (n >= 2) { await transferirParaHumano(conversaId, "mídia que a IA não conseguiu entender"); return "transferido-midia"; }
      await enviarSistema(conversaId, "Não consegui ouvir/ver direitinho por aqui 😕 Você pode escrever ou mandar o áudio de novo?");
      return "pediu-reenvio";
    }

    const intencao = classificarIntencao(pend.length > 1 ? (ultima?.conteudo ?? textoCliente) : textoCliente);
    log(conversaId.slice(0, 8), "intenção:", intencao);

    if (intencao === "agressivo_juridico") {
      await enviarSistema(conversaId, "Sinto muito pela situação. Vou passar agora para uma pessoa da equipe resolver isso com prioridade.");
      await transferirParaHumano(conversaId, "reclamação grave (xingamento, Procon ou processo)", { prioridade: "maxima" });
      return "transferido-prioridade";
    }
    if (intencao === "pedido_humano") {
      const fer = await feriadosDe(conv.conta_id);
      if (!dentroDoHorario(new Date(), cfg.horario, fer)) {
        const abertura = proximaAbertura(new Date(), cfg.horario, fer);
        await enviarSistema(conversaId, `Nossa equipe atende de ${cfg.horario.inicio} às ${cfg.horario.fim}. Já deixei agendado: ${rotular(abertura).toLowerCase()} alguém te chama por aqui!`);
        await agendarRetorno(conversaId, abertura, "cliente", "lembrete");
        await q("UPDATE conversas SET esperando_humano_desde = $2 WHERE id = $1", [conversaId, abertura]);
        return "humano-fora-horario";
      }
      await enviarSistema(conversaId, "Claro! Vou te passar para um atendente agora mesmo.");
      await transferirParaHumano(conversaId, "cliente pediu atendente");
      return "transferido";
    }
    if (intencao === "pergunta_robo") {
      // Regra fixa de transparência: não depende do modelo.
      const { agente } = await import("./contexto.ts").then((m) => m.carregarAgente(conv.conta_id));
      await enfileirarFala(conversaId, [`Sou a ${agente.nome}, assistente virtual da ${cfg.nome} 😊`, "Se preferir, chamo uma pessoa da equipe pra falar com você. É só dizer!"], { idCliente: ultima?.id_externo });
      return "transparencia";
    }
    if (intencao === "quem_e") {
      await enfileirarFala(conversaId, [`Oi! Aqui é o atendimento da ${cfg.nome}.`, "Se recebeu esta mensagem por engano, é só responder SAIR que tiramos seu número da lista."], { idCliente: ultima?.id_externo });
      return "apresentacao";
    }

    // Despedida em conversa encerrada: uma reação 👍 e depois silêncio (trava final).
    const ultimaIA = await q1<any>("SELECT conteudo FROM mensagens WHERE conversa_id = $1 AND autor = 'ia' AND tipo = 'texto' ORDER BY criado_em DESC LIMIT 1", [conversaId]);
    if (intencao === "despedida" && ultimaIA && ehDespedidaDaIA(ultimaIA.conteudo ?? "")) {
      const jaReagiu = await redis.get(`reagiu:${conversaId}`);
      if (!jaReagiu && ultima?.id_externo) {
        await redis.set(`reagiu:${conversaId}`, "1", "EX", 86400);
        const { filas } = await import("@domma/core");
        await filas.envio.add("reacao", { contaId: conv.conta_id, conversaId, tipo: "reacao", autor: "ia", emoji: "👍", idAlvo: ultima.id_externo });
        return "reagiu";
      }
      return "silencio-despedida";
    }
    await redis.del(`reagiu:${conversaId}`);

    // Mesma mensagem repetida N vezes na janela: passa para humano.
    const repeticoes = await registrarMensagemCliente(conversaId, textoCliente, cfg.antiLoop.janelaMin);
    if (repeticoes >= cfg.antiLoop.repeticoes) {
      await transferirParaHumano(conversaId, `cliente repetiu a mesma mensagem ${repeticoes} vezes`);
      return "repeticao";
    }

    // Robô do outro lado.
    const ultimaIAts = await q1<{ t: Date }>("SELECT max(criado_em) AS t FROM mensagens WHERE conversa_id = $1 AND autor = 'ia'", [conversaId]);
    const ms = ultimaIAts?.t && ultima ? new Date(ultima.criado_em).getTime() - new Date(ultimaIAts.t).getTime() : null;
    if (await suspeitaRobo(conversaId, ms, textoCliente, cfg.antiLoop.roboMs)) {
      await aplicarEtiquetas(conversaId, ["Robô detectado"]);
      await trocarModo(conversaId, "humano", { motivo: "Robô detectado do outro lado", ator: "sistema" });
      await criarAlerta(conv.conta_id, { nivel: "atencao", tipo: "robo", titulo: "Robô detectado", detalhe: `${conv.contato_nome ?? conv.telefone}: respostas automáticas. IA pausada.`, chave: `robo:${conversaId}`, alvo: { conversaId } });
      return "robo";
    }

    // Retorno pedido pelo cliente.
    const pedidoRetorno = interpretarRetorno(textoCliente, new Date(), cfg.horario, await feriadosDe(conv.conta_id));
    if (pedidoRetorno?.tipo === "agendar") await agendarRetorno(conversaId, pedidoRetorno.quando, "cliente", "ia", pedidoRetorno.rotulo);
    if (pedidoRetorno?.tipo === "perguntar_dia") {
      const { somarDiasUteis } = await import("@domma/shared");
      await agendarRetorno(conversaId, somarDiasUteis(new Date(), 2, 9 * 60, cfg.horario, await feriadosDe(conv.conta_id)), "cliente", "ia");
    }
  }

  // Limite de respostas seguidas: pausa a IA e avisa a equipe.
  const lim = await excedeuRespostas(conversaId, cfg.antiLoop.maxPor10min, cfg.antiLoop.maxDia);
  if (lim.excedeu) {
    await trocarModo(conversaId, "humano", { motivo: "muitas respostas seguidas da IA", ator: "sistema" });
    await criarAlerta(conv.conta_id, { nivel: "atencao", tipo: "loop", titulo: "IA pausada por excesso de respostas", detalhe: `${conv.contato_nome ?? conv.telefone}: ${lim.n10} respostas em 10 min.`, chave: `loop:${conversaId}`, alvo: { conversaId }, push: true });
    return "limite-respostas";
  }

  return chamarIA(conv, gatilho, ultima?.id_externo);
}

export async function chamarIA(conv: any, gatilho: string, idCliente?: string) {
  const conversaId = conv.id;
  const campanha = await q1<{ objetivo: string }>(
    `SELECT c.objetivo FROM campanha_envios e JOIN campanhas c ON c.id = e.campanha_id WHERE e.contato_id = $1 ORDER BY e.enviado_em DESC NULLS LAST LIMIT 1`, [conv.contato_id]);
  const extra = gatilho === "retomada" ? "SITUAÇÃO: a conversa acabou de ser devolvida para você. Leia o histórico e envie UMA mensagem curta de retomada, coerente com o que já foi conversado."
    : gatilho === "retorno" ? "SITUAÇÃO: este é o retorno agendado que você combinou com o cliente. Retome com o contexto, ex.: 'Oi, [nome]! Como combinamos, voltei pra gente continuar…'"
    : gatilho === "lead" ? "SITUAÇÃO: este é um lead novo que acabou de chegar do CRM/formulário. Faça o primeiro contato: apresente-se e conecte com o interesse dele."
    : undefined;
  const ped = await montarPedido(conv, { objetivo: campanha?.objetivo, extraSistema: extra });
  if (gatilho !== "mensagem" && !ped.hist.length) ped.hist.push({ papel: "cliente", texto: "(sem mensagens ainda)" });

  await publicar(conv.conta_id, "ia.digitando", { conversaId, ativo: true });
  let saida: SaidaResposta;
  let provedorNome = "";
  try {
    const r = await gerarComFallback(conv.conta_id, { sistema: ped.sistema, historico: ped.hist, tempoLimiteMs: Number(process.env.IA_TEMPO_LIMITE_MS ?? 12000), esquema: ESQUEMA_RESPOSTA }, {
      conversaId,
      aoAvisarLimite: (rot, pct) => { criarAlerta(conv.conta_id, { nivel: "atencao", tipo: "gasto_ia", titulo: `${rot} chegou a ${pct}% do limite mensal`, chave: `gasto:${rot}:${new Date().toISOString().slice(0, 7)}` }); },
    });
    provedorNome = r.provedorNome;
    saida = SaidaResposta.parse(extrairJson(r.texto));
  } catch (e) {
    await publicar(conv.conta_id, "ia.digitando", { conversaId, ativo: false });
    const motivo = e instanceof TodosProvedoresFalharam ? "IA indisponível" : "IA devolveu resposta inválida";
    log("falha IA", conversaId.slice(0, 8), (e as Error).message);
    await inserirMensagem({ contaId: conv.conta_id, conversaId, autor: "nota", conteudo: `${motivo}. A conversa foi passada para a equipe. (${(e as Error).message.slice(0, 200)})` });
    await transferirParaHumano(conversaId, motivo);
    await criarAlerta(conv.conta_id, { nivel: "urgente", tipo: "ia_indisponivel", titulo: motivo, detalhe: "Todos os provedores de IA falharam. Conversas estão indo para a equipe.", chave: "ia_indisponivel", push: true });
    return "ia-falhou";
  }
  const { resolverAlerta } = await import("@domma/core");
  await resolverAlerta(conv.conta_id, "ia_indisponivel");

  await atualizarClassificacao(conv, saida);

  const idsMateriais = saida.enviar_materiais.map((curto) => ped.materiais.find((m) => m.id === curto || m.idCompleto === curto)?.idCompleto).filter((x): x is string => !!x);
  const partes = saida.partes.map((p) => mascararSensiveis(p).texto).filter(Boolean);
  const atual = await q1<{ modo: string }>("SELECT modo FROM conversas WHERE id = $1", [conversaId]);

  if (saida.responder && (partes.length || idsMateriais.length)) {
    if (atual?.modo === "aprova") {
      const s = await q1<any>("INSERT INTO sugestoes_ia (conta_id, conversa_id, partes) VALUES ($1,$2,$3) RETURNING *", [conv.conta_id, conversaId, partes]);
      if (idsMateriais.length) await q("UPDATE sugestoes_ia SET partes = partes || $2::text[] WHERE id = $1", [s.id, idsMateriais.map((id) => `[[material:${id}]]`)]);
      await publicar(conv.conta_id, "sugestao.pronta", { ...s, conversaId });
    } else if (atual?.modo === "ia") {
      await enfileirarFala(conversaId, partes, { materiais: idsMateriais, fontes: saida.fontes, velocidade: ped.linha?.velocidade_escrita, idCliente });
      await marcarRespostaIA(conversaId);
    }
  } else {
    await publicar(conv.conta_id, "ia.digitando", { conversaId, ativo: false });
  }

  if (saida.etiquetas.length) await aplicarEtiquetas(conversaId, saida.etiquetas);
  if (saida.agendar_retorno && !(await q1("SELECT 1 FROM retornos WHERE conversa_id = $1 AND status = 'agendado'", [conversaId]))) {
    const { configConta } = await import("@domma/core");
    const cfg = await configConta(conv.conta_id);
    const pedido = interpretarRetorno((ped.hist.filter((m) => m.papel === "cliente").at(-1)?.texto ?? "") + " me chama", new Date(), cfg.horario);
    if (pedido?.tipo === "agendar") await agendarRetorno(conversaId, pedido.quando, "cliente", "ia", pedido.rotulo);
  }
  if (saida.transferir) {
    // Espera as partes saírem antes de trocar para humano (trocar cancelaria a fala).
    const { filas } = await import("@domma/core");
    await filas.ia.add("transferir", { conversaId, motivo: saida.transferir.motivo }, { delay: 1500 + partes.join("").length * 45 + partes.length * 2500 });
  }
  log(conversaId.slice(0, 8), `IA(${provedorNome}) responder=${saida.responder} partes=${partes.length} materiais=${idsMateriais.length} transferir=${!!saida.transferir}`);
  return "respondeu";
}

async function atualizarClassificacao(conv: any, s: SaidaResposta) {
  const c = s.classificacao;
  const nota = Math.max(0, Math.min(100, Math.round(c.nota)));
  const dados = Object.fromEntries(c.dados.filter((d) => d.campo && d.valor).map((d) => [d.campo, d.valor]));
  const ficouQuente = c.temperatura === "quente" && conv.temperatura !== "quente";
  await q(`UPDATE contatos SET temperatura = $2, nota = $3, interesse = COALESCE(NULLIF($4,'geral'), interesse), motivo_classificacao = $5,
             dados_extraidos = dados_extraidos || $6::jsonb, cidade = COALESCE(cidade, $7) WHERE id = $1`,
    [conv.contato_id, c.temperatura, nota, c.interesse, c.motivo, JSON.stringify(dados), dados.cidade ?? null]);
  await q("UPDATE conversas SET resumo_ia = $2, sentimento = $3, anti_loop = anti_loop || jsonb_build_object('assunto', $4::text) WHERE id = $1", [conv.id, s.resumo, s.sentimento, s.assunto]);
  await q("UPDATE oportunidades SET interesse = COALESCE(NULLIF($2,'geral'), interesse) WHERE contato_id = $1", [conv.contato_id, c.interesse]);
  if (ficouQuente) {
    // Quente: avisa a equipe responsável e move para a fila do interesse (seção 2.10).
    const fila = { franquia: "Expansão" }[c.interesse as string];
    if (fila) await q("UPDATE conversas SET fila = $2 WHERE id = $1", [conv.id, fila]);
    await criarAlerta(conv.conta_id, { nivel: "info", tipo: "lead_quente", titulo: `Lead quente: ${conv.contato_nome ?? conv.telefone}`, detalhe: `${c.interesse} · nota ${nota} · ${c.motivo}`, chave: `quente:${conv.contato_id}`, alvo: { conversaId: conv.id }, push: true });
  }
  await emitirConversa(conv.id);
}
