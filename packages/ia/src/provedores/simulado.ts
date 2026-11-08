import { normalizarTexto } from "@domma/shared";
import type { IAProvider, PedidoGerar, RespostaGerar } from "../tipos.ts";

/**
 * Provedor SIMULADO (regras simples, sem custo). Serve para desenvolvimento, testes automáticos
 * e demonstração sem chave de API. Não usar em produção: não entende linguagem de verdade.
 */
export class ProvedorSimulado implements IAProvider {
  readonly nome = "simulado";
  constructor(private atrasoMs = 150) {}

  async gerar(req: PedidoGerar): Promise<RespostaGerar> {
    await new Promise((r) => setTimeout(r, this.atrasoMs));
    if (/FALHAR_SIMULADO/.test(req.sistema)) throw new Error("simulado: falha forçada");
    const ehInstrucao = !!req.esquema && JSON.stringify(req.esquema).includes("decisao");
    const out = ehInstrucao ? instrucao(req) : resposta(req);
    return { texto: JSON.stringify(out), tokensEntrada: 0, tokensSaida: 0, custo: 0 };
  }

  async transcrever(): Promise<RespostaGerar> {
    return { texto: "(transcrição simulada) Oi, queria saber mais sobre o serviço.", tokensEntrada: 0, tokensSaida: 0, custo: 0 };
  }
  async lerImagem(): Promise<RespostaGerar> {
    return { texto: "(leitura simulada) Foto de documento de veículo.", tokensEntrada: 0, tokensSaida: 0, custo: 0 };
  }
}

function contexto(req: PedidoGerar) {
  const nomeIA = req.sistema.match(/Você é ([^,]+),/)?.[1] ?? "assistente";
  const contato = (() => { try { return JSON.parse(req.sistema.match(/DADOS DO CONTATO: (\{.*\})/)?.[1] ?? "{}"); } catch { return {}; } })();
  const trechos = [...req.sistema.matchAll(/^\[([^\]]+)\] \(([^)]*)\) (.+)$/gm)].map((m) => ({ id: m[1], texto: m[3] }));
  const clientes = req.historico.filter((m) => m.papel === "cliente");
  const ultima = clientes[clientes.length - 1]?.texto ?? "";
  const ultimaIA = [...req.historico].reverse().find((m) => m.papel === "assistente")?.texto ?? "";
  const materiais = [...req.sistema.matchAll(/^\[([^\]]+)\] (.+?) — enviar quando: (.+?)( \(JÁ ENVIADO.*)?$/gm)].map((m) => ({ id: m[1], titulo: m[2], quando: m[3], enviado: !!m[4] }));
  const tudo = clientes.map((m) => m.texto).join(" ");
  const primeiroNome = String(contato.nome ?? "").split(" ")[0];
  return { nomeIA, materiais, trechos, ultima, ultimaIA, tudo, primeiroNome, qtdCliente: clientes.length };
}

function classificar(tudo: string) {
  const t = normalizarTexto(tudo);
  let nota = 30; const dados: { campo: string; valor: string }[] = []; const motivos: string[] = [];
  let interesse = "geral";
  if (/franquia|franqueado|abrir uma unidade/.test(t)) interesse = "franquia";
  else if (/pesquisa|placa|veicul|carro/.test(t)) interesse = "pesquisa_veicular";
  else if (/loja|lojista|plataforma/.test(t)) interesse = "plataforma_lojistas";
  else if (/laudo|vistoria/.test(t)) interesse = "laudo";
  const sinal = (re: RegExp, peso: number, motivo: string) => { if (re.test(t)) { nota += peso; motivos.push(motivo); } };
  sinal(/investimento|retorno|quanto custa|valor|preco/, 20, "perguntou valores");
  sinal(/\b(em|na|no) [a-z]{4,}/, 0, "");
  const cidade = t.match(/abrir (?:em|na|no) ([a-z ]{3,25}?)(?: em| daqui| com|$)/)?.[1];
  if (cidade) { nota += 15; dados.push({ campo: "cidade", valor: cidade.trim() }); motivos.push("informou a cidade"); }
  sinal(/capital|tenho (o )?dinheiro|tenho \d+ mil/, 25, "tem capital");
  const prazo = t.match(/(\d+|um|dois|tres) mes(es)?/)?.[0];
  if (prazo) { nota += 20; dados.push({ campo: "prazo", valor: prazo }); motivos.push("quer começar logo"); }
  sinal(/reuniao|apresentacao|falar com (um )?(vendedor|consultor)/, 20, "pediu reunião");
  sinal(/so estou pesquisando|so pesquisando/, -20, "só pesquisando");
  sinal(/quero comprar|vou comprar|fechar|quero contratar/, 25, "intenção de compra");
  nota = Math.max(0, Math.min(100, nota));
  const temperatura = nota >= 75 ? "quente" : nota >= 45 ? "morno" : "frio";
  return { temperatura, nota, interesse, motivo: motivos.filter(Boolean).join(", ") || "início de conversa, sem sinais ainda", dados, lead_quente: nota >= 75 } as const;
}

