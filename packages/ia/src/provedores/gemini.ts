import { custoEstimado } from "../precos.ts";
import { comTempoLimite, ErroProvedor, type ConfigProvedor, type IAProvider, type PedidoGerar, type RespostaGerar } from "../tipos.ts";

/** Gemini (Google) pela API generateContent. */
export class ProvedorGemini implements IAProvider {
  readonly nome = "gemini";
  constructor(private cfg: ConfigProvedor) {
    if (!cfg.chave) throw new ErroProvedor("Gemini sem chave de API", false);
  }

  private async chamar(contents: any[], sistema: string, ms: number, json: boolean): Promise<RespostaGerar> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.cfg.modelo}:generateContent`;
    const r = await comTempoLimite(fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.cfg.chave! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents,
        generationConfig: json ? { responseMimeType: "application/json" } : {},
      }),
    }), ms, "gemini");
    if (r.status === 401 || r.status === 403) throw new ErroProvedor("gemini: chave inválida", false);
    if (!r.ok) throw new ErroProvedor(`gemini: erro ${r.status}`);
    const j: any = await r.json();
    const texto = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    const ent = j.usageMetadata?.promptTokenCount ?? 0, sai = j.usageMetadata?.candidatesTokenCount ?? 0;
    return { texto, tokensEntrada: ent, tokensSaida: sai, custo: custoEstimado(this.cfg.modelo, ent, sai) };
  }

  gerar(req: PedidoGerar) {
    const contents = req.historico.map((m) => ({
      role: m.papel === "assistente" ? "model" : "user",
      parts: [
        ...(m.imagem ? [{ inlineData: { mimeType: m.imagem.mime, data: m.imagem.base64 } }] : []),
        { text: m.papel === "equipe" ? `[nota da equipe] ${m.texto}` : m.texto || "(sem texto)" },
      ],
    }));
    const sistema = req.sistema + (req.esquema ? `\n\nResponda SOMENTE com JSON neste esquema: ${JSON.stringify(req.esquema)}` : "");
    return this.chamar(contents, sistema, req.tempoLimiteMs, !!req.esquema);
  }

  transcrever(audio: Buffer, mime: string, ms: number) {
    return this.chamar([{ role: "user", parts: [{ inlineData: { mimeType: mime.split(";")[0], data: audio.toString("base64") } }, { text: "Transcreva este áudio em português, literalmente." }] }],
      "Você transcreve áudios.", ms, false);
  }

  lerImagem(img: Buffer, mime: string, pergunta: string, ms: number) {
    return this.chamar([{ role: "user", parts: [{ inlineData: { mimeType: mime, data: img.toString("base64") } }, { text: pergunta }] }],
      "Descreva objetivamente a imagem e transcreva dados de documentos.", ms, false);
  }
}
