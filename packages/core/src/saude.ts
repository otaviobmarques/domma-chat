import { promises as dns } from "node:dns";
import tls from "node:tls";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { q, q1 } from "@domma/db";
import { filas, NOMES } from "./filas.ts";
import { criarAlerta, resolverAlerta } from "./notificacoes.ts";
import { redis } from "./redis.ts";

/**
 * Saúde do sistema: mede cada peça da operação (infraestrutura, domínios, DNS, WhatsApp, IA,
 * integrações e as páginas de status dos fornecedores). Roda sob demanda e a cada 5 minutos
 * na fila de manutenção, que abre e fecha alertas sozinha.
 */
export type Situacao = "ok" | "atencao" | "falha" | "inativo";
export interface Checagem { id: string; grupo: string; nome: string; status: Situacao; detalhe: string; ms?: number; link?: string }
export interface RelatorioSaude { gerado_em: string; geral: Situacao; checagens: Checagem[] }

export const GRUPOS = ["Infraestrutura", "Domínios e DNS", "WhatsApp", "Inteligência Artificial", "Integrações", "Fornecedores"] as const;
const INICIO = Date.now();

async function medir<T>(fn: () => Promise<T>, limiteMs = 8000): Promise<{ ok: true; valor: T; ms: number } | { ok: false; erro: string; ms: number }> {
  const ini = Date.now();
  try {
    const valor = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`sem resposta em ${limiteMs / 1000} s`)), limiteMs))]);
    return { ok: true, valor, ms: Date.now() - ini };
  } catch (e) {
    return { ok: false, erro: (e as Error).message.slice(0, 200), ms: Date.now() - ini };
  }
}

/** Dias até o certificado HTTPS do host vencer. */
function diasCertificado(host: string): Promise<number> {
  return new Promise((res, rej) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 6000 }, () => {
      const c = s.getPeerCertificate();
      s.end();
      if (!c?.valid_to) return rej(new Error("sem certificado"));
      res(Math.floor((new Date(c.valid_to).getTime() - Date.now()) / 86400000));
    });
    s.on("error", rej);
    s.on("timeout", () => { s.destroy(); rej(new Error("tempo esgotado no TLS")); });
  });
}

const hostDe = (url?: string) => { try { return url ? new URL(url).hostname : null; } catch { return null; } };
const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const idade = (d: Date | string | null | undefined) => {
  if (!d) return "nunca";
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  return min < 1 ? "agora" : min < 60 ? `há ${min} min` : min < 1440 ? `há ${Math.round(min / 60)} h` : `há ${Math.round(min / 1440)} dias`;
};