function resposta(req: PedidoGerar) {
  const c = contexto(req);
  const t = normalizarTexto(c.ultima);
  const nome = c.primeiroNome ? `, ${c.primeiroNome}` : "";
  const classificacao = classificar(c.tudo);
  const base = { transferir: null as null | { motivo: string }, etiquetas: [] as string[], agendar_retorno: false, oferecer_reuniao: false, resumo: `Cliente conversa sobre ${classificacao.interesse.replace("_", " ")}. Última mensagem: "${c.ultima.slice(0, 80)}".`, sentimento: "neutro" as const, assunto: classificacao.interesse.replace("_", " "), fontes: [] as string[], enviar_materiais: [] as string[], classificacao };
  const despedidaIA = /ate (mais|logo|amanha|la|breve)|qualquer coisa|estou por aqui|tenha um/.test(normalizarTexto(c.ultimaIA));

  if (/SITUAÇÃO: a conversa acabou de ser devolvida/.test(req.sistema)) return { ...base, responder: true, partes: [`${c.primeiroNome ? c.primeiroNome + ", v" : "V"}oltei por aqui! Posso te ajudar a continuar de onde paramos?`] };
  if (/SITUAÇÃO: este é o retorno agendado/.test(req.sistema)) return { ...base, responder: true, partes: [`Oi${nome}! Como combinamos, voltei pra gente continuar 😊`, "Ainda tem interesse?"] };
  if (/SITUAÇÃO: este é um lead novo/.test(req.sistema)) return { ...base, responder: true, partes: [`Oi${nome}! Aqui é a ${c.nomeIA} 😊`, `Vi que você se interessou por ${classificacao.interesse === "geral" ? "nossos serviços" : classificacao.interesse.replace("_", " ")}. Posso te contar como funciona?`] };
  if (/^(obrigad[oa]|valeu|vlw|tchau|ate mais|ate logo|falou|ok obrigad[oa]|blz|beleza)\b/.test(t) && despedidaIA) return { ...base, responder: false, partes: [] };
  if (/^(obrigad[oa]|valeu|vlw|tchau|ate mais|ate logo|falou|blz|beleza|boa noite)\b/.test(t)) return { ...base, responder: true, partes: [`Eu que agradeço${nome}! Até mais 👋`, "Qualquer coisa, estou por aqui."] };
  if (/\b(robo|bot|ia|inteligencia artificial|maquina)\b/.test(t) && /\?|e (um|uma)|sou|falando com/.test(c.ultima.toLowerCase() + "?"))
    return { ...base, responder: true, partes: [`Sou a ${c.nomeIA}, assistente virtual da empresa 😊`, "Se preferir, chamo um atendente da equipe pra falar com você. É só me dizer!"] };
  if (/\b(atendente|humano|pessoa|alguem de verdade|gerente)\b/.test(t))
    return { ...base, responder: true, partes: ["Claro! Vou te passar para um atendente da equipe agora mesmo."], transferir: { motivo: "cliente pediu atendente" } };
  if (/\b(me chama|me liga|mais tarde|amanha|outro dia)\b/.test(t))
    return { ...base, responder: true, partes: [`Combinado${nome}! Te chamo então.`, "Até lá 👋"], agendar_retorno: true };
  if (/\b(desconto|mais barato|abaixa)\b/.test(t))
    return { ...base, responder: true, partes: ["Entendi! Vou chamar alguém da equipe pra ver a melhor condição pra você."], transferir: { motivo: "negociação de desconto" } };
  if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa)\b/.test(t) && t.split(" ").length <= 4)
    return { ...base, responder: true, partes: [`Oi${nome}! Aqui é a ${c.nomeIA} 😊`, "Como posso te ajudar hoje?"] };

  // Material: o cliente pediu algo que combina com o título de um material ainda não enviado.
  const material = c.materiais.find((m) => !m.enviado && /apresenta|material|catalogo|mais informac|me manda|pdf|detalhes/.test(t) && normalizarTexto(m.titulo + " " + m.quando).split(" ").some((p) => p.length > 4 && t.includes(p)))
    ?? c.materiais.find((m) => !m.enviado && /apresentacao|material|catalogo/.test(t));
  if (material) return { ...base, responder: true, partes: [`Claro${nome}! Vou te mandar agora: ${material.titulo}.`, "Dá uma olhada com calma e me conta o que achou?"], enviar_materiais: [material.id] };

  // Busca simples nos trechos da base por palavras em comum.
  const palavras = new Set(t.split(" ").filter((p) => p.length > 3));
  const melhor = c.trechos.map((tr) => ({ tr, pts: normalizarTexto(tr.texto).split(" ").filter((p) => palavras.has(p)).length })).sort((a, b) => b.pts - a.pts)[0];
  if (melhor && melhor.pts > 0) {
    const frases = melhor.tr.texto.split(/(?<=[.!?])\s+/).slice(0, 2);
    const proximo = classificacao.lead_quente ? "Quer que eu marque uma conversa rápida com um consultor?" : "Posso te ajudar com mais alguma coisa?";
    return { ...base, responder: true, partes: [...frases, proximo], fontes: [melhor.tr.id], oferecer_reuniao: classificacao.lead_quente, etiquetas: /preco|valor|custa/.test(t) ? ["Orçamento enviado"] : [] };
  }
  if (c.qtdCliente >= 3 && /nao entendi|nao era isso|nao resolveu/.test(t))
    return { ...base, responder: true, partes: ["Vou chamar alguém da equipe pra te ajudar melhor, só um instante."], transferir: { motivo: "duas tentativas sem solução" } };
  return { ...base, responder: true, partes: ["Boa pergunta! Vou confirmar essa informação com a equipe pra não te passar nada errado.", "Só um instante."], transferir: { motivo: "informação fora da base de conhecimento" } };
}

