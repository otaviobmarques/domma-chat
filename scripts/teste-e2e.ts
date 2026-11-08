/** Teste ponta a ponta pelo simulador. Uso: npx tsx scripts/teste-e2e.ts (API e workers rodando). */
const API = process.env.API_URL ?? "http://localhost:3333";
let token = "";
const req = async (metodo: string, caminho: string, corpo?: unknown) => {
  const r = await fetch(API + caminho, { method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: corpo ? JSON.stringify(corpo) : undefined });
  const t = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.arrayBuffer();
  if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status} ${JSON.stringify(t)}`);
  return t as any;
};
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const ok = (cond: unknown, msg: string) => { console.log(`${cond ? "✔" : "✘"} ${msg}`); if (!cond) falhas++; };

token = (await req("POST", "/api/v1/auth/login", { email: "admin@domma.local", senha: "domma123" })).token;
const sim = (await req("GET", "/api/v1/conexoes")).find((c: any) => c.tipo === "simulador");
const tel = "55319" + String(Date.now()).slice(-8);
const msgs = async (id: string) => req("GET", `/api/v1/conversas/${id}/mensagens`);
/** Espera a conversa "assentar": nenhuma mensagem nova por `quieto` ms (a IA digita com pausas reais). */
const assentar = async (id: string, quieto = 6000, max = 40000) => {
  const ini = Date.now(); let n = -1, desde = Date.now();
  while (Date.now() - ini < max) { const k = (await msgs(id)).length; if (k !== n) { n = k; desde = Date.now(); } else if (Date.now() - desde > quieto) return; await esperar(700); }
};
let convId = "";
const cliente = async (texto: string, quieto = 5000) => {
  const r = await req("POST", `/api/v1/simulador/${sim.id}/mensagem`, { telefone: tel, nome: "Juliano Martins", texto });
  convId = r.conversaId;
  const ini = Date.now();
  // espera alguma reação (resposta, evento ou nota) depois da mensagem do cliente; silêncio também é válido após 15 s
  while (Date.now() - ini < 15000) { const ms = await msgs(convId); const i = ms.map((m: any) => m.conteudo).lastIndexOf(texto); if (i >= 0 && ms.slice(i + 1).length) break; await esperar(700); }
  await assentar(convId, quieto);
  return r.conversaId as string;
};
const ultimaIA = async (id: string) => (await msgs(id)).filter((m: any) => m.autor === "ia").map((m: any) => m.conteudo).slice(-3).join(" | ");

const id = await cliente("Oi, bom dia");
ok((await msgs(id)).some((m: any) => m.autor === "ia"), `IA respondeu a saudação: ${await ultimaIA(id)}`);

await cliente("Quanto custa a pesquisa veicular completa?");
ok(/pesquisa/i.test(await ultimaIA(id)), `IA usou a base de conhecimento: ${await ultimaIA(id)}`);

await cliente("Tenho interesse na franquia, quero abrir em Uberlandia em 2 meses e tenho capital. Me manda a apresentação?", 12000);
const m3 = await msgs(id);
ok(m3.some((m: any) => m.material_id), "IA enviou o arquivo da Apresentação da Franquia");
const conv = await req("GET", `/api/v1/conversas/${id}`);
ok(conv.interesse === "franquia" && conv.nota > 0, `Classificação: ${conv.temperatura} nota ${conv.nota} (${conv.motivo_classificacao})`);

await cliente("Você é um robô?");
ok(/assistente virtual/i.test(await ultimaIA(id)), "Transparência: confirma que é assistente virtual");

await cliente("quero falar com um atendente");
const c2 = await req("GET", `/api/v1/conversas/${id}`);
const foraHorario = /atende de/i.test((await msgs(id)).filter((m: any) => m.autor === "ia").at(-1)?.conteudo ?? "");
ok(c2.modo === "humano" || (foraHorario && c2.retorno), foraHorario ? `Fora do horário: informa o horário e agenda retorno (${c2.retorno?.rotulo})` : `Pedido de atendente transfere (responsável=${c2.responsavel_nome ?? "-"})`);

await req("POST", `/api/v1/conversas/${id}/mensagens`, { texto: "Oi Juliano, aqui é da equipe!" });
await esperar(1500);
ok((await msgs(id)).some((m: any) => m.autor === "humano" && m.status === "enviada"), "Atendente envia mensagem");

const nIA = (await msgs(id)).filter((m: any) => m.autor === "ia").length;
await req("PATCH", `/api/v1/conversas/${id}/modo`, { modo: "ia", retomada: "agora" });
await esperar(1000); await assentar(id);
ok((await msgs(id)).filter((m: any) => m.autor === "ia").length > nIA && (await req("GET", `/api/v1/conversas/${id}`)).modo === "ia", `Devolver para IA 'já falar' gera retomada: ${await ultimaIA(id)}`);

// Fale com a IA
const ins = await req("POST", `/api/v1/conversas/${id}/instrucoes`, { texto: "Resuma a conversa" });
await esperar(1500); await assentar(id, 3000);
ok((await msgs(id)).some((m: any) => m.autor === "nota" && /Resumo/.test(m.conteudo ?? "")), "Fale com a IA: resumo como nota interna");
void ins;

// Despedidas
await cliente("Me chama amanhã que agora estou ocupado");
const c3 = await req("GET", `/api/v1/conversas/${id}`);
ok(!!c3.retorno, `Retorno agendado: ${c3.retorno?.rotulo}`);
const antes = (await msgs(id)).length;
await cliente("obrigado, tchau");
await cliente("valeu");
await cliente("tchau");
const depois = (await msgs(id)).slice(antes);
ok(depois.filter((m: any) => m.autor === "ia" && m.tipo === "texto").length <= 1, `Três despedidas: ${depois.filter((m: any) => m.autor === "ia").map((m: any) => m.tipo + ":" + (m.conteudo ?? "")).join(" | ")}`);

await cliente("SAIR");
ok((await req("GET", `/api/v1/conversas/${id}`)).opt_out === true, "SAIR faz opt-out");

// Exportações
const pdf = await req("GET", `/api/v1/conversas/${id}/exportar?formato=pdf`);
ok(pdf.byteLength > 2000, `PDF da conversa: ${pdf.byteLength} bytes`);
const dash = await req("GET", "/api/v1/dashboard.pdf");
ok(dash.byteLength > 2000, `PDF do dashboard: ${dash.byteLength} bytes`);
const rel = await req("GET", "/api/v1/relatorios.pdf?periodo=7d");
ok(rel.byteLength > 2000, `PDF dos números: ${rel.byteLength} bytes`);
const fs = await import("node:fs");
const dir = process.env.SAIDA ?? ".";
fs.writeFileSync(`${dir}/exemplo-conversa.pdf`, Buffer.from(pdf)); fs.writeFileSync(`${dir}/exemplo-dashboard.pdf`, Buffer.from(dash)); fs.writeFileSync(`${dir}/exemplo-numeros.pdf`, Buffer.from(rel));

// Entrada de leads (Goalfy)
const conta = await req("GET", "/api/v1/conta");
const r = await fetch(`${API}/v1/leads/${conta.id}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${conta.token_leads}` },
  body: JSON.stringify({ nome: "Mariana Souza", telefone: "+5531988887777", fonte: "meta_ads", campanha: "Franquia MG - Formulario", interesse: "franquia", id_externo: "goalfy-" + Date.now(), contatar: true }) });
const lead = await r.json();
ok(r.status === 202 && lead.conversa_id, `Lead do Goalfy aceito: ${JSON.stringify(lead)}`);
await esperar(2000); await assentar(lead.conversa_id);
ok((await msgs(lead.conversa_id)).some((m: any) => m.autor === "ia"), "IA chamou o lead novo");

console.log(falhas ? `\n${falhas} verificação(ões) falharam` : "\nTudo certo!");
process.exit(falhas ? 1 : 0);