async function infraestrutura(contaId: string): Promise<Checagem[]> {
  const g = "Infraestrutura";
  const out: Checagem[] = [];
  const commit = (process.env.RAILWAY_GIT_COMMIT_SHA ?? "").slice(0, 7);
  out.push({ id: "api", grupo: g, nome: "API (Railway)", status: "ok", detalhe: `No ar desde ${new Date(INICIO).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}${commit ? ` · versão ${commit}` : ""}${process.env.RAILWAY_REPLICA_REGION ? ` · ${process.env.RAILWAY_REPLICA_REGION}` : ""}`, link: "https://railway.com/dashboard" });

  const hb = await redis.get("saude:workers").catch(() => null);
  const hbIdade = hb ? (Date.now() - Number(JSON.parse(hb).em)) / 1000 : null;
  out.push({ id: "workers", grupo: g, nome: "Workers (filas)", status: hbIdade === null ? "falha" : hbIdade > 90 ? "falha" : hbIdade > 45 ? "atencao" : "ok",
    detalhe: hbIdade === null ? "Nenhum sinal dos workers. As mensagens não estão sendo processadas." : `Último sinal há ${Math.round(hbIdade)} s · ${JSON.parse(hb!).filas} filas ativas` });

  const db = await medir(async () => q1<any>(`SELECT pg_database_size(current_database()) AS bytes, (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS conexoes, (SELECT count(*) FROM _migracoes)::int AS migracoes`));
  out.push(db.ok
    ? { id: "banco", grupo: g, nome: "Banco de dados (Supabase)", status: db.ms > 1500 ? "atencao" : "ok", ms: db.ms, detalhe: `Responde em ${fmtMs(db.ms)} · ${(db.valor.bytes / 1048576).toFixed(0)} MB · ${db.valor.conexoes} conexões · ${db.valor.migracoes} migrações`, link: "https://supabase.com/dashboard" }
    : { id: "banco", grupo: g, nome: "Banco de dados (Supabase)", status: "falha", ms: db.ms, detalhe: db.erro, link: "https://supabase.com/dashboard" });

  const rd = await medir(async () => { await redis.ping(); return redis.info("memory"); });
  if (rd.ok) {
    const usado = Number(rd.valor.match(/used_memory:(\d+)/)?.[1] ?? 0) / 1048576;
    const politica = rd.valor.match(/maxmemory_policy:(\S+)/)?.[1] ?? "?";
    out.push({ id: "redis", grupo: g, nome: "Redis (filas e tempo real)", status: politica !== "noeviction" ? "atencao" : rd.ms > 500 ? "atencao" : "ok", ms: rd.ms,
      detalhe: `Responde em ${fmtMs(rd.ms)} · ${usado.toFixed(1)} MB em uso · política ${politica}${politica !== "noeviction" ? " (recomendado: noeviction, para não perder jobs)" : ""}` });
  } else out.push({ id: "redis", grupo: g, nome: "Redis (filas e tempo real)", status: "falha", ms: rd.ms, detalhe: rd.erro });

  const fl = await medir(async () => Promise.all(Object.entries(filas).map(async ([k, f]) => [k, await f.getJobCounts("waiting", "delayed", "active", "failed")] as const)));
  if (fl.ok) {
    const tot = fl.valor.reduce((s, [, c]) => ({ esperando: s.esperando + (c.waiting ?? 0), falhas: s.falhas + (c.failed ?? 0), agendados: s.agendados + (c.delayed ?? 0) }), { esperando: 0, falhas: 0, agendados: 0 });
    const piorFila = fl.valor.find(([, c]) => (c.waiting ?? 0) > 50);
    out.push({ id: "filas", grupo: g, nome: "Filas de processamento", status: piorFila ? "atencao" : "ok",
      detalhe: `${tot.esperando} esperando · ${tot.agendados} agendados · ${tot.falhas} falhas guardadas${piorFila ? ` · fila ${NOMES[piorFila[0] as keyof typeof NOMES]} acumulando` : ""}` });
  }

  if (process.env.S3_BUCKET) {
    const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION ?? "auto", forcePathStyle: !!process.env.S3_ENDPOINT, credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! } });
    const chave = `_saude/${contaId}.txt`;
    const st = await medir(async () => {
      await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: chave, Body: "ok", ContentType: "text/plain" }));
      await (await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: chave }))).Body?.transformToString();
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: chave }));
    });
    out.push({ id: "arquivos", grupo: g, nome: "Armazenamento de arquivos", status: st.ok ? (st.ms > 3000 ? "atencao" : "ok") : "falha", ms: st.ms, detalhe: st.ok ? `Gravação e leitura em ${fmtMs(st.ms)}` : st.erro });
  } else out.push({ id: "arquivos", grupo: g, nome: "Armazenamento de arquivos", status: "atencao", detalhe: "Usando disco local: em produção configure o bucket S3 (os arquivos somem a cada deploy)." });
  return out;
}