function instrucao(req: PedidoGerar) {
  const c = contexto(req);
  const pedido = normalizarTexto([...req.historico].reverse().find((m) => m.papel === "equipe")?.texto ?? "");
  const classe = classificar(c.tudo);
  const nome = c.primeiroNome ? `, ${c.primeiroNome}` : "";
  const vazio = { alternativa: null, mensagens_cliente: [] as string[], agendar_retorno: null as string | null, etiquetas: [] as string[], enviar_materiais: [] as string[] };
  if (/resum/.test(pedido)) return { ...vazio, decisao: "executar", explicacao: `Resumo: cliente interessado em ${classe.interesse.replace("_", " ")}; nota ${classe.nota} (${classe.temperatura}). ${classe.motivo}.` };
  if (/desconto/.test(pedido) && classe.lead_quente && !/preco|valor|custa/.test(normalizarTexto(c.tudo)))
    return { ...vazio, decisao: "discordar", explicacao: "O lead está muito quente e ainda nem falou de preço. Dar desconto agora pode reduzir a margem sem necessidade.", alternativa: "Oferecer reunião com consultor", mensagens_cliente: [`Que bom saber disso${nome}!`, "Que tal uma conversa rápida com um consultor pra te mostrar tudo certinho?"] };
  if (/(dar um tempo|pausa|amanha|depois)/.test(pedido)) {
    if (classe.lead_quente) return { ...vazio, decisao: "discordar", explicacao: "O cliente acabou de dar um sinal forte de compra; pausar agora pode esfriar o lead.", alternativa: "Seguir agora e oferecer reunião", mensagens_cliente: ["Posso te ajudar a dar o próximo passo agora mesmo?"] };
    return { ...vazio, decisao: "executar", explicacao: "Despedida enviada e retorno agendado para amanhã.", mensagens_cliente: [`Vou deixar você à vontade${nome}!`, "Amanhã te chamo pra gente continuar, combinado? Até lá 👋"], agendar_retorno: "amanhã" };
  }
  if (/(manda|envia).*(apresenta|material|arquivo|catalogo)/.test(pedido)) {
    const m = c.materiais.find((x) => normalizarTexto(x.titulo).split(" ").some((p) => p.length > 4 && pedido.includes(p))) ?? c.materiais[0];
    if (!m) return { ...vazio, decisao: "recusar", explicacao: "Não há material cadastrado para enviar. Cadastre em Agente de IA → Materiais." };
    return { ...vazio, decisao: "executar", explicacao: `Enviado: ${m.titulo}.`, mensagens_cliente: [`${c.primeiroNome ? c.primeiroNome + ", " : ""}vou te mandar ${m.titulo.toLowerCase()} pra você conhecer melhor.`], enviar_materiais: [m.id] };
  }
  if (/reuniao/.test(pedido)) return { ...vazio, decisao: "executar", explicacao: "Reunião oferecida ao cliente.", mensagens_cliente: ["Que tal uma conversa rápida com um dos nossos consultores? Posso ver um horário pra você."] };
  if (/formal/.test(pedido)) return { ...vazio, decisao: "executar", explicacao: "Passarei a usar um tom mais formal.", mensagens_cliente: [] };
  if (/(senha|cartao|cpf de outra)/.test(pedido)) return { ...vazio, decisao: "recusar", explicacao: "Não posso pedir senhas ou dados de cartão ao cliente (regras do Agente e LGPD)." };
  return { ...vazio, decisao: "executar", explicacao: "Pedido executado.", mensagens_cliente: [pedido.includes("pergunt") ? `${c.primeiroNome ? c.primeiroNome + ", " : ""}posso te fazer uma pergunta rápida? ${req.historico.at(-1)?.texto.replace(/^.*pergunte?\s*(se)?/i, "").trim()}` : "Certo!"] };
}
