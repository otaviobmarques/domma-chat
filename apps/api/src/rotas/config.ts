import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auditar, q, q1 } from "@domma/db";
import { configConta, enfileirarProcessamento, guardarArquivo, inserirMensagem, lerArquivo, obterConversa, publicar, urlAssinada, validarUrl } from "@domma/core";
import { indexarDocumento, testarProvedor, PERSONALIDADES } from "@domma/ia";
import { cifrar, cifrarJson, decifrar, decifrarJson, mascararChave, normalizarTelefone, tokenAleatorio } from "@domma/shared";
import { AdminEvolution, nomeInstancia } from "@domma/whatsapp";
import { autenticar, exigirPerfil, naoEncontrado, ErroHttp } from "../app.ts";
import { receberMensagem } from "../ingestao.ts";
import { extrairTexto } from "../extrair-texto.ts";
import { conferirLimite } from "./plataforma.ts";

const admin = exigirPerfil("admin");
const gestor = exigirPerfil("admin", "supervisor");

export async function rotasConfig(app: FastifyInstance) {
  // Arquivos assinados (áudio, imagem, materiais). Sem login: a assinatura expira.
  app.get("/api/v1/arquivos", servirArquivo);
  app.get("/api/v1/arquivos/publico", servirArquivo);
  async function servirArquivo(req: any, reply: any) {
    const { k, e, s } = req.query as Record<string, string>;
    if (!k || !validarUrl(k, Number(e), s)) return reply.code(403).send();
    const m = await q1<any>("SELECT midia_mime FROM mensagens WHERE midia_url = $1 UNION ALL SELECT mime FROM materiais_ia WHERE arquivo = $1 LIMIT 1", [k]);
    return reply.type(m?.midia_mime ?? "application/octet-stream").header("Cache-Control", "private, max-age=3600").send(await lerArquivo(k));
  }

  app.register(async (r) => {
    r.addHook("preHandler", autenticar);

    // ---------- Conta e regras globais ----------
    r.get("/api/v1/conta", async (req) => {
      const c = await q1<any>("SELECT id, nome, plano, token_leads, config FROM contas WHERE id = $1", [req.usuario.contaId]);
      const cfg = await configConta(req.usuario.contaId);
      const leadsHoje = await q1<{ n: number }>("SELECT count(*)::int AS n FROM entradas_leads WHERE conta_id = $1 AND recebido_em::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date", [c.id]);
      return { ...c, config: cfg, token_leads: req.usuario.perfil === "admin" ? c.token_leads : mascararChave(c.token_leads), url_leads: `${process.env.API_URL ?? "http://localhost:3333"}/v1/leads/${c.id}`, leads_hoje: leadsHoje?.n ?? 0 };
    });
    r.patch("/api/v1/conta", { preHandler: admin }, async (req) => {
      const b = z.object({ nome: z.string().optional(), config: z.record(z.string(), z.any()).optional() }).parse(req.body);
      if (b.nome) await q("UPDATE contas SET nome = $2 WHERE id = $1", [req.usuario.contaId, b.nome]);
      if (b.config) await q("UPDATE contas SET config = config || $2::jsonb WHERE id = $1", [req.usuario.contaId, JSON.stringify(b.config)]);
      await auditar(req.usuario.contaId, "usuario", "conta:config", null as any, b, req.usuario.id);
      return configConta(req.usuario.contaId);
    });
    r.post("/api/v1/conta/token-leads", { preHandler: admin }, async (req) => {
      const t = tokenAleatorio("dmc_live_");
      await q("UPDATE contas SET token_leads = $2 WHERE id = $1", [req.usuario.contaId, t]);
      await auditar(req.usuario.contaId, "usuario", "conta:novo_token_leads", undefined, null, req.usuario.id);
      return { token_leads: t };
    });
    r.get("/api/v1/feriados", async (req) => q("SELECT to_char(dia,'YYYY-MM-DD') AS dia FROM feriados WHERE conta_id = $1 ORDER BY dia", [req.usuario.contaId]));
    r.put("/api/v1/feriados", { preHandler: admin }, async (req) => {
      const { dias } = z.object({ dias: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) }).parse(req.body);
      await q("DELETE FROM feriados WHERE conta_id = $1", [req.usuario.contaId]);
      for (const d of dias) await q("INSERT INTO feriados (conta_id, dia) VALUES ($1,$2) ON CONFLICT DO NOTHING", [req.usuario.contaId, d]);
      return { ok: true };
    });

    // ---------- Agente de IA ----------
    r.get("/api/v1/agente", async (req) => ({ agente: await q1("SELECT * FROM agentes_ia WHERE conta_id = $1", [req.usuario.contaId]), personalidades: PERSONALIDADES }));
    r.put("/api/v1/agente", { preHandler: admin }, async (req) => {
      const b = z.object({
        personalidade: z.enum(Object.keys(PERSONALIDADES) as [string, ...string[]]), nome: z.string().min(1).max(40), emojis: z.enum(["nenhum", "poucos", "moderado"]),
        tratamento: z.enum(["voce", "senhor"]), instrucoes: z.string().max(4000), modo_padrao: z.enum(["ia", "aprova"]), velocidade_escrita: z.enum(["rapida", "natural", "calma"]),
        regras: z.record(z.string(), z.any()).default({}), capacidades: z.record(z.string(), z.any()).default({}), classificacao: z.record(z.string(), z.any()).default({}), anti_loop: z.record(z.string(), z.any()).default({}),
      }).parse(req.body);
      const a = await q1(
        `INSERT INTO agentes_ia (conta_id, personalidade, nome, emojis, tratamento, instrucoes, modo_padrao, velocidade_escrita, regras, capacidades, classificacao, anti_loop)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (conta_id) DO UPDATE SET personalidade=$2, nome=$3, emojis=$4, tratamento=$5, instrucoes=$6, modo_padrao=$7, velocidade_escrita=$8, regras=$9, capacidades=$10, classificacao=$11, anti_loop=$12, atualizado_em=now()
         RETURNING *`,
        [req.usuario.contaId, b.personalidade, b.nome, b.emojis, b.tratamento, b.instrucoes, b.modo_padrao, b.velocidade_escrita, JSON.stringify(b.regras), JSON.stringify(b.capacidades), JSON.stringify(b.classificacao), JSON.stringify(b.anti_loop)]);
      await q("UPDATE conexoes SET modo_padrao = $2 WHERE conta_id = $1 AND modo_padrao <> 'humano'", [req.usuario.contaId, b.modo_padrao]);
      if (b.anti_loop && Object.keys(b.anti_loop).length) await q("UPDATE contas SET config = config || jsonb_build_object('antiLoop', $2::jsonb) WHERE id = $1", [req.usuario.contaId, JSON.stringify(b.anti_loop)]);
      await auditar(req.usuario.contaId, "usuario", "agente:salvar", undefined, { personalidade: b.personalidade, nome: b.nome }, req.usuario.id);
      return a;
    });

    // ---------- Provedores de IA (chave criptografada, nunca devolvida) ----------
    const semChave = (p: any) => ({ ...p, chave: undefined, chave_final: p.chave ? mascararChave(decifrar(p.chave)) : null });
    r.get("/api/v1/provedores-ia", async (req) => (await q("SELECT * FROM provedores_ia WHERE conta_id = $1 ORDER BY ordem", [req.usuario.contaId])).map(semChave));
    const Prov = z.object({ provedor: z.enum(["anthropic", "openai", "gemini", "compativel", "simulado"]), rotulo: z.string().optional(), modelo: z.string().min(1), endereco_api: z.string().url().nullish(), chave: z.string().optional(), ativo: z.boolean().default(true), tarefas: z.array(z.enum(["conversa", "transcricao", "imagem"])).default(["conversa", "transcricao", "imagem"]), limite_mensal: z.number().nullish() });
    r.post("/api/v1/provedores-ia", { preHandler: admin }, async (req) => {
      const b = Prov.parse(req.body);
      const ordem = (await q1<{ n: number }>("SELECT COALESCE(max(ordem)+1,0)::int AS n FROM provedores_ia WHERE conta_id = $1", [req.usuario.contaId]))!.n;
      const p = await q1("INSERT INTO provedores_ia (conta_id, provedor, rotulo, modelo, endereco_api, chave, ativo, tarefas, limite_mensal, ordem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [req.usuario.contaId, b.provedor, b.rotulo ?? null, b.modelo, b.endereco_api ?? null, b.chave ? cifrar(b.chave) : null, b.ativo, b.tarefas, b.limite_mensal ?? null, ordem]);
      await auditar(req.usuario.contaId, "usuario", "provedor:criar", (p as any).id, { provedor: b.provedor, modelo: b.modelo }, req.usuario.id);
      return semChave(p);
    });
    r.patch("/api/v1/provedores-ia/:id", { preHandler: admin }, async (req) => {
      const b = Prov.partial().parse(req.body);
      const atual = await q1<any>("SELECT * FROM provedores_ia WHERE id = $1 AND conta_id = $2", [(req.params as any).id, req.usuario.contaId]);
      if (!atual) throw naoEncontrado("provedor");
      const p = await q1(`UPDATE provedores_ia SET provedor = COALESCE($2, provedor), rotulo = COALESCE($3, rotulo), modelo = COALESCE($4, modelo), endereco_api = COALESCE($5, endereco_api),
                           chave = COALESCE($6, chave), ativo = COALESCE($7, ativo), tarefas = COALESCE($8, tarefas), limite_mensal = CASE WHEN $10 THEN $9 ELSE limite_mensal END WHERE id = $1 RETURNING *`,
        [atual.id, b.provedor ?? null, b.rotulo ?? null, b.modelo ?? null, b.endereco_api ?? null, b.chave ? cifrar(b.chave) : null, b.ativo ?? null, b.tarefas ?? null, b.limite_mensal ?? null, b.limite_mensal !== undefined]);
      await auditar(req.usuario.contaId, "usuario", "provedor:editar", atual.id, { ...b, chave: b.chave ? "(nova chave)" : undefined }, req.usuario.id);
      return semChave(p);
    });
    r.put("/api/v1/provedores-ia/ordem", { preHandler: admin }, async (req) => {
      const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body);
      for (const [i, id] of ids.entries()) await q("UPDATE provedores_ia SET ordem = $3 WHERE id = $1 AND conta_id = $2", [id, req.usuario.contaId, i]);
      return { ok: true };
    });
    r.delete("/api/v1/provedores-ia/:id", { preHandler: admin }, async (req) => { await q("DELETE FROM provedores_ia WHERE id = $1 AND conta_id = $2", [(req.params as any).id, req.usuario.contaId]); return { ok: true }; });
    r.post("/api/v1/provedores-ia/:id/testar", { preHandler: admin }, async (req) => {
      const p = await q1<any>("SELECT * FROM provedores_ia WHERE id = $1 AND conta_id = $2", [(req.params as any).id, req.usuario.contaId]);
      if (!p) throw naoEncontrado("provedor");
      const r2 = await testarProvedor({ id: p.id, provedor: p.provedor, modelo: p.modelo, chave: p.chave ? decifrar(p.chave) : null, enderecoApi: p.endereco_api });
      await q("UPDATE provedores_ia SET ultimo_tempo_ms = $2, ultimo_erro = $3, degradado_ate = CASE WHEN $4 THEN NULL ELSE degradado_ate END WHERE id = $1", [p.id, r2.ms, r2.erro ?? null, r2.ok]);
      return r2;
    });

    // ---------- Base de conhecimento ----------
    r.get("/api/v1/base-conhecimento", async (req) => q("SELECT id, tipo, titulo, origem, left(conteudo, 300) AS previa, length(conteudo) AS tamanho, atualizado_em FROM base_conhecimento WHERE conta_id = $1 ORDER BY atualizado_em DESC", [req.usuario.contaId]));
    r.post("/api/v1/base-conhecimento", { preHandler: gestor }, async (req) => {
      let tipo = "texto", titulo = "", conteudo = "", origem: string | null = null;
      if (req.isMultipart()) {
        const f = await req.file();
        if (!f) throw new ErroHttp(400, "envie um arquivo");
        const buf = await f.toBuffer();
        tipo = "arquivo"; titulo = (f.fields as any).titulo?.value || f.filename; origem = f.filename;
        conteudo = await extrairTexto(buf, f.mimetype, f.filename);
      } else {
        const b = z.object({ tipo: z.enum(["texto", "site"]), titulo: z.string().min(1), conteudo: z.string().optional(), url: z.string().url().optional() }).parse(req.body);
        tipo = b.tipo; titulo = b.titulo;
        if (b.tipo === "site") {
          origem = b.url!;
          const html = await (await fetch(b.url!)).text();
          conteudo = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
        } else conteudo = b.conteudo ?? "";
      }
      if (!conteudo.trim()) throw new ErroHttp(400, "não encontrei texto neste conteúdo");
      const d = await q1<any>("INSERT INTO base_conhecimento (conta_id, tipo, titulo, origem, conteudo) VALUES ($1,$2,$3,$4,$5) RETURNING id, tipo, titulo, origem", [req.usuario.contaId, tipo, titulo, origem, conteudo]);
      await indexarDocumento(req.usuario.contaId, d.id, conteudo);
      return d;
    });
    r.put("/api/v1/base-conhecimento/:id", { preHandler: gestor }, async (req) => {
      const b = z.object({ titulo: z.string().min(1), conteudo: z.string().min(1) }).parse(req.body);
      const d = await q1<any>("UPDATE base_conhecimento SET titulo = $3, conteudo = $4, atualizado_em = now() WHERE id = $1 AND conta_id = $2 RETURNING id", [(req.params as any).id, req.usuario.contaId, b.titulo, b.conteudo]);
      if (!d) throw naoEncontrado("documento");
      await indexarDocumento(req.usuario.contaId, d.id, b.conteudo);
      return { ok: true };
    });
    r.delete("/api/v1/base-conhecimento/:id", { preHandler: gestor }, async (req) => { await q("DELETE FROM base_conhecimento WHERE id = $1 AND conta_id = $2", [(req.params as any).id, req.usuario.contaId]); return { ok: true }; });

    // ---------- Materiais que a IA pode enviar ----------
    r.get("/api/v1/materiais", async (req) => (await q<any>(
      `SELECT m.*, (SELECT count(*)::int FROM mensagens x WHERE x.material_id = m.id) AS envios FROM materiais_ia m WHERE conta_id = $1 ORDER BY criado_em DESC`, [req.usuario.contaId]))
      .map((m) => ({ ...m, link: urlAssinada(m.arquivo) })));
    r.post("/api/v1/materiais", { preHandler: gestor }, async (req) => {
      const f = await req.file();
      if (!f) throw new ErroHttp(400, "envie o arquivo");
      const campos = Object.fromEntries(Object.entries(f.fields).map(([k, v]: any) => [k, v?.value]));
      const b = z.object({ titulo: z.string().min(2), quando_enviar: z.string().min(5), interesses: z.string().optional(), legenda: z.string().optional() }).parse(campos);
      const buf = await f.toBuffer();
      const chave = await guardarArquivo(req.usuario.contaId, buf, f.mimetype);
      const m = await q1("INSERT INTO materiais_ia (conta_id, titulo, quando_enviar, interesses, arquivo, mime, nome_arquivo, legenda) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [req.usuario.contaId, b.titulo, b.quando_enviar, (b.interesses ?? "").split(",").map((s) => s.trim()).filter(Boolean), chave, f.mimetype, f.filename, b.legenda || null]);
      await auditar(req.usuario.contaId, "usuario", "material:criar", (m as any).id, { titulo: b.titulo }, req.usuario.id);
      return m;
    });
    r.patch("/api/v1/materiais/:id", { preHandler: gestor }, async (req) => {
      const b = z.object({ titulo: z.string().optional(), quando_enviar: z.string().optional(), interesses: z.array(z.string()).optional(), legenda: z.string().nullable().optional(), ativo: z.boolean().optional() }).parse(req.body);
      return q1(`UPDATE materiais_ia SET titulo = COALESCE($3, titulo), quando_enviar = COALESCE($4, quando_enviar), interesses = COALESCE($5, interesses), legenda = CASE WHEN $7 THEN $6 ELSE legenda END, ativo = COALESCE($8, ativo) WHERE id = $1 AND conta_id = $2 RETURNING *`,
        [(req.params as any).id, req.usuario.contaId, b.titulo ?? null, b.quando_enviar ?? null, b.interesses ?? null, b.legenda ?? null, b.legenda !== undefined, b.ativo ?? null]);
    });
    r.delete("/api/v1/materiais/:id", { preHandler: gestor }, async (req) => { await q("DELETE FROM materiais_ia WHERE id = $1 AND conta_id = $2", [(req.params as any).id, req.usuario.contaId]); return { ok: true }; });

    // ---------- Conexões do WhatsApp ----------
    const semCred = (c: any) => ({ ...c, credenciais: undefined, segredo_webhook: undefined, webhook: c.tipo === "qr" ? `${process.env.API_URL ?? ""}/webhooks/evolution/${c.id}` : c.tipo === "oficial" ? `${process.env.API_URL ?? ""}/webhooks/meta` : null });
    r.get("/api/v1/conexoes", async (req) => (await q("SELECT * FROM conexoes WHERE conta_id = $1 ORDER BY criado_em", [req.usuario.contaId])).map(semCred));
    r.post("/api/v1/conexoes", { preHandler: admin }, async (req) => {
      const b = z.object({ tipo: z.enum(["oficial", "qr", "simulador"]), nome: z.string().min(1), numero: z.string().optional(), modo_padrao: z.enum(["ia", "aprova", "humano"]).default("ia"),
        token: z.string().optional(), phone_number_id: z.string().optional(), waba_id: z.string().optional(), app_secret: z.string().optional() }).parse(req.body);
      if (b.tipo !== "simulador") await conferirLimite(req.usuario.contaId, "numeros");
      let cred: any = null, status = "aguardando_qr";
      if (b.tipo === "oficial") {
        if (!b.token || !b.phone_number_id || !b.app_secret) throw new ErroHttp(400, "Informe token de sistema, phone_number_id e app_secret.");
        cred = { token: b.token, phone_number_id: b.phone_number_id, waba_id: b.waba_id, app_secret: b.app_secret };
        status = "conectada";
      }
      if (b.tipo === "simulador") status = "conectada";
      const c = await q1<any>("INSERT INTO conexoes (conta_id, tipo, nome, numero, status, modo_padrao, credenciais) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [req.usuario.contaId, b.tipo, b.nome, b.numero ?? null, status, b.modo_padrao, cred ? cifrarJson(cred) : null]);
      if (b.tipo === "qr") await iniciarQr(c).catch((e) => app.log.warn(e, "Evolution indisponível"));
      await auditar(req.usuario.contaId, "usuario", "conexao:criar", c.id, { tipo: b.tipo, nome: b.nome }, req.usuario.id);
      return semCred(await q1("SELECT * FROM conexoes WHERE id = $1", [c.id]));
    });
    r.post("/api/v1/conexoes/:id/qrcode", { preHandler: admin }, async (req) => {
      const c = await q1<any>("SELECT * FROM conexoes WHERE id = $1 AND conta_id = $2 AND tipo = 'qr'", [(req.params as any).id, req.usuario.contaId]);
      if (!c) throw naoEncontrado("conexão");
      return iniciarQr(c, (req.body as any)?.numero);
    });
    r.patch("/api/v1/conexoes/:id", { preHandler: admin }, async (req) => {
      const b = z.object({ nome: z.string().optional(), modo_padrao: z.enum(["ia", "aprova", "humano"]).optional() }).parse(req.body);
      return semCred(await q1("UPDATE conexoes SET nome = COALESCE($3, nome), modo_padrao = COALESCE($4, modo_padrao) WHERE id = $1 AND conta_id = $2 RETURNING *", [(req.params as any).id, req.usuario.contaId, b.nome ?? null, b.modo_padrao ?? null]));
    });
    r.post("/api/v1/conexoes/:id/desconectar", { preHandler: admin }, async (req) => {
      const c = await q1<any>("SELECT * FROM conexoes WHERE id = $1 AND conta_id = $2", [(req.params as any).id, req.usuario.contaId]);
      if (!c) throw naoEncontrado("conexão");
      if (c.tipo === "qr") await new AdminEvolution().desconectar(nomeInstancia(c)).catch(() => {});
      await q("UPDATE conexoes SET status = 'desconectada' WHERE id = $1", [c.id]);
      await publicar(c.conta_id, "conexao.estado", { id: c.id, status: "desconectada" });
      return { ok: true };
    });
    r.delete("/api/v1/conexoes/:id", { preHandler: admin }, async (req) => {
      const c = await q1<any>("SELECT * FROM conexoes WHERE id = $1 AND conta_id = $2", [(req.params as any).id, req.usuario.contaId]);
      if (!c) throw naoEncontrado("conexão");
      if (c.tipo === "qr") await new AdminEvolution().apagar(nomeInstancia(c)).catch(() => {});
      await q("DELETE FROM conexoes WHERE id = $1", [c.id]);
      return { ok: true };
    });

    // ---------- Simulador: escrever como se fosse o cliente ----------
    r.post("/api/v1/simulador/:conexaoId/mensagem", async (req) => {
      const c = await q1<any>("SELECT * FROM conexoes WHERE id = $1 AND conta_id = $2 AND tipo = 'simulador'", [(req.params as any).conexaoId, req.usuario.contaId]);
      if (!c) throw naoEncontrado("conexão simulador");
      const b = z.object({ telefone: z.string().min(8), nome: z.string().optional(), texto: z.string().optional(), audio: z.boolean().optional(), imagemBase64: z.string().optional(), mime: z.string().optional() }).parse(req.body);
      const id = "simcli-" + tokenAleatorio("", 9);
      await receberMensagem(c, {
        idExterno: id, telefone: normalizarTelefone(b.telefone), nome: b.nome, tipo: b.audio ? "audio" : b.imagemBase64 ? "imagem" : "texto", texto: b.texto,
        midia: b.audio ? { base64: Buffer.from("audio-simulado").toString("base64"), mime: "audio/ogg" } : b.imagemBase64 ? { base64: b.imagemBase64, mime: b.mime ?? "image/jpeg" } : undefined,
        timestamp: Date.now(), deMim: false, grupo: false,
      });
      const { conversa } = await obterConversa(c.conta_id, c, b.telefone);
      return { conversaId: conversa.id };
    });
    r.get("/api/v1/simulador/:conexaoId/conversa", async (req) => {
      const { telefone } = z.object({ telefone: z.string() }).parse(req.query);
      const conv = await q1<any>("SELECT cv.id, cv.modo FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id WHERE cv.conexao_id = $1 AND ct.telefone = $2 AND cv.conta_id = $3 ORDER BY cv.criado_em DESC LIMIT 1",
        [(req.params as any).conexaoId, normalizarTelefone(telefone), req.usuario.contaId]);
      if (!conv) return { conversa: null, mensagens: [] };
      const msgs = await q<any>("SELECT id, autor, tipo, conteudo, midia_url, midia_mime, leitura, status, criado_em FROM mensagens WHERE conversa_id = $1 AND autor IN ('cliente','ia','humano') AND status NOT IN ('cancelada','falhou') ORDER BY criado_em", [conv.id]);
      return { conversa: conv, mensagens: msgs.map((m) => (m.midia_url ? { ...m, midia_link: urlAssinada(m.midia_url) } : m)) };
    });

    // ---------- Equipe, filas e gateways ----------
    r.get("/api/v1/usuarios", async (req) => q(
      `SELECT u.id, u.nome, u.email, u.perfil, u.filas, u.cidades, u.status, (u.google_refresh_token IS NOT NULL) AS google_agenda_conectada,
              (SELECT count(*)::int FROM conversas c WHERE c.responsavel_id = u.id AND c.estado = 'aberta') AS conversas_abertas
         FROM usuarios u WHERE u.conta_id = $1 ORDER BY u.nome`, [req.usuario.contaId]));
    r.post("/api/v1/usuarios", { preHandler: admin }, async (req) => {
      const b = z.object({ nome: z.string().min(2), email: z.string().email(), senha: z.string().min(8), perfil: z.enum(["admin", "supervisor", "atendente"]), filas: z.array(z.string()).default([]), cidades: z.array(z.string()).default([]) }).parse(req.body);
      await conferirLimite(req.usuario.contaId, "usuarios");
      const u = await q1<any>("INSERT INTO usuarios (conta_id, nome, email, senha_hash, perfil, filas, cidades) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, nome, email, perfil, filas, cidades, status",
        [req.usuario.contaId, b.nome, b.email.toLowerCase(), await bcrypt.hash(b.senha, 10), b.perfil, b.filas, b.cidades]).catch((e) => { if (e.code === "23505") throw new ErroHttp(409, "e-mail já cadastrado"); throw e; });
      await auditar(req.usuario.contaId, "usuario", "usuario:criar", u.id, { email: b.email, perfil: b.perfil }, req.usuario.id);
      return u;
    });
    r.patch("/api/v1/usuarios/:id", { preHandler: admin }, async (req) => {
      const b = z.object({ nome: z.string().optional(), perfil: z.enum(["admin", "supervisor", "atendente"]).optional(), filas: z.array(z.string()).optional(), cidades: z.array(z.string()).optional(), status: z.enum(["online", "ausente", "offline"]).optional(), senha: z.string().min(8).optional() }).parse(req.body);
      return q1(`UPDATE usuarios SET nome = COALESCE($3, nome), perfil = COALESCE($4, perfil), filas = COALESCE($5, filas), cidades = COALESCE($6, cidades), status = COALESCE($7, status), senha_hash = COALESCE($8, senha_hash) WHERE id = $1 AND conta_id = $2 RETURNING id, nome, email, perfil, filas, cidades, status`,
        [(req.params as any).id, req.usuario.contaId, b.nome ?? null, b.perfil ?? null, b.filas ?? null, b.cidades ?? null, b.status ?? null, b.senha ? await bcrypt.hash(b.senha, 10) : null]);
    });
    r.delete("/api/v1/usuarios/:id", { preHandler: admin }, async (req) => {
      if ((req.params as any).id === req.usuario.id) throw new ErroHttp(400, "você não pode excluir a si mesmo");
      await q("DELETE FROM usuarios WHERE id = $1 AND conta_id = $2", [(req.params as any).id, req.usuario.contaId]); return { ok: true };
    });
    r.get("/api/v1/filas", async (req) => q("SELECT * FROM filas WHERE conta_id = $1 ORDER BY nome", [req.usuario.contaId]));
    r.post("/api/v1/filas", { preHandler: admin }, async (req) => q1("INSERT INTO filas (conta_id, nome) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *", [req.usuario.contaId, z.object({ nome: z.string().min(1) }).parse(req.body).nome]));
    r.delete("/api/v1/filas/:id", { preHandler: admin }, async (req) => { await q("DELETE FROM filas WHERE id = $1 AND conta_id = $2", [(req.params as any).id, req.usuario.contaId]); return { ok: true }; });

    r.get("/api/v1/gateways", async (req) => (await q<any>("SELECT * FROM gateways WHERE conta_id = $1", [req.usuario.contaId])).map((g) => ({ ...g, chave: undefined, segredo_webhook: req.usuario.perfil === "admin" ? g.segredo_webhook : undefined, chave_final: g.chave ? mascararChave(decifrar(g.chave)) : null, webhook: `${process.env.API_URL ?? ""}/webhooks/${g.tipo}/${g.conta_id}` })));
    r.put("/api/v1/gateways/:tipo", { preHandler: admin }, async (req) => {
      const tipo = z.enum(["asaas", "mercadopago", "stripe"]).parse((req.params as any).tipo);
      const b = z.object({ ativo: z.boolean(), padrao: z.boolean().default(false), ambiente: z.enum(["teste", "producao"]), formas: z.array(z.enum(["pix", "boleto", "cartao"])), chave: z.string().optional(), segredo_webhook: z.string().optional() }).parse(req.body);
      if (b.padrao) await q("UPDATE gateways SET padrao = false WHERE conta_id = $1", [req.usuario.contaId]);
      await q(`INSERT INTO gateways (conta_id, tipo, ativo, padrao, ambiente, formas, chave) VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT (conta_id, tipo) DO UPDATE SET ativo=$3, padrao=$4, ambiente=$5, formas=$6, chave=COALESCE($7, gateways.chave)`,
        [req.usuario.contaId, tipo, b.ativo, b.padrao, b.ambiente, b.formas, b.chave ? cifrar(b.chave) : null]);
      if (b.segredo_webhook) await q("UPDATE gateways SET segredo_webhook = $3 WHERE conta_id = $1 AND tipo = $2", [req.usuario.contaId, tipo, b.segredo_webhook]);
      await auditar(req.usuario.contaId, "usuario", "gateway:salvar", tipo, { ativo: b.ativo, ambiente: b.ambiente }, req.usuario.id);
      return { ok: true };
    });

    r.get("/api/v1/auditoria", { preHandler: gestor }, async (req) => q("SELECT e.*, u.nome AS usuario FROM eventos_auditoria e LEFT JOIN usuarios u ON u.id = e.usuario_id WHERE e.conta_id = $1 ORDER BY e.criado_em DESC LIMIT 300", [req.usuario.contaId]));
    r.get("/api/v1/alertas", async (req) => q("SELECT * FROM alertas WHERE conta_id = $1 AND resolvido_em IS NULL ORDER BY CASE nivel WHEN 'urgente' THEN 0 WHEN 'atencao' THEN 1 ELSE 2 END, criado_em DESC LIMIT 50", [req.usuario.contaId]));
    r.post("/api/v1/alertas/:id/resolver", async (req) => { await q("UPDATE alertas SET resolvido_em = now() WHERE id = $1 AND conta_id = $2", [(req.params as any).id, req.usuario.contaId]); return { ok: true }; });
  });

  async function iniciarQr(c: any, numero?: string) {
    const adm = new AdminEvolution();
    let cred = decifrarJson<any>(c.credenciais);
    if (!cred?.chave_instancia) {
      const inst = await adm.criarInstancia(nomeInstancia(c));
      cred = { chave_instancia: inst.chave };
      await q("UPDATE conexoes SET credenciais = $2 WHERE id = $1", [c.id, cifrarJson(cred)]);
      await adm.configurarWebhook(nomeInstancia(c), `${process.env.API_URL}/webhooks/evolution/${c.id}`, c.segredo_webhook);
    }
    const r = await adm.qrcode(nomeInstancia(c), numero);
    await q("UPDATE conexoes SET qrcode = $2, status = 'aguardando_qr' WHERE id = $1", [c.id, r.base64 ?? null]);
    await publicar(c.conta_id, "qrcode.atualizado", { id: c.id, qrcode: r.base64, codigo: r.pairingCode });
    return { qrcode: r.base64, codigo_pareamento: r.pairingCode };
  }
  void inserirMensagem; void enfileirarProcessamento;
}