async function dominios(): Promise<Checagem[]> {
  const g = "Domínios e DNS";
  const alvos = [
    { id: "painel", nome: "Painel", url: process.env.APP_URL, cname: process.env.DNS_PAINEL_ESPERADO ?? "vercel-dns" },
    { id: "api-dominio", nome: "API e webhooks", url: process.env.API_URL, cname: process.env.DNS_API_ESPERADO ?? "railway.app" },
  ];
  const out: Checagem[] = [];
  for (const a of alvos) {
    const host = hostDe(a.url);
    if (!host || host === "localhost") { out.push({ id: a.id, grupo: g, nome: `${a.nome}`, status: "inativo", detalhe: "Endereço público não configurado (ambiente local)." }); continue; }
    const r = await medir(async () => { const resp = await fetch(a.url!.replace(/\/$/, "") + (a.id === "painel" ? "/login" : "/saude"), { redirect: "manual" }); return resp.status; });
    out.push({ id: a.id, grupo: g, nome: `${a.nome} · ${host}`, status: r.ok ? (r.valor < 400 ? (r.ms > 3000 ? "atencao" : "ok") : "falha") : "falha", ms: r.ms, detalhe: r.ok ? `HTTPS respondeu ${r.valor} em ${fmtMs(r.ms)}` : `Fora do ar: ${r.erro}`, link: a.url });

    const cert = await medir(() => diasCertificado(host));
    out.push({ id: `${a.id}-ssl`, grupo: g, nome: `Certificado SSL · ${host}`, status: !cert.ok ? "falha" : cert.valor < 7 ? "falha" : cert.valor < 20 ? "atencao" : "ok",
      detalhe: cert.ok ? `Válido por mais ${cert.valor} dias${cert.valor < 20 ? " (renovação automática: confira se o DNS continua apontando certo)" : ""}` : cert.erro });

    const d = await medir(async () => { try { return { tipo: "CNAME", valor: (await dns.resolveCname(host)).join(", ") }; } catch { return { tipo: "A", valor: (await dns.resolve4(host)).join(", ") }; } });
    const certo = d.ok && (d.valor.tipo === "A" || d.valor.valor.includes(a.cname));
    out.push({ id: `${a.id}-dns`, grupo: g, nome: `Registro DNS · ${host}`, status: !d.ok ? "falha" : certo ? "ok" : "atencao",
      detalhe: d.ok ? `${d.valor.tipo} → ${d.valor.valor}${certo ? "" : ` (esperado algo com "${a.cname}")`}` : `Não resolve: ${d.erro}. Confira o registro no provedor de DNS (HostGator).` });
  }
  return out;
}

async function whatsapp(contaId: string): Promise<Checagem[]> {
  const g = "WhatsApp";
  const out: Checagem[] = [];
  const cxs = await q<any>(`SELECT c.*, (SELECT max(m.criado_em) FROM mensagens m JOIN conversas cv ON cv.id = m.conversa_id WHERE cv.conexao_id = c.id AND m.autor = 'cliente') AS ultima_recebida
                              FROM conexoes c WHERE c.conta_id = $1 ORDER BY c.criado_em`, [contaId]);
  const NOME: Record<string, string> = { conectada: "Conectado", caiu: "Caiu", reconectando: "Reconectando", precisa_atencao: "Precisa de atenção", aguardando_qr: "Aguardando QR Code", desconectada: "Desconectado" };
  if (!cxs.some((c) => c.tipo !== "simulador")) out.push({ id: "wa-nenhum", grupo: g, nome: "Número de WhatsApp", status: "atencao", detalhe: "Nenhum número real conectado ainda (só o simulador). Conecte em Conexões." });
  for (const c of cxs) {
    const st: Situacao = c.status === "conectada" ? "ok" : ["caiu", "precisa_atencao", "desconectada"].includes(c.status) ? "falha" : "atencao";
    out.push({ id: `wa-${c.id}`, grupo: g, nome: `${c.tipo === "oficial" ? "API Oficial" : c.tipo === "qr" ? "QR Code" : "Simulador"} · ${c.nome}`, status: st, detalhe: `${NOME[c.status] ?? c.status} · última mensagem recebida ${idade(c.ultima_recebida)}` });
  }
  return out;
}

