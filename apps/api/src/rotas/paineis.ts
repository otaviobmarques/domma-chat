import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q, q1 } from "@domma/db";
import { conversaCompleta } from "@domma/core";
import { autenticar, naoEncontrado } from "../app.ts";
import { dadosDashboard, dadosRelatorio, periodo } from "../dados-paineis.ts";
import { COR, gerarPdf, limpar, MARGEM, UTIL, type Pincel } from "../pdf.ts";

const brl = (v: number) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (v: number) => "US$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const hora = (d: string | Date) => new Date(d).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const dataHora = (d: string | Date) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const data = (d: string | Date) => new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const seg = (s: number) => (s < 60 ? `${s} s` : `${Math.round(s / 60)} min`);
const FONTE: Record<string, string> = { google_ads: "Google Ads", meta_ads: "Meta Ads", site: "Site", indicacao: "Indicação", lista: "Lista", organico: "Orgânico", outro: "Outro" };
const TEMP: Record<string, string> = { quente: COR.vermelho, morno: COR.laranja, frio: COR.azul };
const csv = (linhas: (string | number)[][]) => "﻿" + linhas.map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
const nomeConta = async (id: string) => (await q1<{ nome: string }>("SELECT nome FROM contas WHERE id = $1", [id]))?.nome ?? "";
const arquivo = (nome: string) => nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "-").toLowerCase();

