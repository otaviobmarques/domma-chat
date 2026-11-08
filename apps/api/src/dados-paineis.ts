import { q, q1 } from "@domma/db";

const HOJE = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
const DIA = (col: string) => `(${col} AT TIME ZONE 'America/Sao_Paulo')::date`;

/** Dashboard ao vivo (seção 2.1). Atendente vê só a própria fila. */
export async function dadosDashboard(contaId: string, usuario?: { id: string; perfil: string }) {
  if (usuario && !/^[0-9a-f-]{36}$/.test(usuario.id)) throw new Error("usuário inválido");
  const escopo = usuario?.perfil === "atendente" ? `AND (cv.responsavel_id = '${usuario.id}' OR cv.responsavel_id IS NULL)` : "";
  const ind = await q1<any>(`
    SELECT count(*) FILTER (WHERE cv.estado = 'aberta')::int AS abertas,
           count(*) FILTER (WHERE cv.estado = 'aberta' AND cv.modo = 'ia')::int AS ia,
           count(*) FILTER (WHERE cv.estado = 'aberta' AND cv.modo = 'humano' AND cv.esperando_humano_desde IS NOT NULL)::int AS esperando,
           COALESCE(max(extract(epoch FROM now() - cv.esperando_humano_desde)/60) FILTER (WHERE cv.modo = 'humano' AND cv.estado = 'aberta'), 0)::int AS maior_espera_min
      FROM conversas cv WHERE cv.conta_id = $1 ${escopo}`, [contaId]);
  const hoje = await q1<any>(`
    SELECT count(DISTINCT cv.id)::int AS conversas_hoje,
           count(DISTINCT cv.id) FILTER (WHERE NOT EXISTS (SELECT 1 FROM mensagens m WHERE m.conversa_id = cv.id AND m.autor = 'humano'))::int AS resolvidas_ia
      FROM conversas cv WHERE cv.conta_id = $1 AND ${DIA("cv.ultima_mensagem_em")} = ${HOJE} ${escopo}`, [contaId]);
  const vendas = await q1<any>(`SELECT COALESCE(sum(valor),0)::float AS total, count(*)::int AS n FROM cobrancas WHERE conta_id = $1 AND status = 'paga' AND ${DIA("pago_em")} = ${HOJE}`, [contaId]);
  const reunioes = await q<any>(`SELECT r.inicio, r.formato, ct.nome AS contato, u.nome AS vendedor, r.conversa_id FROM reunioes r JOIN conversas cv ON cv.id = r.conversa_id JOIN contatos ct ON ct.id = cv.contato_id LEFT JOIN usuarios u ON u.id = r.vendedor_id
                                 WHERE r.conta_id = $1 AND ${DIA("r.inicio")} = ${HOJE} ORDER BY r.inicio`, [contaId]);
  const pagamentos = await q<any>(`SELECT c.valor, c.status, c.descricao, c.forma, ct.nome AS contato, g.tipo AS gateway FROM cobrancas c JOIN conversas cv ON cv.id = c.conversa_id JOIN contatos ct ON ct.id = cv.contato_id LEFT JOIN gateways g ON g.id = c.gateway_id
                                   WHERE c.conta_id = $1 AND ${DIA("c.criado_em")} = ${HOJE} ORDER BY c.criado_em DESC LIMIT 8`, [contaId]);
  const alertas = await q<any>(`SELECT * FROM alertas WHERE conta_id = $1 AND resolvido_em IS NULL ORDER BY CASE nivel WHEN 'urgente' THEN 0 WHEN 'atencao' THEN 1 ELSE 2 END, criado_em DESC LIMIT 8`, [contaId]);
  const esperandoHumano = await q<any>(`SELECT cv.id, ct.nome, cv.motivo_transferencia, extract(epoch FROM now() - cv.esperando_humano_desde)::int / 60 AS min
                                          FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id WHERE cv.conta_id = $1 AND cv.modo = 'humano' AND cv.estado = 'aberta' AND cv.esperando_humano_desde IS NOT NULL ${escopo}
                                          ORDER BY cv.esperando_humano_desde LIMIT 8`, [contaId]);
  const leadsQuentes = await q<any>(`SELECT cv.id, ct.nome, ct.nota, ct.interesse, ct.fonte_ultima, ct.motivo_classificacao FROM contatos ct JOIN conversas cv ON cv.contato_id = ct.id AND cv.estado = 'aberta'
                                       WHERE ct.conta_id = $1 AND ct.temperatura = 'quente' ${escopo} ORDER BY ct.nota DESC NULLS LAST LIMIT 6`, [contaId]);
  const retornos = await q<any>(`SELECT r.quando, r.rotulo, r.executor, ct.nome, cv.id AS conversa_id, cv.resumo_ia FROM retornos r JOIN conversas cv ON cv.id = r.conversa_id JOIN contatos ct ON ct.id = cv.contato_id
                                   WHERE r.conta_id = $1 AND r.status = 'agendado' AND ${DIA("r.quando")} = ${HOJE} ORDER BY r.quando`, [contaId]);
  const fontes = await q<any>(`SELECT COALESCE(ct.fonte_ultima,'organico') AS fonte, count(*)::int AS contatos, count(*) FILTER (WHERE ct.temperatura = 'quente')::int AS quentes
                                 FROM contatos ct WHERE ct.conta_id = $1 AND ${DIA("ct.entrou_em")} = ${HOJE} GROUP BY 1 ORDER BY 2 DESC`, [contaId]);
  const assuntos = await q<any>(`SELECT anti_loop->>'assunto' AS assunto, count(*)::int AS n FROM conversas WHERE conta_id = $1 AND ${DIA("ultima_mensagem_em")} = ${HOJE} AND anti_loop ? 'assunto' GROUP BY 1 ORDER BY 2 DESC LIMIT 5`, [contaId]);
  const humor = await q1<any>(`SELECT count(*) FILTER (WHERE sentimento = 'positivo')::int AS positivo, count(*) FILTER (WHERE sentimento = 'neutro')::int AS neutro, count(*) FILTER (WHERE sentimento = 'negativo')::int AS negativo
                                 FROM conversas WHERE conta_id = $1 AND ${DIA("ultima_mensagem_em")} = ${HOJE}`, [contaId]);
  const conexoes = await q<any>("SELECT id, nome, tipo, numero, status FROM conexoes WHERE conta_id = $1 ORDER BY criado_em", [contaId]);
  const provedores = await q<any>("SELECT id, COALESCE(rotulo, provedor) AS nome, provedor, modelo, ordem, ativo, ultimo_tempo_ms, ultimo_erro, degradado_ate, gasto_mes, limite_mensal FROM provedores_ia WHERE conta_id = $1 ORDER BY ordem", [contaId]);
  const gateways = await q<any>("SELECT tipo, ativo, padrao, ambiente FROM gateways WHERE conta_id = $1 AND ativo", [contaId]);
  const vendedoresAgenda = await q1<{ n: number }>("SELECT count(*)::int AS n FROM usuarios WHERE conta_id = $1 AND google_refresh_token IS NOT NULL", [contaId]);
  return {
    gerado_em: new Date().toISOString(),
    indicadores: { ...ind, ...hoje, pct_ia: hoje?.conversas_hoje ? Math.round((100 * hoje.resolvidas_ia) / hoje.conversas_hoje) : 0, vendas_hoje: vendas?.total ?? 0, pagamentos_hoje: vendas?.n ?? 0, reunioes_hoje: reunioes.length },
    alertas, esperandoHumano, leadsQuentes, reunioes, pagamentos, retornos, fontes, assuntos, humor,
    saude: { conexoes, provedores, gateways, agenda: vendedoresAgenda?.n ?? 0 },
  };
}