/** WhatsApp do ponto de vista da plataforma: Evolution API e webhook da Meta (únicos para todos os clientes). */
async function whatsappPlataforma(): Promise<Checagem[]> {
  const g = "WhatsApp";
  const out: Checagem[] = [];
  const cxs = await q<any>("SELECT tipo FROM conexoes");
  if (process.env.EVOLUTION_URL) {
    const ev = await medir(async () => { const r = await fetch(process.env.EVOLUTION_URL!); return r.status; });
    out.push({ id: "evolution", grupo: g, nome: "Evolution API (QR Code)", status: ev.ok && ev.valor < 500 ? (ev.ms > 3000 ? "atencao" : "ok") : "falha", ms: ev.ms, detalhe: ev.ok ? `Respondeu ${ev.valor} em ${fmtMs(ev.ms)}` : ev.erro });
  } else if (cxs.some((c) => c.tipo === "qr")) out.push({ id: "evolution", grupo: g, nome: "Evolution API (QR Code)", status: "falha", detalhe: "Há conexão por QR Code, mas a Evolution API não está configurada (EVOLUTION_URL)." });
  else out.push({ id: "evolution", grupo: g, nome: "Evolution API (QR Code)", status: "inativo", detalhe: "Não instalada. Só é necessária para conectar números por QR Code." });
  const temOficial = cxs.some((c) => c.tipo === "oficial");
  out.push({ id: "meta-webhook", grupo: g, nome: "Webhook da Meta (API Oficial)", status: !temOficial ? "inativo" : process.env.META_VERIFY_TOKEN ? "ok" : "falha",
    detalhe: !temOficial ? "Sem número na API Oficial." : process.env.META_VERIFY_TOKEN ? `Verify token configurado · ${process.env.API_URL ?? ""}/webhooks/meta` : "META_VERIFY_TOKEN não configurado: a Meta não consegue validar o webhook.", link: "https://metastatus.com/" });
  const resumo = await q1<any>("SELECT count(*) FILTER (WHERE status = 'conectada')::int AS ok, count(*) FILTER (WHERE status <> 'conectada' AND tipo <> 'simulador')::int AS fora, count(*) FILTER (WHERE tipo <> 'simulador')::int AS total FROM conexoes");
  out.unshift({ id: "wa-todos", grupo: g, nome: "Números de todos os clientes", status: resumo.fora ? "atencao" : resumo.total ? "ok" : "inativo", detalhe: resumo.total ? `${resumo.total - resumo.fora} de ${resumo.total} conectados` : "Nenhum número real conectado ainda." });
  return out;
}

async function ia(contaId: string): Promise<Checagem[]> {
  const g = "Inteligência Artificial";
  const ps = await q<any>("SELECT * FROM provedores_ia WHERE conta_id = $1 ORDER BY ordem", [contaId]);
  const ativos = ps.filter((p) => p.ativo);
  const out: Checagem[] = [];
  if (!ativos.length) out.push({ id: "ia-nenhum", grupo: g, nome: "Provedores de IA", status: "falha", detalhe: "Nenhum provedor ativo: as conversas vão direto para a equipe." });
  if (ativos[0]?.provedor === "simulado") out.push({ id: "ia-simulado", grupo: g, nome: "IA principal", status: "atencao", detalhe: "O principal é o provedor Simulado (só para testes). Cadastre a chave do Claude em Agente de IA." });
  const uso = await q<any>(`SELECT provedor_id, count(*) FILTER (WHERE sucesso)::int AS ok, count(*) FILTER (WHERE NOT sucesso)::int AS falhas FROM uso_ia WHERE conta_id = $1 AND criado_em > now() - interval '1 hour' GROUP BY 1`, [contaId]);
  ps.forEach((p, i) => {
    const u = uso.find((x) => x.provedor_id === p.id) ?? { ok: 0, falhas: 0 };
    const degradado = p.degradado_ate && new Date(p.degradado_ate) > new Date();
    const pctGasto = p.limite_mensal ? Math.round((100 * Number(p.gasto_mes)) / Number(p.limite_mensal)) : null;
    const st: Situacao = !p.ativo ? "inativo" : degradado ? "falha" : (pctGasto ?? 0) >= 80 || (p.ultimo_tempo_ms ?? 0) > 8000 || u.falhas > u.ok ? "atencao" : "ok";
    out.push({ id: `ia-${p.id}`, grupo: g, nome: `${i === 0 ? "Principal" : `Backup ${i}`} · ${p.rotulo ?? p.provedor} (${p.modelo})`, status: st, ms: p.ultimo_tempo_ms ?? undefined,
      detalhe: [!p.ativo ? "Desligado" : degradado ? `Com falha: ${p.ultimo_erro ?? ""}` : p.ultimo_tempo_ms ? `Última resposta em ${fmtMs(p.ultimo_tempo_ms)}` : "Ainda sem uso",
        `última hora: ${u.ok} ok / ${u.falhas} falhas`, pctGasto !== null ? `gasto ${pctGasto}% do limite` : null].filter(Boolean).join(" · ") });
  });
  return out;
}

