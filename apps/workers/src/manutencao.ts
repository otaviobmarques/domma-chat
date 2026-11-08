import type { Job } from "bullmq";
import { q } from "@domma/db";
import { criarAlerta, emitirConversa, enviarSistema, evento, filas, notificarGestores, publicar, resolverAlerta, vigiarSaude } from "@domma/core";
import { AdminEvolution, nomeInstancia } from "@domma/whatsapp";

export async function agendarManutencao() {
  await filas.manutencao.upsertJobScheduler("conexoes", { every: 60_000 }, { name: "conexoes" });
  await filas.manutencao.upsertJobScheduler("esperas", { every: 60_000 }, { name: "esperas" });
  await filas.manutencao.upsertJobScheduler("saude-ia", { every: 60_000 }, { name: "saude-ia" });
  await filas.manutencao.upsertJobScheduler("encerrar", { every: 15 * 60_000 }, { name: "encerrar" });
  await filas.manutencao.upsertJobScheduler("metricas", { every: 10_000 }, { name: "metricas" });
  await filas.manutencao.upsertJobScheduler("saude", { every: 5 * 60_000 }, { name: "saude" });
  await filas.manutencao.upsertJobScheduler("limpeza", { pattern: "0 3 * * *", tz: "America/Sao_Paulo" }, { name: "limpeza" });
}

export async function processarManutencao(job: Job) {
  switch (job.name) {
    case "conexoes": return verificarConexoes();
    case "esperas": return verificarEsperas();
    case "saude-ia": return verificarIA();
    case "encerrar": return encerrarInativas();
    case "metricas": {
      const contas = await q<{ id: string }>("SELECT id FROM contas");
      for (const c of contas) await publicar(c.id, "dashboard.metricas", { em: Date.now() });
      return "ok";
    }
    case "limpeza": return limpeza();
    case "saude": await vigiarSaude(); return "ok";
  }
}

/** Estado das conexões QR a cada 1 min; restart com espera crescente; 3 falhas → "precisa de atenção". */
async function verificarConexoes() {
  if (!process.env.EVOLUTION_URL) return "sem-evolution";
  const admin = new AdminEvolution();
  for (const c of await q<any>("SELECT * FROM conexoes WHERE tipo = 'qr' AND status IN ('conectada','caiu','reconectando')")) {
    const estado = await admin.estado(nomeInstancia(c)).catch(() => "erro");
    if (estado === "open") {
      if (c.status !== "conectada") { await q("UPDATE conexoes SET status = 'conectada', tentativas_restart = 0 WHERE id = $1", [c.id]); await resolverAlerta(c.conta_id, `conexao:${c.id}`); await publicar(c.conta_id, "conexao.estado", { id: c.id, status: "conectada" }); }
      continue;
    }
    const tent = c.tentativas_restart + 1;
    if (tent > 3) {
      await q("UPDATE conexoes SET status = 'precisa_atencao' WHERE id = $1", [c.id]);
      await criarAlerta(c.conta_id, { nivel: "urgente", tipo: "conexao", titulo: `Número ${c.nome} precisa de atenção`, detalhe: "3 tentativas de reconexão falharam. Gere um novo QR Code.", chave: `conexao:${c.id}`, alvo: { conexaoId: c.id }, push: true });
    } else {
      await q("UPDATE conexoes SET status = 'reconectando', tentativas_restart = $2 WHERE id = $1", [c.id, tent]);
      await criarAlerta(c.conta_id, { nivel: "urgente", tipo: "conexao", titulo: `Número do QR Code desconectado`, detalhe: `${c.nome} · tentando reconectar (${tent}/3)`, chave: `conexao:${c.id}`, alvo: { conexaoId: c.id }, push: tent === 1 });
      setTimeout(() => admin.reiniciar(nomeInstancia(c)).catch(() => {}), tent * 5000);
    }
    await publicar(c.conta_id, "conexao.estado", { id: c.id, status: tent > 3 ? "precisa_atencao" : "reconectando" });
  }
  return "ok";
}