export async function rotasPaineis(app: FastifyInstance) {
  app.addHook("preHandler", autenticar);

  app.get("/api/v1/dashboard", async (req) => dadosDashboard(req.usuario.contaId, req.usuario));
  app.get("/api/v1/relatorios", async (req) => {
    const { de, ate } = periodo(req.query as any);
    return dadosRelatorio(req.usuario.contaId, de, ate);
  });

  // ---------- Dashboard em PDF ----------
  app.get("/api/v1/dashboard.pdf", async (req, reply) => {
    const d = await dadosDashboard(req.usuario.contaId, req.usuario);
    const conta = await nomeConta(req.usuario.contaId);
    const i = d.indicadores;
    const pdf = await gerarPdf({ titulo: "Dashboard ao vivo", subtitulo: `Retrato de ${dataHora(d.gerado_em)}`, conta }, (p) => {
      p.secao("Ao vivo", "Assim está a operação agora");
      p.cartoes([
        { rotulo: "Conversas abertas", valor: String(i.abertas), nota: "agora" },
        { rotulo: "IA atendendo", valor: String(i.ia), nota: i.abertas ? `${Math.round((100 * i.ia) / i.abertas)}% das abertas` : "" },
        { rotulo: "Esperando humano", valor: String(i.esperando), nota: `maior espera: ${i.maior_espera_min} min`, destaque: i.esperando > 0 },
        { rotulo: "Resolvidas pela IA hoje", valor: `${i.pct_ia}%`, nota: `${i.conversas_hoje} conversas hoje` },
        { rotulo: "Vendas hoje", valor: brl(i.vendas_hoje), nota: `${i.pagamentos_hoje} pagamentos` },
        { rotulo: "Reuniões hoje", valor: String(i.reunioes_hoje) },
      ]);
      p.secao("Precisa de ação", "Alertas");
      p.tabela([{ titulo: "Nível", largura: 1 }, { titulo: "Alerta", largura: 3 }, { titulo: "Detalhe", largura: 4 }],
        d.alertas.map((a: any) => [({ urgente: "Urgente", atencao: "Atenção", info: "Info" } as any)[a.nivel], a.titulo, a.detalhe ?? ""]), "Nenhum alerta aberto. Tudo certo por aqui.");
      p.secao("Fila", "Esperando humano");
      p.tabela([{ titulo: "Cliente", largura: 2 }, { titulo: "Motivo", largura: 4 }, { titulo: "Espera", largura: 1, alinhar: "right" }], d.esperandoHumano.map((e: any) => [e.nome ?? "-", e.motivo_transferencia ?? "-", `${e.min} min`]), "Ninguém esperando.");
      p.secao("Oportunidades", "Leads quentes");
      p.tabela([{ titulo: "Contato", largura: 2 }, { titulo: "Interesse", largura: 2 }, { titulo: "Fonte", largura: 1.4 }, { titulo: "Motivo", largura: 4 }, { titulo: "Nota", largura: 0.8, alinhar: "right" }],
        d.leadsQuentes.map((l: any) => [l.nome ?? "-", l.interesse ?? "-", FONTE[l.fonte_ultima] ?? l.fonte_ultima ?? "-", l.motivo_classificacao ?? "", l.nota ?? ""]), "Nenhum lead quente agora.");
      p.secao("Agenda e caixa do dia", "Reuniões, pagamentos e retornos");
      p.tabela([{ titulo: "Hora", largura: 1 }, { titulo: "Reunião", largura: 3 }, { titulo: "Vendedor", largura: 2 }, { titulo: "Formato", largura: 1.4 }],
        d.reunioes.map((r: any) => [hora(r.inicio), r.contato ?? "-", r.vendedor ?? "-", ({ meet: "Google Meet", ligacao: "Ligação", presencial: "Presencial" } as any)[r.formato] ?? r.formato]), "Sem reuniões hoje.");
      p.y += 8;
      p.tabela([{ titulo: "Pagamento", largura: 3 }, { titulo: "Descrição", largura: 3 }, { titulo: "Valor", largura: 1.4, alinhar: "right" }, { titulo: "Status", largura: 1.4 }],
        d.pagamentos.map((c: any) => [c.contato ?? "-", c.descricao ?? "", brl(c.valor), ({ paga: "Pago", pendente: "Aguardando", aguardando_aprovacao: "Aprovação", falhou: "Falhou", cancelada: "Cancelado" } as any)[c.status]]), "Sem cobranças hoje.");
      p.y += 8;
      p.tabela([{ titulo: "Retorno", largura: 1 }, { titulo: "Cliente", largura: 2 }, { titulo: "Quem retoma", largura: 1.4 }, { titulo: "Contexto", largura: 4 }],
        d.retornos.map((r: any) => [hora(r.quando), r.nome ?? "-", r.executor === "ia" ? "IA" : "Lembrete p/ equipe", r.resumo_ia ?? ""]), "Sem retornos para hoje.");
      p.secao("Origem", "Contatos de hoje por fonte");
      p.barras(d.fontes.map((f: any) => ({ rotulo: FONTE[f.fonte] ?? f.fonte, valor: f.contatos, extra: `${f.quentes} quentes` })));
      p.secao("Conversas", "Do que estão falando hoje");
      p.barras(d.assuntos.map((a: any) => ({ rotulo: a.assunto, valor: a.n })), COR.roxoEscuro);
      const h = d.humor ?? { positivo: 0, neutro: 0, negativo: 0 }, tot = h.positivo + h.neutro + h.negativo || 1;
      p.y += 6; p.texto("Humor dos clientes", MARGEM, p.y, { peso: 600, tam: 9 }); p.y += 14;
      let x = MARGEM;
      for (const [k, cor] of [["positivo", COR.verde], ["neutro", "#A29DB8"], ["negativo", COR.vermelho]] as const) { const w = (UTIL * h[k]) / tot; if (w > 0) p.caixa(x, p.y, w, 9, { fundo: cor, raio: 2 }); x += w; }
      p.y += 14; p.texto(`Positivo ${Math.round((100 * h.positivo) / tot)}% · Neutro ${Math.round((100 * h.neutro) / tot)}% · Negativo ${Math.round((100 * h.negativo) / tot)}%`, MARGEM, p.y, { tam: 8, cor: COR.cinza }); p.y += 12;
      p.secao("Infraestrutura", "Saúde do sistema");
      const st = (s: string) => ({ conectada: "Conectado", caiu: "Caiu", reconectando: "Reconectando", precisa_atencao: "Precisa de atenção", aguardando_qr: "Aguardando QR", desconectada: "Desconectado" } as any)[s] ?? s;
      p.tabela([{ titulo: "Componente", largura: 1.5 }, { titulo: "Nome", largura: 3 }, { titulo: "Situação", largura: 3 }], [
        ...d.saude.conexoes.map((c: any) => [`WhatsApp ${c.tipo === "oficial" ? "API Oficial" : c.tipo === "qr" ? "QR Code" : "Simulador"}`, c.nome, st(c.status)]),
        ...d.saude.provedores.map((pr: any, idx: number) => [idx === 0 ? "IA principal" : `IA backup ${idx}`, `${pr.nome} (${pr.modelo})`, !pr.ativo ? "Desligado" : pr.degradado_ate && new Date(pr.degradado_ate) > new Date() ? "Com falha" : `Respondendo${pr.ultimo_tempo_ms ? " · " + (pr.ultimo_tempo_ms / 1000).toFixed(1) + " s" : ""}`]),
        ...d.saude.gateways.map((g: any) => ["Pagamentos", g.tipo, `Operando (${g.ambiente})`]),
        ["Agenda", "Google Agenda", `${d.saude.agenda} vendedor(es) conectado(s)`],
      ]);
    });
    return reply.type("application/pdf").header("Content-Disposition", `attachment; filename="dashboard-${new Date().toISOString().slice(0, 10)}.pdf"`).send(pdf);
  });

  // ---------- Relatórios (números do negócio) em PDF e CSV ----------
  app.get("/api/v1/relatorios.pdf", async (req, reply) => {
    const { de, ate } = periodo(req.query as any);
    const r = await dadosRelatorio(req.usuario.contaId, de, ate);
    const conta = await nomeConta(req.usuario.contaId);
    const s = r.resumo;
    const pdf = await gerarPdf({ titulo: "Números do negócio", subtitulo: `Período: ${data(de)} a ${data(ate)}`, conta }, (p) => {
      p.secao("Resumo do período", "Resultados");
      p.cartoes([
        { rotulo: "Conversas", valor: String(s.conversas) },
        { rotulo: "Resolvidas só pela IA", valor: `${s.pct_so_ia}%` },
        { rotulo: "1ª resposta IA / equipe", valor: `${seg(s.primeira_resposta_ia_s)}`, nota: `equipe: ${seg(s.primeira_resposta_humano_s)}` },
        { rotulo: "Reuniões marcadas", valor: String(s.reunioes) },
        { rotulo: "Vendas pela conversa", valor: brl(s.vendas_total), nota: `${s.vendas_n} pagamentos` },
        { rotulo: "Custo de IA", valor: usd(s.custo_ia), nota: `${usd(s.custo_medio_conversa)} por conversa` },
      ]);
      p.secao("Volume", "Conversas por dia (IA x humano)");
      graficoDias(p, r.porDia);
      p.secao("Origem", "Fontes de dados");
      const top = (k: "contatos" | "fechamentos") => [...r.fontes].sort((a, b) => b[k] - a[k])[0];
      const pago = [...r.fontes].filter((f) => ["google_ads", "meta_ads"].includes(f.fonte)).sort((a, b) => b.taxa - a.taxa)[0];
      p.cartoes([
        { rotulo: "Mais gera contato", valor: top("contatos") ? FONTE[top("contatos").fonte] ?? top("contatos").fonte : "-" },
        { rotulo: "Mais fecha", valor: top("fechamentos")?.fechamentos ? FONTE[top("fechamentos").fonte] ?? "-" : "-" },
        { rotulo: "Melhor anúncio pago", valor: pago ? FONTE[pago.fonte] : "-", nota: pago ? `taxa de fechamento ${pago.taxa}%` : "" },
      ]);
      p.y += 10;
      p.tabela([{ titulo: "Fonte", largura: 2 }, { titulo: "Contatos", largura: 1, alinhar: "right" }, { titulo: "Leads quentes", largura: 1.2, alinhar: "right" }, { titulo: "Fechamentos", largura: 1.2, alinhar: "right" }, { titulo: "Taxa", largura: 1, alinhar: "right" }],
        r.fontes.map((f) => [FONTE[f.fonte] ?? f.fonte, f.contatos, f.quentes, f.fechamentos, `${f.taxa}%`]));
      p.y += 8;
      p.tabela([{ titulo: "Campanha", largura: 3 }, { titulo: "Fonte", largura: 1.5 }, { titulo: "Contatos", largura: 1, alinhar: "right" }, { titulo: "Quentes", largura: 1, alinhar: "right" }],
        r.campanhasFonte.map((c) => [c.campanha, FONTE[c.fonte] ?? c.fonte ?? "-", c.contatos, c.quentes]));
      p.secao("Campanhas", "Funil das campanhas");
      p.tabela([{ titulo: "Campanha", largura: 3 }, { titulo: "Enviadas", largura: 1, alinhar: "right" }, { titulo: "Lidas", largura: 1, alinhar: "right" }, { titulo: "Responderam", largura: 1.2, alinhar: "right" }, { titulo: "Fecharam", largura: 1, alinhar: "right" }],
        r.campanhas.map((c) => [c.nome, c.enviadas, c.lidas, c.responderam, c.fecharam]), "Nenhuma campanha no período.");
      p.secao("Equipe", "Desempenho por pessoa (incluindo a IA)");
      p.tabela([{ titulo: "Pessoa", largura: 2.5 }, { titulo: "Conversas atendidas", largura: 1.5, alinhar: "right" }, { titulo: "Reuniões", largura: 1, alinhar: "right" }, { titulo: "Vendas", largura: 1.5, alinhar: "right" }],
        r.pessoas.map((x) => [x.nome, x.atendidas, x.reunioes, brl(x.vendas)]));
      p.secao("Custos", "Custos do período");
      p.tabela([{ titulo: "Provedor de IA", largura: 3 }, { titulo: "Chamadas", largura: 1, alinhar: "right" }, { titulo: "Falhas", largura: 1, alinhar: "right" }, { titulo: "Custo estimado", largura: 1.5, alinhar: "right" }],
        r.custos.map((c) => [c.provedor ?? "-", c.chamadas, c.falhas, usd(c.custo)]), "Sem uso de IA no período.");
      p.y += 6;
      p.texto("Custos de IA estimados pelo uso de tokens. Mensagens da Meta e taxas dos gateways seguem a fatura de cada fornecedor.", MARGEM, p.y, { largura: UTIL, tam: 7.5, cor: COR.cinza });
      p.y += 12;
    });
    return reply.type("application/pdf").header("Content-Disposition", `attachment; filename="numeros-${de.toISOString().slice(0, 10)}-a-${ate.toISOString().slice(0, 10)}.pdf"`).send(pdf);
  });

  app.get("/api/v1/relatorios.csv", async (req, reply) => {
    const { de, ate } = periodo(req.query as any);
    const r = await dadosRelatorio(req.usuario.contaId, de, ate);
    const s = r.resumo;
    const linhas: (string | number)[][] = [
      ["Relatório Domma Chat", `${data(de)} a ${data(ate)}`], [],
      ["Indicador", "Valor"], ["Conversas", s.conversas], ["% resolvidas só pela IA", s.pct_so_ia], ["1ª resposta IA (s)", s.primeira_resposta_ia_s], ["1ª resposta equipe (s)", s.primeira_resposta_humano_s],
      ["Reuniões", s.reunioes], ["Vendas (R$)", s.vendas_total.toFixed(2).replace(".", ",")], ["Custo de IA (US$)", s.custo_ia.toFixed(4).replace(".", ",")], [],
      ["Dia", "Conversas com IA", "Conversas com humano"], ...r.porDia.map((d) => [d.dia, d.ia, d.humano]), [],
      ["Fonte", "Contatos", "Leads quentes", "Fechamentos", "Taxa %"], ...r.fontes.map((f) => [FONTE[f.fonte] ?? f.fonte, f.contatos, f.quentes, f.fechamentos, f.taxa]), [],
      ["Pessoa", "Atendidas", "Reuniões", "Vendas (R$)"], ...r.pessoas.map((p) => [p.nome, p.atendidas, p.reunioes, p.vendas.toFixed(2).replace(".", ",")]), [],
      ["Campanha", "Enviadas", "Lidas", "Responderam", "Fecharam"], ...r.campanhas.map((c) => [c.nome, c.enviadas, c.lidas, c.responderam, c.fecharam]),
    ];
    return reply.type("text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="numeros-${de.toISOString().slice(0, 10)}.csv"`).send(csv(linhas));
  });

  // ---------- Exportar conversa (PDF ou TXT) ----------
  app.get("/api/v1/conversas/:id/exportar", async (req, reply) => {
    const c = await conversaCompleta((req.params as any).id);
    if (!c || c.conta_id !== req.usuario.contaId) throw naoEncontrado("conversa");
    const { formato, notas } = z.object({ formato: z.enum(["pdf", "txt"]).default("pdf"), notas: z.enum(["0", "1"]).default("1") }).parse(req.query);
    const msgs = await q<any>(`SELECT m.*, u.nome AS autor_nome, mt.titulo AS material_titulo FROM mensagens m LEFT JOIN usuarios u ON u.id = m.autor_id LEFT JOIN materiais_ia mt ON mt.id = m.material_id
                                WHERE m.conversa_id = $1 AND m.status <> 'cancelada' ${notas === "0" ? "AND m.autor <> 'nota'" : ""} ORDER BY m.criado_em`, [c.id]);
    const agente = await q1<{ nome: string }>("SELECT nome FROM agentes_ia WHERE conta_id = $1", [c.conta_id]);
    const nomeIA = agente?.nome ?? "IA";
    const quem = (m: any) => (m.autor === "cliente" ? c.contato_nome ?? "Cliente" : m.autor === "ia" ? `${nomeIA} (IA)` : m.autor === "humano" ? m.autor_nome ?? "Atendente" : m.autor === "nota" ? `Nota interna${m.autor_nome ? " · " + m.autor_nome : ""}` : "Sistema");
    const corpoMsg = (m: any) => {
      const midia = m.tipo === "audio" ? `[Áudio] ${m.leitura ? "Transcrição: " + m.leitura : ""}` : m.tipo === "imagem" ? `[Foto] ${m.leitura ? "A IA leu: " + m.leitura : ""}` : m.tipo === "documento" ? `[Arquivo] ${m.material_titulo ?? m.leitura ?? ""}` : m.tipo === "reacao" ? `[Reagiu com ${({ "👍": "joinha", "❤️": "coração", "😂": "risada", "🙏": "mãos juntas" } as Record<string, string>)[m.conteudo ?? ""] ?? "emoji"}]` : "";
      return [midia, m.tipo === "reacao" ? "" : m.conteudo].filter(Boolean).join("\n");
    };
    const nomeArq = arquivo(`conversa-${c.contato_nome ?? c.telefone}-${new Date().toISOString().slice(0, 10)}`);
    await q("INSERT INTO eventos_auditoria (conta_id, usuario_id, ator, acao, alvo) VALUES ($1,$2,'usuario','conversa:exportar',$3)", [c.conta_id, req.usuario.id, c.id]);

    if (formato === "txt") {
      const txt = [`Conversa — ${c.contato_nome ?? ""} (+${c.telefone})`, `Conexão: ${c.conexao_nome} · Exportada em ${dataHora(new Date())}`, c.resumo_ia ? `Resumo da IA: ${c.resumo_ia}` : "", "".padEnd(60, "-"),
        ...msgs.map((m) => (m.tipo === "evento" ? `— ${m.conteudo} (${dataHora(m.criado_em)}) —` : `[${dataHora(m.criado_em)}] ${quem(m)}: ${corpoMsg(m)}`))].filter(Boolean).join("\n");
      return reply.type("text/plain; charset=utf-8").header("Content-Disposition", `attachment; filename="${nomeArq}.txt"`).send(txt);
    }

    const conta = await nomeConta(c.conta_id);
    const pdf = await gerarPdf({ titulo: "Histórico da conversa", subtitulo: `${limpar(c.contato_nome ?? "Cliente")} · +${c.telefone}`, conta }, (p) => {
      // Ficha do contato
      p.secao("Contato", c.contato_nome ?? `+${c.telefone}`);
      const ficha: [string, string][] = [["WhatsApp", `+${c.telefone}`], ["Cidade", c.cidade ?? c.dados_extraidos?.cidade ?? "-"], ["Conexão", c.conexao_nome], ["Fila / responsável", `${c.fila ?? "-"} / ${c.responsavel_nome ?? "-"}`],
        ["Fonte", `${FONTE[c.fonte_ultima] ?? c.fonte_ultima ?? "-"}${c.campanha ? " · " + c.campanha : ""}`], ["Entrada", c.entrou_em ? dataHora(c.entrou_em) : "-"], ["Etiquetas", (c.etiquetas ?? []).join(", ") || "-"], ["Modo atual", ({ ia: "IA", aprova: "IA sugere", humano: "Humano" } as any)[c.modo]]];
      const colW = UTIL / 2, y0 = p.y;
      p.caixa(MARGEM, y0, UTIL, Math.ceil(ficha.length / 2) * 18 + 14, { fundo: COR.lavanda, borda: COR.lavandaBorda });
      ficha.forEach(([k, v], i) => { const x = MARGEM + 12 + (i % 2) * colW, y = y0 + 9 + Math.floor(i / 2) * 18; p.texto(k, x, y, { tam: 7.5, cor: COR.cinza }); p.texto(v, x + 85, y, { largura: colW - 105, tam: 8.5, peso: 600 }); });
      p.y = y0 + Math.ceil(ficha.length / 2) * 18 + 14;
      if (c.temperatura || c.resumo_ia) {
        p.secao("Classificação da IA");
        if (c.temperatura) {
          p.ponto(MARGEM + 4, p.y + 5, TEMP[c.temperatura] ?? COR.cinza, 4);
          p.texto(`Lead ${c.temperatura} · nota ${c.nota ?? "-"} · ${c.interesse ?? ""}`, MARGEM + 14, p.y, { peso: 800, tam: 10, cor: TEMP[c.temperatura] ?? COR.texto });
          p.y += 15;
          if (c.motivo_classificacao) { p.y = p.texto(`Por quê: ${c.motivo_classificacao}`, MARGEM, p.y, { largura: UTIL, tam: 8.5, cor: COR.cinza }) + 4; }
        }
        if (c.resumo_ia) { p.y = p.texto(`Resumo: ${c.resumo_ia}`, MARGEM, p.y, { largura: UTIL, tam: 9 }) + 4; }
      }
      p.secao("Mensagens", `${msgs.filter((m) => m.tipo !== "evento").length} mensagens`);
      // Balões
      const larg = UTIL * 0.72;
      let diaAtual = "";
      for (const m of msgs) {
        const dia = data(m.criado_em);
        if (dia !== diaAtual) {
          diaAtual = dia; p.y += 4;
          p.caixa(MARGEM + UTIL / 2 - 40, p.y, 80, 15, { fundo: COR.linha, raio: 7.5 });
          p.texto(dia, MARGEM + UTIL / 2 - 40, p.y + 3.5, { largura: 80, tam: 7.5, peso: 600, cor: COR.cinza, alinhar: "center" });
          p.y += 22;
        }
        if (m.tipo === "evento" || m.autor === "sistema") {
          const h = p.altura(m.conteudo ?? "", UTIL - 120, 400, 7.5);
          p.texto(`${m.conteudo ?? ""} · ${hora(m.criado_em)}`, MARGEM + 60, p.y, { largura: UTIL - 120, tam: 7.5, cor: COR.cinza, alinhar: "center" });
          p.y += h + 10; continue;
        }
        const texto = corpoMsg(m) || " ";
        const direita = m.autor !== "cliente";
        const estilo = m.autor === "cliente" ? { fundo: COR.branco, borda: COR.lavandaBorda, cor: COR.texto, sub: COR.cinza }
          : m.autor === "ia" ? { fundo: "#EEEAFF", borda: "#D9D2FF", cor: COR.texto, sub: COR.roxoEscuro }
          : m.autor === "humano" ? { fundo: COR.marinho, borda: COR.marinho, cor: COR.branco, sub: "#CFC8F5" }
          : { fundo: "#FFFBEA", borda: COR.amarelo, cor: "#6B5313", sub: "#9B7A1C", tracejado: true };
        const hTexto = p.altura(texto, larg - 24, 400, 9);
        const h = hTexto + 30;
        const x = direita ? MARGEM + UTIL - larg : MARGEM;
        p.caixa(x, p.y, larg, h, { fundo: estilo.fundo, borda: estilo.borda, raio: 9, tracejado: (estilo as any).tracejado });
        p.texto(`${quem(m)}${m.autor === "nota" ? " · só a equipe vê" : ""}`, x + 12, p.y + 7, { largura: larg - 80, tam: 7.2, peso: 800, cor: estilo.sub });
        p.texto(hora(m.criado_em), x + larg - 62, p.y + 7, { largura: 50, tam: 7.2, cor: estilo.sub, alinhar: "right" });
        p.texto(texto, x + 12, p.y + 19, { largura: larg - 24, tam: 9, cor: estilo.cor });
        p.y += h + 7;
      }
    });
    return reply.type("application/pdf").header("Content-Disposition", `attachment; filename="${nomeArq}.pdf"`).send(pdf);
  });
}

function graficoDias(p: Pincel, dias: { dia: string; ia: number; humano: number }[]) {
  if (!dias.length) { p.texto("Sem conversas no período.", MARGEM, p.y, { tam: 8.5, cor: COR.cinza }); p.y += 16; return; }
  const h = 110, base = p.y + h, max = Math.max(1, ...dias.map((d) => d.ia + d.humano));
  const slot = UTIL / dias.length, bw = Math.min(26, slot * 0.6);
  p.doc.save().moveTo(MARGEM, base).lineTo(MARGEM + UTIL, base).lineWidth(0.6).stroke(COR.linha).restore();
  dias.forEach((d, i) => {
    const x = MARGEM + i * slot + (slot - bw) / 2;
    const hIa = (h - 14) * (d.ia / max), hHu = (h - 14) * (d.humano / max);
    if (hIa) p.caixa(x, base - hIa, bw, hIa, { fundo: COR.roxo, raio: 2 });
    if (hHu) p.caixa(x, base - hIa - hHu, bw, hHu, { fundo: COR.marinho, raio: 2 });
    if (slot > 22) p.texto(d.dia, MARGEM + i * slot, base + 4, { largura: slot, tam: 6.5, cor: COR.cinza, alinhar: "center" });
  });
  p.y = base + 18;
  p.ponto(MARGEM + 4, p.y + 4, COR.roxo); p.texto("IA", MARGEM + 12, p.y, { tam: 8 });
  p.ponto(MARGEM + 44, p.y + 4, COR.marinho); p.texto("Humano", MARGEM + 52, p.y, { tam: 8 });
  p.y += 14;
}