async function integracoes(contaId: string): Promise<Checagem[]> {
  const g = "Integrações";
  const out: Checagem[] = [];
  const gws = await q<any>("SELECT tipo, ativo, ambiente, (SELECT max(pago_em) FROM cobrancas c WHERE c.gateway_id = g.id) AS ultimo_pago FROM gateways g WHERE conta_id = $1", [contaId]);
  if (!gws.some((x) => x.ativo)) out.push({ id: "pagamentos", grupo: g, nome: "Pagamentos", status: "inativo", detalhe: "Nenhum gateway ativo (Asaas, Mercado Pago ou Stripe)." });
  for (const x of gws.filter((y) => y.ativo)) out.push({ id: `gw-${x.tipo}`, grupo: g, nome: `Pagamentos · ${x.tipo}`, status: x.ambiente === "producao" ? "ok" : "atencao", detalhe: `Ambiente ${x.ambiente} · último pagamento ${idade(x.ultimo_pago)}` });
  const lead = await q1<any>("SELECT max(recebido_em) AS ultimo, count(*) FILTER (WHERE recebido_em > now() - interval '24 hours')::int AS dia FROM entradas_leads WHERE conta_id = $1", [contaId]);
  out.push({ id: "leads", grupo: g, nome: "Entrada de leads (Goalfy, Zapier, n8n)", status: lead?.ultimo ? "ok" : "inativo", detalhe: lead?.ultimo ? `Último lead ${idade(lead.ultimo)} · ${lead.dia} nas últimas 24 h` : "Nenhum lead recebido ainda." });
  const vend = await q1<{ n: number }>("SELECT count(*)::int AS n FROM usuarios WHERE conta_id = $1 AND google_refresh_token IS NOT NULL", [contaId]);
  out.push({ id: "google", grupo: g, nome: "Google Agenda", status: !process.env.GOOGLE_CLIENT_ID ? "inativo" : vend?.n ? "ok" : "atencao", detalhe: !process.env.GOOGLE_CLIENT_ID ? "Projeto do Google Cloud não configurado." : `${vend?.n ?? 0} vendedor(es) com agenda conectada.` });
  out.push({ id: "push", grupo: g, nome: "Notificações no celular (push)", status: process.env.VAPID_PUBLIC_KEY ? "ok" : "inativo", detalhe: process.env.VAPID_PUBLIC_KEY ? "Chaves VAPID configuradas." : "Chaves VAPID não configuradas: a equipe não recebe push." });
  return out;
}

const PAGINAS_STATUS = [
  { id: "st-supabase", nome: "Supabase", api: "https://status.supabase.com/api/v2/status.json", link: "https://status.supabase.com" },
  { id: "st-vercel", nome: "Vercel", api: "https://www.vercel-status.com/api/v2/status.json", link: "https://www.vercel-status.com" },
  { id: "st-claude", nome: "Claude (Anthropic)", api: "https://status.claude.com/api/v2/status.json", link: "https://status.claude.com" },
  { id: "st-openai", nome: "OpenAI", api: "https://status.openai.com/api/v2/status.json", link: "https://status.openai.com" },
];