/** Clientes esperando humano além do limite; atendente que assumiu e não respondeu. */
async function verificarEsperas() {
  const contas = await q<any>("SELECT id, config FROM contas");
  for (const conta of contas) {
    const limite = Number(conta.config?.alertas?.esperaHumanoMin ?? 5);
    const semResp = Number(conta.config?.alertas?.atendenteSemResponderMin ?? 10);
    const esperando = await q<any>(
      `SELECT cv.id, ct.nome, cv.fila, extract(epoch FROM now() - cv.esperando_humano_desde)/60 AS min FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id
        WHERE cv.conta_id = $1 AND cv.modo = 'humano' AND cv.estado = 'aberta' AND cv.esperando_humano_desde < now() - make_interval(mins => $2)`, [conta.id, limite]);
    if (esperando.length) {
      await criarAlerta(conta.id, { nivel: "urgente", tipo: "espera", titulo: `${esperando.length} cliente(s) esperando há mais de ${limite} minutos`, detalhe: esperando.slice(0, 3).map((e) => e.nome ?? "cliente").join(", "), chave: `espera-geral:${conta.id}`, push: true });
    } else await resolverAlerta(conta.id, `espera-geral:${conta.id}`);

    // Atendente assumiu e não respondeu em X min: alerta ao supervisor e a IA avisa o cliente.
    const parados = await q<any>(
      `SELECT cv.id, ct.nome FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id
        WHERE cv.conta_id = $1 AND cv.modo = 'humano' AND cv.estado = 'aberta' AND cv.responsavel_id IS NOT NULL
          AND (SELECT max(criado_em) FROM mensagens m WHERE m.conversa_id = cv.id AND m.autor = 'cliente') > COALESCE((SELECT max(criado_em) FROM mensagens m WHERE m.conversa_id = cv.id AND m.autor IN ('humano','ia')), 'epoch')
          AND (SELECT max(criado_em) FROM mensagens m WHERE m.conversa_id = cv.id AND m.autor = 'cliente') < now() - make_interval(mins => $2)
          AND NOT (cv.anti_loop ? 'avisou_espera')`, [conta.id, semResp]);
    for (const p of parados) {
      await q("UPDATE conversas SET anti_loop = anti_loop || '{\"avisou_espera\": true}' WHERE id = $1", [p.id]);
      await enviarSistema(p.id, "Já já alguém da equipe te responde por aqui, tá? Obrigada pela paciência!");
      await criarAlerta(conta.id, { nivel: "atencao", tipo: "atendente_parado", titulo: `${p.nome ?? "Cliente"} sem resposta do atendente`, detalhe: `Mais de ${semResp} min sem resposta.`, chave: `parado:${p.id}`, alvo: { conversaId: p.id } });
      await notificarGestores(conta.id, "Atendente sem responder", `${p.nome ?? "Cliente"} aguarda há mais de ${semResp} min.`);
    }
  }
  return "ok";
}

async function verificarIA() {
  const lentos = await q<any>(
    `SELECT p.conta_id, p.id, COALESCE(p.rotulo, p.provedor) AS nome, p.ultimo_tempo_ms, p.degradado_ate, (c.config->'alertas'->>'iaLentaMs')::int AS lim
       FROM provedores_ia p JOIN contas c ON c.id = p.conta_id WHERE p.ativo ORDER BY p.ordem`);
  for (const p of lentos) {
    const lim = p.lim ?? 8000;
    if (p.degradado_ate && new Date(p.degradado_ate) > new Date()) await criarAlerta(p.conta_id, { nivel: "atencao", tipo: "ia_backup", titulo: "Backup de IA em uso", detalhe: `${p.nome} com falha; o próximo da ordem está respondendo.`, chave: `ia:${p.id}` });
    else if ((p.ultimo_tempo_ms ?? 0) > lim) await criarAlerta(p.conta_id, { nivel: "atencao", tipo: "ia_lenta", titulo: `${p.nome} lenta`, detalhe: `Última resposta em ${(p.ultimo_tempo_ms / 1000).toFixed(1)} s.`, chave: `ia:${p.id}` });
    else await resolverAlerta(p.conta_id, `ia:${p.id}`);
  }
  return "ok";
}

/** Encerra conversas inativas há X horas e grava o resumo final. Nova mensagem reabre no modo padrão. */
async function encerrarInativas() {
  const rs = await q<any>(
    `UPDATE conversas cv SET estado = 'encerrada' FROM contas c
      WHERE c.id = cv.conta_id AND cv.estado = 'aberta' AND cv.ultima_mensagem_em < now() - make_interval(hours => COALESCE((c.config->>'inatividadeHoras')::int, 24))
        AND NOT EXISTS (SELECT 1 FROM retornos r WHERE r.conversa_id = cv.id AND r.status = 'agendado')
      RETURNING cv.id, cv.conta_id`);
  for (const r of rs) { await evento(r.conta_id, r.id, "Conversa encerrada por inatividade."); await emitirConversa(r.id); }
  return `encerradas:${rs.length}`;
}

/** Retenção configurável (LGPD): apaga mídias e mensagens além do prazo definido na conta. */
async function limpeza() {
  await q(`DELETE FROM mensagens m USING contas c WHERE c.id = m.conta_id AND (c.config->>'retencaoDias') IS NOT NULL AND m.criado_em < now() - make_interval(days => (c.config->>'retencaoDias')::int)`);
  await q("DELETE FROM uso_ia WHERE criado_em < now() - interval '400 days'");
  return "ok";
}