/** Relatórios por período (seção 2.6). */
export async function dadosRelatorio(contaId: string, de: Date, ate: Date) {
  const p = [contaId, de, ate];
  const resumo = await q1<any>(`
    SELECT count(*)::int AS conversas,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM mensagens m WHERE m.conversa_id = cv.id AND m.autor = 'humano'))::int AS so_ia
      FROM conversas cv WHERE cv.conta_id = $1 AND cv.ultima_mensagem_em BETWEEN $2 AND $3`, p);
  const primeira = await q1<any>(`
    WITH pares AS (
      SELECT m.conversa_id, m.criado_em AS t_cli,
             (SELECT min(r.criado_em) FROM mensagens r WHERE r.conversa_id = m.conversa_id AND r.autor = 'ia' AND r.criado_em > m.criado_em) AS t_ia,
             (SELECT min(r.criado_em) FROM mensagens r WHERE r.conversa_id = m.conversa_id AND r.autor = 'humano' AND r.criado_em > m.criado_em) AS t_hum
        FROM mensagens m WHERE m.conta_id = $1 AND m.autor = 'cliente' AND m.criado_em BETWEEN $2 AND $3)
    SELECT COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t_ia - t_cli)), 0)::float AS ia_s,
           COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t_hum - t_cli)), 0)::float AS humano_s FROM pares`, p);
  const vendas = await q1<any>("SELECT COALESCE(sum(valor),0)::float AS total, count(*)::int AS n FROM cobrancas WHERE conta_id = $1 AND status = 'paga' AND pago_em BETWEEN $2 AND $3", p);
  const reunioes = await q1<any>("SELECT count(*)::int AS n FROM reunioes WHERE conta_id = $1 AND criado_em BETWEEN $2 AND $3", p);
  const custoIA = await q<any>(`SELECT COALESCE(pr.rotulo, pr.provedor) AS provedor, COALESCE(sum(u.custo),0)::float AS custo, count(*) FILTER (WHERE u.sucesso)::int AS chamadas, count(*) FILTER (WHERE NOT u.sucesso)::int AS falhas
                                  FROM uso_ia u LEFT JOIN provedores_ia pr ON pr.id = u.provedor_id WHERE u.conta_id = $1 AND u.criado_em BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC`, p);
  const porDia = await q<any>(`
    SELECT to_char(d, 'DD/MM') AS dia,
           (SELECT count(DISTINCT m.conversa_id) FROM mensagens m WHERE m.conta_id = $1 AND m.autor = 'ia' AND ${DIA("m.criado_em")} = d)::int AS ia,
           (SELECT count(DISTINCT m.conversa_id) FROM mensagens m WHERE m.conta_id = $1 AND m.autor = 'humano' AND ${DIA("m.criado_em")} = d)::int AS humano
      FROM generate_series((($2::timestamptz) AT TIME ZONE 'America/Sao_Paulo')::date, (($3::timestamptz) AT TIME ZONE 'America/Sao_Paulo')::date, interval '1 day') AS g(d0), LATERAL (SELECT g.d0::date AS d) x
     ORDER BY d`, p);
  const campanhas = await q<any>(`SELECT c.nome, count(e.*)::int AS enviadas, count(e.lido_em)::int AS lidas, count(e.respondeu_em)::int AS responderam, count(*) FILTER (WHERE e.status = 'fechou')::int AS fecharam
                                    FROM campanhas c LEFT JOIN campanha_envios e ON e.campanha_id = c.id WHERE c.conta_id = $1 AND $2::timestamptz IS NOT NULL AND c.criado_em <= $3 GROUP BY c.id ORDER BY c.criado_em DESC LIMIT 10`, p);
  const pessoas = await q<any>(`
    SELECT u.nome, count(DISTINCT m.conversa_id)::int AS atendidas,
           (SELECT count(*)::int FROM reunioes r WHERE r.vendedor_id = u.id AND r.criado_em BETWEEN $2 AND $3) AS reunioes,
           (SELECT COALESCE(sum(c.valor),0)::float FROM cobrancas c JOIN conversas cv ON cv.id = c.conversa_id WHERE cv.responsavel_id = u.id AND c.status = 'paga' AND c.pago_em BETWEEN $2 AND $3) AS vendas
      FROM usuarios u LEFT JOIN mensagens m ON m.autor_id = u.id AND m.autor = 'humano' AND m.criado_em BETWEEN $2 AND $3
     WHERE u.conta_id = $1 GROUP BY u.id ORDER BY 2 DESC`, p);
  const iaPessoa = await q1<any>(`SELECT count(DISTINCT m.conversa_id)::int AS atendidas FROM mensagens m WHERE m.conta_id = $1 AND m.autor = 'ia' AND m.criado_em BETWEEN $2 AND $3`, p);
  const fontes = await q<any>(`
    SELECT COALESCE(ct.fonte_ultima,'organico') AS fonte, count(DISTINCT ct.id)::int AS contatos, count(DISTINCT ct.id) FILTER (WHERE ct.temperatura = 'quente')::int AS quentes,
           count(DISTINCT ct.id) FILTER (WHERE EXISTS (SELECT 1 FROM cobrancas c JOIN conversas cv ON cv.id = c.conversa_id WHERE cv.contato_id = ct.id AND c.status = 'paga'))::int AS fechamentos
      FROM contatos ct WHERE ct.conta_id = $1 AND ct.entrou_em BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC`, p);
  const campanhasFonte = await q<any>(`SELECT COALESCE(ct.campanha,'(sem campanha)') AS campanha, ct.fonte_ultima AS fonte, count(*)::int AS contatos, count(*) FILTER (WHERE ct.temperatura = 'quente')::int AS quentes
                                         FROM contatos ct WHERE ct.conta_id = $1 AND ct.entrou_em BETWEEN $2 AND $3 GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`, p);
  const custoTotalIA = custoIA.reduce((s, c) => s + c.custo, 0);
  return {
    periodo: { de: de.toISOString(), ate: ate.toISOString() },
    resumo: { conversas: resumo?.conversas ?? 0, pct_so_ia: resumo?.conversas ? Math.round((100 * resumo.so_ia) / resumo.conversas) : 0, primeira_resposta_ia_s: Math.round(primeira?.ia_s ?? 0), primeira_resposta_humano_s: Math.round(primeira?.humano_s ?? 0), reunioes: reunioes?.n ?? 0, vendas_total: vendas?.total ?? 0, vendas_n: vendas?.n ?? 0, custo_ia: custoTotalIA, custo_medio_conversa: resumo?.conversas ? custoTotalIA / resumo.conversas : 0 },
    porDia, campanhas, pessoas: [{ nome: "IA", atendidas: iaPessoa?.atendidas ?? 0, reunioes: 0, vendas: 0 }, ...pessoas], custos: custoIA,
    fontes: fontes.map((f) => ({ ...f, taxa: f.contatos ? Math.round((100 * f.fechamentos) / f.contatos) : 0 })), campanhasFonte,
  };
}

export function periodo(qs: { periodo?: string; de?: string; ate?: string }) {
  const ate = qs.ate ? new Date(qs.ate + "T23:59:59-03:00") : new Date();
  const dias = qs.periodo === "hoje" ? 0 : qs.periodo === "30d" ? 29 : qs.periodo === "7d" || !qs.periodo ? 6 : 6;
  const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const de = qs.de ? new Date(qs.de + "T00:00:00-03:00") : new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - dias, 3));
  return { de, ate };
}
