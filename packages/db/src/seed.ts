import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool, q, q1 } from "./index.ts";
import { migrar } from "./migrate.ts";

/** Dados iniciais para desenvolvimento/demonstração. Os preços ficam como [VALOR]: preencha com a tabela real. */
async function seed() {
  await migrar();
  if (await q1("SELECT 1 FROM contas LIMIT 1")) { console.log("já existe conta; seed ignorado"); return; }
  const conta = await q1<any>("INSERT INTO contas (nome, token_leads, config) VALUES ($1,$2,$3) RETURNING *",
    ["Master Laudo", "dmc_live_" + randomBytes(24).toString("base64url"), JSON.stringify({ descontoMaximo: 10, limiteCobrancaSemAprovacao: 500 })]);
  for (const f of ["Vendas", "Suporte", "Financeiro", "Expansão"]) await q("INSERT INTO filas (conta_id, nome) VALUES ($1,$2)", [conta.id, f]);
  const senha = process.env.SEED_SENHA ?? "domma123";
  const hash = await bcrypt.hash(senha, 10);
  await q("INSERT INTO usuarios (conta_id, nome, email, senha_hash, perfil, filas, status) VALUES ($1,'Administrador','admin@domma.local',$2,'admin','{}','online')", [conta.id, hash]);
  await q("INSERT INTO usuarios (conta_id, nome, email, senha_hash, perfil, filas, cidades, status) VALUES ($1,'Ana Paula','ana@domma.local',$2,'atendente','{Vendas,Expansão}','{Belo Horizonte,Contagem}','online')", [conta.id, hash]);
  await q("INSERT INTO usuarios (conta_id, nome, email, senha_hash, perfil, filas, status) VALUES ($1,'Bruno Reis','bruno@domma.local',$2,'supervisor','{Vendas,Suporte}','online')", [conta.id, hash]);

  await q(`INSERT INTO agentes_ia (conta_id, personalidade, nome, emojis, tratamento, instrucoes, modo_padrao, velocidade_escrita, classificacao) VALUES ($1,'consultora','Duda','poucos','voce',$2,'ia','natural',$3)`, [
    conta.id, "Sempre ofereça a pesquisa completa para quem vai comprar carro usado.",
    JSON.stringify({ interesses: [
      { nome: "franquia", sinais: [{ sinal: "Perguntou investimento ou retorno", peso: 20 }, { sinal: "Informou a cidade onde quer abrir", peso: 15 }, { sinal: "Capital dentro da faixa", peso: 25 }, { sinal: "Quer começar em até 3 meses", peso: 20 }, { sinal: "Pediu reunião ou apresentação", peso: 20 }, { sinal: "Só estou pesquisando", peso: -20 }, { sinal: "Capital abaixo da faixa", peso: -30 }] },
      { nome: "pesquisa_veicular", sinais: [{ sinal: "Vai comprar o carro em breve", peso: 25 }, { sinal: "Informou a placa", peso: 20 }] },
      { nome: "plataforma_lojistas", sinais: [{ sinal: "Tem loja de veículos", peso: 25 }, { sinal: "Informou quantos usuários", peso: 15 }] },
      { nome: "laudo", sinais: [] }, { nome: "suporte", sinais: [] },
    ] })]);

  // Provedor simulado (sem custo) para funcionar sem chave. Se houver chave, Claude vira o principal.
  let ordem = 0;
  if (process.env.ANTHROPIC_API_KEY) {
    const { cifrar } = await import("@domma/shared");
    await q("INSERT INTO provedores_ia (conta_id, provedor, rotulo, modelo, chave, ordem) VALUES ($1,'anthropic','Claude','claude-opus-5-5',$2,$3)", [conta.id, cifrar(process.env.ANTHROPIC_API_KEY), ordem++]);
  }
  await q("INSERT INTO provedores_ia (conta_id, provedor, rotulo, modelo, ordem) VALUES ($1,'simulado','Simulado (testes)','regras',$2)", [conta.id, ordem++]);

  await q("INSERT INTO conexoes (conta_id, tipo, nome, status, modo_padrao) VALUES ($1,'simulador','Simulador (testes)','conectada','ia')", [conta.id]);

  const docs = [
    ["texto", "Informações rápidas", "Horário de atendimento: segunda a sexta, das 8h às 18h. Formas de pagamento: Pix, boleto e cartão. Endereço da unidade: [ENDEREÇO]."],
    ["texto", "Pesquisa veicular", "A pesquisa veicular completa mostra histórico de leilão, sinistro, roubo e furto, débitos e gravames do veículo. Preço da pesquisa completa: [VALOR]. A pesquisa básica custa [VALOR] e traz dados cadastrais e débitos. O resultado sai em poucos minutos pelo WhatsApp."],
    ["texto", "Franquia", "A franquia Master Laudo permite abrir uma unidade de vistoria e laudo veicular. Investimento inicial: [VALOR]. Prazo médio de retorno: [PRAZO]. O franqueado recebe treinamento, sistema e suporte de marketing. Para conhecer melhor, oferecemos uma reunião com um consultor de expansão."],
    ["texto", "Plataforma para lojistas", "A plataforma de pesquisas para lojistas permite que lojas de veículos façam consultas com preço especial por volume e acesso para vários usuários da equipe. Planos a partir de [VALOR] por mês."],
  ];
  for (const [tipo, titulo, conteudo] of docs) {
    const d = await q1<any>("INSERT INTO base_conhecimento (conta_id, tipo, titulo, conteudo) VALUES ($1,$2,$3,$4) RETURNING id", [conta.id, tipo, titulo, conteudo]);
    await q("INSERT INTO base_trechos (conta_id, documento_id, texto) VALUES ($1,$2,$3)", [conta.id, d.id, conteudo]);
  }

  // Material de exemplo: a IA pode enviar a apresentação da franquia.
  const dir = path.resolve(process.env.STORAGE_DIR ?? "./armazenamento");
  const chave = `${conta.id}/exemplo/apresentacao-franquia.pdf`;
  await mkdir(path.join(dir, path.dirname(chave)), { recursive: true });
  await writeFile(path.join(dir, chave), pdfMinimo("Apresentacao da Franquia Master Laudo (EXEMPLO - substitua pelo arquivo real)"));
  await q("INSERT INTO materiais_ia (conta_id, titulo, quando_enviar, interesses, arquivo, mime, nome_arquivo, legenda) VALUES ($1,$2,$3,$4,$5,'application/pdf','Apresentacao-Franquia.pdf',$6)",
    [conta.id, "Apresentação da Franquia", "quando o contato demonstrar interesse em franquia, pedir mais informações, apresentação ou material", ["franquia"], chave, "Apresentação da Franquia Master Laudo"]);

  console.log(`\nConta criada: ${conta.nome}\n  admin@domma.local / ${senha}\n  ana@domma.local (atendente) / ${senha}\n  bruno@domma.local (supervisor) / ${senha}\n  token de leads: ${conta.token_leads}\n`);
}

function pdfMinimo(texto: string): Buffer {
  const conteudo = `BT /F1 18 Tf 50 750 Td (${texto.replace(/[()\\]/g, "")}) Tj ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

seed().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