async function fornecedores(): Promise<Checagem[]> {
  const g = "Fornecedores";
  const out = await Promise.all(PAGINAS_STATUS.map(async (p): Promise<Checagem> => {
    const r = await medir(async () => (await (await fetch(p.api)).json()) as any, 6000);
    if (!r.ok) return { id: p.id, grupo: g, nome: p.nome, status: "atencao", detalhe: `Página de status não respondeu (${r.erro})`, link: p.link };
    const ind = r.valor?.status?.indicator ?? "none";
    const TRAD: Record<string, string> = { none: "Todos os sistemas operando normalmente", minor: "Instabilidade leve informada pelo fornecedor", major: "Falha importante informada pelo fornecedor", critical: "Fora do ar segundo o fornecedor", maintenance: "Em manutenção programada" };
    return { id: p.id, grupo: g, nome: p.nome, status: ind === "none" ? "ok" : ind === "minor" || ind === "maintenance" ? "atencao" : "falha", detalhe: `${TRAD[ind] ?? r.valor?.status?.description ?? ""}${ind !== "none" && r.valor?.status?.description ? ` (${r.valor.status.description})` : ""}`, link: p.link };
  }));
  out.push({ id: "st-railway", nome: "Railway", grupo: g, status: "inativo", detalhe: "Sem API pública de status; a API e os workers acima já medem nossos serviços.", link: "https://status.railway.com" });
  out.push({ id: "st-meta", nome: "Meta (WhatsApp)", grupo: g, status: "inativo", detalhe: "Sem API pública de status; consulte a página oficial.", link: "https://metastatus.com" });
  return out;
}

export type Escopo = "cliente" | "plataforma";
export const GRUPOS_POR_ESCOPO: Record<Escopo, string[]> = {
  plataforma: ["Infraestrutura", "Domínios e DNS", "WhatsApp", "Fornecedores"],
  cliente: ["WhatsApp", "Inteligência Artificial", "Integrações"],
};

/** cliente: só o que é da conta (números, IAs, pagamentos, leads). plataforma: infraestrutura comum a todos. */
export async function verificarSaude(contaId: string, opts: { forcar?: boolean; escopo?: Escopo } = {}): Promise<RelatorioSaude> {
  const escopo = opts.escopo ?? "cliente";
  const chave = `saude:relatorio:${escopo}:${escopo === "plataforma" ? "global" : contaId}`;
  if (!opts.forcar) {
    const c = await redis.get(chave).catch(() => null);
    if (c) return JSON.parse(c);
  }
  const partes = escopo === "plataforma"
    ? await Promise.all([infraestrutura(contaId), dominios(), whatsappPlataforma(), fornecedores()])
    : await Promise.all([whatsapp(contaId), ia(contaId), integracoes(contaId)]);
  const checagens = partes.flat();
  const geral: Situacao = checagens.some((c) => c.status === "falha") ? "falha" : checagens.some((c) => c.status === "atencao") ? "atencao" : "ok";
  const rel = { gerado_em: new Date().toISOString(), geral, checagens };
  await redis.set(chave, JSON.stringify(rel), "EX", 60).catch(() => {});
  return rel;
}

async function alertar(contaId: string, rel: RelatorioSaude, prefixo: string) {
  for (const k of rel.checagens) {
    const chave = `saude:${prefixo}:${k.id}`;
    if (k.status === "falha") await criarAlerta(contaId, { nivel: k.grupo === "Fornecedores" ? "atencao" : "urgente", tipo: "saude", titulo: `${k.nome}: com problema`, detalhe: k.detalhe, chave, push: k.grupo !== "Fornecedores" });
    else await resolverAlerta(contaId, chave);
  }
}

/**
 * Job periódico (a cada 5 min): cada cliente recebe alertas da própria operação;
 * os alertas de infraestrutura vão só para as contas dos administradores da plataforma.
 */
export async function vigiarSaude() {
  for (const c of await q<{ id: string }>("SELECT id FROM contas")) await alertar(c.id, await verificarSaude(c.id, { forcar: true, escopo: "cliente" }), "cliente");
  const contasPlataforma = await q<{ conta_id: string }>("SELECT DISTINCT conta_id FROM usuarios WHERE admin_plataforma");
  if (contasPlataforma.length) {
    const rel = await verificarSaude(contasPlataforma[0].conta_id, { forcar: true, escopo: "plataforma" });
    for (const c of contasPlataforma) await alertar(c.conta_id, rel, "plataforma");
  }
}

/** Sinal de vida dos workers, lido pela API. */
export async function batimentoWorkers(qtdFilas: number) {
  await redis.set("saude:workers", JSON.stringify({ em: Date.now(), filas: qtdFilas }), "EX", 300);
}
