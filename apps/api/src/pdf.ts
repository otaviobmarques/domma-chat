import PDFDocument from "pdfkit";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PDFs com a identidade da Domma, em PÁGINA ÚNICA contínua (sem quebra de página):
 * desenha uma vez numa folha muito alta para medir, e redesenha numa folha da altura exata.
 */
const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
export const COR = {
  marinho: "#1A0E36", roxo: "#705AFB", roxoEscuro: "#5B45E0", lavanda: "#F4F2FF", lavandaBorda: "#E4DFFF", texto: "#241B3D", cinza: "#6B6585",
  linha: "#ECE9F5", vermelho: "#E5484D", laranja: "#F08C2E", azul: "#3E8BEA", verde: "#1F9D6B", amarelo: "#F5B92E", branco: "#FFFFFF",
};
const LARGURA = 595.28; // A4
const MARGEM = 36;
export const UTIL = LARGURA - MARGEM * 2;

type Doc = PDFKit.PDFDocument;
export type Desenho = (d: Pincel) => void;

/** Remove caracteres que a fonte não desenha (emojis), mantendo acentos. */
export const limpar = (t: unknown) => String(t ?? "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").replace(/[^\x09\x0A\x0D\x20-\x7E -ſ–—‘-”•…€→⇄]/g, "");

export class Pincel {
  y = 0;
  constructor(public doc: Doc) {}
  fonte(peso: 400 | 600 | 800, tam: number, cor = COR.texto) { this.doc.font(`M${peso}`).fontSize(tam).fillColor(cor); return this; }
  altura(texto: string, largura: number, peso: 400 | 600 | 800, tam: number, gap = 1) { this.fonte(peso, tam); return this.doc.heightOfString(limpar(texto) || " ", { width: largura, lineGap: gap }); }
  texto(texto: unknown, x: number, y: number, o: { largura?: number; peso?: 400 | 600 | 800; tam?: number; cor?: string; alinhar?: "left" | "right" | "center"; espaco?: number; gap?: number } = {}) {
    this.fonte(o.peso ?? 400, o.tam ?? 9.5, o.cor ?? COR.texto);
    this.doc.text(limpar(texto), x, y, { width: o.largura, align: o.alinhar ?? "left", characterSpacing: o.espaco ?? 0, lineGap: o.gap ?? 1 });
    return this.doc.y;
  }
  caixa(x: number, y: number, w: number, h: number, o: { fundo?: string; borda?: string; raio?: number; tracejado?: boolean } = {}) {
    const d = this.doc;
    d.save().roundedRect(x, y, w, h, o.raio ?? 8);
    if (o.tracejado) d.dash(3, { space: 3 });
    if (o.fundo && o.borda) d.fillAndStroke(o.fundo, o.borda); else if (o.fundo) d.fill(o.fundo); else if (o.borda) d.lineWidth(0.8).stroke(o.borda);
    d.undash().restore();
  }
  ponto(x: number, y: number, cor: string, r = 3) { this.doc.save().circle(x, y, r).fill(cor).restore(); }
  /** Título de seção no padrão do painel: rótulo roxo espaçado + título. */
  secao(rotulo: string, titulo?: string) {
    this.y += 16;
    this.texto(rotulo.toUpperCase(), MARGEM, this.y, { peso: 800, tam: 7.5, cor: COR.roxo, espaco: 1.6 });
    this.y += 12;
    if (titulo) { this.texto(titulo, MARGEM, this.y, { peso: 800, tam: 13, cor: COR.marinho }); this.y += 20; }
  }
  /** Cartões de indicador, no máximo 3 por linha; o número encolhe para caber. */
  cartoes(itens: { rotulo: string; valor: string; nota?: string; destaque?: boolean }[]) {
    const porLinha = Math.min(3, itens.length), gap = 8, w = (UTIL - gap * (porLinha - 1)) / porLinha, h = 64;
    for (let i = 0; i < itens.length; i += porLinha) {
      itens.slice(i, i + porLinha).forEach((it, j) => {
        const x = MARGEM + j * (w + gap);
        this.caixa(x, this.y, w, h, { fundo: it.destaque ? "#FFF7EC" : COR.branco, borda: it.destaque ? COR.laranja : COR.lavandaBorda });
        this.texto(it.rotulo, x + 12, this.y + 10, { largura: w - 24, tam: 7.8, cor: COR.cinza });
        let tam = 18;
        this.fonte(800, tam);
        while (tam > 9 && this.doc.widthOfString(limpar(it.valor)) > w - 24) { tam -= 1; this.fonte(800, tam); }
        this.texto(it.valor, x + 12, this.y + 23 + (18 - tam) / 2, { largura: w - 24, peso: 800, tam, cor: COR.marinho });
        if (it.nota) this.texto(it.nota, x + 12, this.y + 47, { largura: w - 24, tam: 7, cor: it.destaque ? COR.laranja : COR.cinza });
      });
      this.y += h + (i + porLinha < itens.length ? gap : 0);
    }
  }
  /** Tabela simples com cabeçalho lavanda e linhas zebradas. Linhas nunca são cortadas (página única). */
  tabela(colunas: { titulo: string; largura: number; alinhar?: "left" | "right" | "center" }[], linhas: (string | number)[][], vazio = "Sem dados no período.") {
    const total = colunas.reduce((s, c) => s + c.largura, 0);
    const ws = colunas.map((c) => (c.largura / total) * UTIL);
    this.caixa(MARGEM, this.y, UTIL, 20, { fundo: COR.lavanda, raio: 5 });
    let x = MARGEM;
    colunas.forEach((c, i) => { this.texto(c.titulo, x + 8, this.y + 6, { largura: ws[i] - 16, peso: 600, tam: 7.5, cor: COR.roxoEscuro, alinhar: c.alinhar }); x += ws[i]; });
    this.y += 22;
    if (!linhas.length) { this.texto(vazio, MARGEM + 8, this.y + 4, { tam: 8.5, cor: COR.cinza }); this.y += 20; return; }
    linhas.forEach((l, li) => {
      const h = Math.max(...l.map((v, i) => this.altura(String(v), ws[i] - 16, 400, 8.5))) + 10;
      if (li % 2 === 1) this.caixa(MARGEM, this.y, UTIL, h, { fundo: "#FAF9FE", raio: 3 });
      let cx = MARGEM;
      l.forEach((v, i) => { this.texto(v, cx + 8, this.y + 5, { largura: ws[i] - 16, tam: 8.5, alinhar: colunas[i].alinhar }); cx += ws[i]; });
      this.y += h;
    });
  }
  /** Barras horizontais (fontes, assuntos). */
  barras(itens: { rotulo: string; valor: number; extra?: string }[], cor = COR.roxo) {
    const max = Math.max(1, ...itens.map((i) => i.valor));
    if (!itens.length) { this.texto("Sem dados.", MARGEM, this.y, { tam: 8.5, cor: COR.cinza }); this.y += 16; return; }
    for (const it of itens) {
      this.texto(it.rotulo, MARGEM, this.y, { largura: 120, tam: 8.5 });
      const bx = MARGEM + 125, bw = UTIL - 125 - 90;
      this.caixa(bx, this.y + 2, bw, 7, { fundo: COR.linha, raio: 3.5 });
      this.caixa(bx, this.y + 2, Math.max(4, (bw * it.valor) / max), 7, { fundo: cor, raio: 3.5 });
      this.texto(`${it.valor}${it.extra ? " · " + it.extra : ""}`, MARGEM + UTIL - 85, this.y, { largura: 85, tam: 8, peso: 600, alinhar: "right" });
      this.y += 17;
    }
  }
}

