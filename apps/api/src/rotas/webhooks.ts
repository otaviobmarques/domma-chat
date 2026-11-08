import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q, q1 } from "@domma/db";
import { aplicarEtiquetas, criarAlerta, enfileirarProcessamento, filas, inserirMensagem, obterConversa, configConta, emitirConversa, resolverAlerta } from "@domma/core";
import { criarGateway } from "@domma/pagamentos";
import { decifrar, decifrarJson, FONTES, iguaisSeguro, normalizarTelefone } from "@domma/shared";
import { lerWebhookEvolution, lerWebhookMeta, validarAssinaturaMeta } from "@domma/whatsapp";
import { receberEventos } from "../ingestao.ts";

/** Entradas externas: sem login, validadas por assinatura. Respondem rápido e enfileiram (seção 6.1). */
export async function rotasWebhooks(app: FastifyInstance) {
  // Meta — verificação
  app.get("/webhooks/meta", async (req, reply) => {
    const qy = req.query as Record<string, string>;
    if (qy["hub.mode"] === "subscribe" && qy["hub.verify_token"] && iguaisSeguro(qy["hub.verify_token"], process.env.META_VERIFY_TOKEN ?? "")) return reply.type("text/plain").send(qy["hub.challenge"]);
    return reply.code(403).send();
  });

  // Meta — eventos
  app.post("/webhooks/meta", async (req, reply) => {
    const lotes = lerWebhookMeta(req.body);
    for (const lote of lotes) {
      const conexoes = await q<any>("SELECT * FROM conexoes WHERE tipo = 'oficial'");
      const cx = conexoes.find((c) => decifrarJson<any>(c.credenciais)?.phone_number_id === lote.phoneNumberId);
      if (!cx) continue;
      const appSecret = decifrarJson<any>(cx.credenciais)?.app_secret ?? process.env.META_APP_SECRET ?? "";
      if (!validarAssinaturaMeta(req.rawBody ?? Buffer.alloc(0), req.headers["x-hub-signature-256"] as string | undefined, appSecret)) return reply.code(401).send();
      await receberEventos(cx, lote.eventos);
    }
    return reply.code(200).send({ ok: true });
  });

  // Evolution (QR Code), uma URL por conexão, com cabeçalho secreto.
  app.post("/webhooks/evolution/:conexaoId", async (req, reply) => {
    const cx = await q1<any>("SELECT * FROM conexoes WHERE id = $1 AND tipo = 'qr'", [(req.params as any).conexaoId]);
    if (!cx || !iguaisSeguro(String(req.headers["x-domma-signature"] ?? ""), cx.segredo_webhook)) return reply.code(401).send();
    await receberEventos(cx, lerWebhookEvolution(req.body));
    return { ok: true };
  });

  // Gateways de pagamento
  app.post("/webhooks/:gateway(asaas|mercadopago|stripe)/:contaId", async (req, reply) => {
    const { gateway, contaId } = req.params as any;
    const g = await q1<any>("SELECT * FROM gateways WHERE conta_id = $1 AND tipo = $2", [contaId, gateway]);
    if (!g) return reply.code(404).send();
    let conf;
    try {
      conf = criarGateway(g.tipo, g.chave ? decifrar(g.chave) : "", g.ambiente).validarWebhook(req.headers as any, req.rawBody ?? Buffer.alloc(0), g.segredo_webhook);
    } catch { return reply.code(401).send(); }
    if (!conf) return { ok: true };
    if (gateway === "mercadopago") {
      const gw = criarGateway(g.tipo, decifrar(g.chave), g.ambiente);
      conf.pago = (await gw.consultar(conf.idExterno)).pago;
    }
    if (!conf.pago) return { ok: true };
    // Idempotente pelo id do pagamento.
    const cob = await q1<any>("UPDATE cobrancas SET status = 'paga', pago_em = now() WHERE conta_id = $1 AND (id_externo = $2 OR id::text = $3) AND status <> 'paga' RETURNING *", [contaId, conf.idExterno, conf.referencia ?? ""]);
    if (cob) {
      await aplicarEtiquetas(cob.conversa_id, ["Pagou"]);
      await inserirMensagem({ contaId, conversaId: cob.conversa_id, autor: "sistema", tipo: "evento", conteudo: `Pagamento confirmado: R$ ${Number(cob.valor).toFixed(2)}` });
      await filas.envio.add("texto", { contaId, conversaId: cob.conversa_id, tipo: "texto", autor: "ia", texto: "Pagamento confirmado! Muito obrigada 🙏 Qualquer coisa, estou por aqui." });
      await emitirConversa(cob.conversa_id);
    }
    return { ok: true };
  });

  /** Entrada de leads do Goalfy / Zapier / Make / n8n (seção 2.12). */
  app.post("/v1/leads/:contaId", async (req, reply) => {
    const contaId = (req.params as any).contaId;
    const auth = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const conta = await q1<any>("SELECT * FROM contas WHERE id::text = $1", [contaId]);
    if (!conta || !auth || !iguaisSeguro(auth, conta.token_leads)) return reply.code(401).send({ erro: "token inválido" });
    const b = z.object({
      nome: z.string().optional(), telefone: z.string().min(8), fonte: z.enum(FONTES).default("outro"), campanha: z.string().optional(),
      utm: z.record(z.string(), z.string()).optional(), interesse: z.string().optional(), id_externo: z.string().optional(),
      contatar: z.boolean().default(true), cidade: z.string().optional(), conector: z.string().default("goalfy"),
    }).parse(req.body);

    if (b.id_externo) {
      const dup = await q1<any>("SELECT e.contato_id, (SELECT id FROM conversas WHERE contato_id = e.contato_id ORDER BY criado_em DESC LIMIT 1) AS conversa_id FROM entradas_leads e WHERE conta_id = $1 AND id_externo = $2", [contaId, b.id_externo]);
      if (dup) return reply.code(202).send({ contato_id: dup.contato_id, conversa_id: dup.conversa_id, duplicado: true });
    }
    const cx = await q1<any>("SELECT * FROM conexoes WHERE conta_id = $1 AND status = 'conectada' ORDER BY (tipo = 'oficial') DESC, criado_em LIMIT 1", [contaId])
      ?? await q1<any>("SELECT * FROM conexoes WHERE conta_id = $1 ORDER BY criado_em LIMIT 1", [contaId]);
    if (!cx) return reply.code(409).send({ erro: "nenhuma conexão de WhatsApp cadastrada" });
    const { contato, conversa } = await obterConversa(contaId, cx, normalizarTelefone(b.telefone), b.nome);
    await q(`UPDATE contatos SET nome = COALESCE($2, nome), cidade = COALESCE($3, cidade), fonte_ultima = $4, fonte_primeira = CASE WHEN fonte_primeira IN ('organico') OR fonte_primeira IS NULL THEN $4 ELSE fonte_primeira END,
               campanha = COALESCE($5, campanha), utms = COALESCE($6, utms), interesse = COALESCE($7, interesse), id_externo_crm = COALESCE($8, id_externo_crm), entrou_em = now() WHERE id = $1`,
      [contato.id, b.nome ?? null, b.cidade ?? null, b.fonte, b.campanha ?? null, b.utm ? JSON.stringify(b.utm) : null, b.interesse ?? null, b.id_externo ?? null]);
    await q("INSERT INTO entradas_leads (conta_id, conector, payload, id_externo, contato_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [contaId, b.conector, JSON.stringify(b), b.id_externo ?? null, contato.id]);
    await inserirMensagem({ contaId, conversaId: conversa.id, autor: "sistema", tipo: "evento", conteudo: `Lead recebido do ${b.conector}: ${b.fonte}${b.campanha ? " · " + b.campanha : ""}` });
    if (b.contatar && !contato.opt_out) {
      const cfg = await configConta(contaId);
      const atraso = Math.min(cfg.contatoLeadMin, 5) * 60000 * (process.env.NODE_ENV === "production" ? 0.2 : 0.01);
      if (cx.tipo === "oficial") {
        // API Oficial: o primeiro contato é um modelo aprovado.
        await filas.envio.add("modelo", { contaId, conversaId: conversa.id, tipo: "modelo", autor: "ia", texto: `(modelo ${cfg.modelos.primeiroContato})`, modelo: { nome: cfg.modelos.primeiroContato ?? "primeiro_contato", parametros: [String(b.nome ?? "").split(" ")[0] || "tudo bem"] } }, { delay: atraso });
      } else await filas.ia.add("lead", { conversaId: conversa.id, gatilho: "lead" }, { delay: atraso });
    }
    await resolverAlerta(contaId, "goalfy_parado");
    await emitirConversa(conversa.id);
    return reply.code(202).send({ contato_id: contato.id, conversa_id: conversa.id, duplicado: false });
  });

  void enfileirarProcessamento; void criarAlerta;
}