function cabecalho(p: Pincel, titulo: string, subtitulo: string, conta: string) {
  const d = p.doc;
  d.save().rect(0, 0, LARGURA, 92).fill(COR.marinho).restore();
  d.save().circle(LARGURA - 40, 10, 70).fillOpacity(0.18).fill(COR.roxo).restore();
  d.image(path.join(ASSETS, "logo-branco.png"), MARGEM, 26, { height: 30 });
  p.texto(titulo, MARGEM + 200, 24, { largura: UTIL - 200, peso: 800, tam: 17, cor: COR.branco, alinhar: "right" });
  p.texto(subtitulo, MARGEM + 200, 48, { largura: UTIL - 200, tam: 8.5, cor: "#CFC8F5", alinhar: "right" });
  p.texto(`Conta: ${conta}`, MARGEM + 200, 62, { largura: UTIL - 200, tam: 8, cor: "#CFC8F5", alinhar: "right" });
  p.y = 100;
}

function rodape(p: Pincel) {
  p.y += 20;
  p.doc.save().moveTo(MARGEM, p.y).lineTo(LARGURA - MARGEM, p.y).lineWidth(0.6).stroke(COR.linha).restore();
  p.y += 8;
  p.texto("Domma Chat · Domma Tecnologia", MARGEM, p.y, { tam: 7.5, cor: COR.cinza });
  p.texto(`Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · documento interno`, MARGEM, p.y, { largura: UTIL, tam: 7.5, cor: COR.cinza, alinhar: "right" });
  p.y += 22;
}

function novoDoc(altura: number, titulo: string) {
  const doc = new PDFDocument({ size: [LARGURA, altura], margin: 0, autoFirstPage: true, info: { Title: titulo, Author: "Domma Chat", Creator: "Domma Tecnologia" } });
  doc.registerFont("M400", path.join(ASSETS, "manrope-400.woff"));
  doc.registerFont("M600", path.join(ASSETS, "manrope-600.woff"));
  doc.registerFont("M800", path.join(ASSETS, "manrope-800.woff"));
  return doc;
}

/** Gera o PDF em página única. */
export async function gerarPdf(meta: { titulo: string; subtitulo: string; conta: string }, corpo: Desenho): Promise<Buffer> {
  // 1ª passada: mede a altura total.
  const medida = novoDoc(14400, meta.titulo);
  const pm = new Pincel(medida);
  cabecalho(pm, meta.titulo, meta.subtitulo, meta.conta); corpo(pm); rodape(pm);
  const altura = Math.ceil(Math.max(pm.y, 400));
  medida.end();
  // 2ª passada: folha da altura exata (até o limite do formato PDF, ~200 polegadas).
  // Conteúdo muito longo (> ~5 m): reduz a escala para continuar em uma página só.
  const escala = altura > 14400 ? 14400 / altura : 1;
  const doc = escala < 1 ? new PDFDocument({ size: [LARGURA * escala, 14400], margin: 0, info: { Title: meta.titulo, Author: "Domma Chat" } }) : novoDoc(altura, meta.titulo);
  if (escala < 1) { doc.registerFont("M400", path.join(ASSETS, "manrope-400.woff")); doc.registerFont("M600", path.join(ASSETS, "manrope-600.woff")); doc.registerFont("M800", path.join(ASSETS, "manrope-800.woff")); doc.scale(escala); }
  const partes: Buffer[] = [];
  doc.on("data", (b: Buffer) => partes.push(b));
  const fim = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(partes))));
  doc.save().rect(0, 0, LARGURA, altura).fill("#FFFFFF").restore();
  const p = new Pincel(doc);
  cabecalho(p, meta.titulo, meta.subtitulo, meta.conta); corpo(p); rodape(p);
  doc.end();
  return fim;
}

export { MARGEM, LARGURA };
