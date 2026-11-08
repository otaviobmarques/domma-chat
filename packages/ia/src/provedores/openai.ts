import { custoEstimado } from "../precos.ts";
import { comTempoLimite, ErroProvedor, type ConfigProvedor, type IAProvider, type PedidoGerar, type RespostaGerar } from "../tipos.ts";

/** ChatGPT (OpenAI) e qualquer API compatível com o padrão OpenAI (OpenRouter, DeepSeek, Groq...). */
export class ProvedorOpenAI implements IAProvider {
  readonly nome: string;
  private base: string;
  constructor(private cfg: ConfigProvedor) {
    if (!cfg.chave) throw new ErroProvedor(`${cfg.provedor} sem chave de API`, false);
    this.nome = cfg.provedor;
    this.base = (cfg.enderecoApi || "https://api.openai.com/v1").replace(/\/$/, "");
  }

  private async post(caminho: string, corpo: unknown, ms: number, form?: FormData) {
    const ctrl = new AbortController();
    const r = await comTempoLimite(
      fetch(this.base + caminho, {
        method: "POST",
        signal: ctrl.signal,
        headers: form ? { Authorization: `Bearer ${this.cfg.chave}` } : { Authorization: `Bearer ${this.cfg.chave}`, "Content-Type": "application/json" },
        body: form ?? JSON.stringify(corpo),
      }),
      ms, this.nome,
    ).catch((e) => { ctrl.abort(); throw e; });
    if (r.status === 401 || r.status === 403) throw new ErroProvedor(`${this.nome}: chave inválida`, false);
    if (!r.ok) throw new ErroProvedor(`${this.nome}: erro ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json() as Promise<any>;
  }

  async gerar(req: PedidoGerar): Promise<RespostaGerar> {
    const messages: any[] = [{ role: "system", content: req.sistema + (req.esquema ? `\n\nResponda SOMENTE com um objeto JSON válido neste esquema: ${JSON.stringify(req.esquema)}` : "") }];
    for (const m of req.historico) {
      const role = m.papel === "assistente" ? "assistant" : "user";
      const texto = m.papel === "equipe" ? `[nota da equipe] ${m.texto}` : m.texto;
      messages.push(m.imagem
        ? { role, content: [{ type: "text", text: texto }, { type: "image_url", image_url: { url: `data:${m.imagem.mime};base64,${m.imagem.base64}` } }] }
        : { role, content: texto });
    }
    const j = await this.post("/chat/completions", {
      model: this.cfg.modelo, messages, max_tokens: req.maxTokens ?? 2000,
      ...(req.esquema ? { response_format: { type: "json_object" } } : {}),
    }, req.tempoLimiteMs);
    const ent = j.usage?.prompt_tokens ?? 0, sai = j.usage?.completion_tokens ?? 0;
    return { texto: j.choices?.[0]?.message?.content ?? "", tokensEntrada: ent, tokensSaida: sai, custo: custoEstimado(this.cfg.modelo, ent, sai) };
  }

  async transcrever(audio: Buffer, mime: string, ms: number): Promise<RespostaGerar> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), "audio." + (mime.split("/")[1]?.split(";")[0] || "ogg"));
    form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1");
    form.append("language", "pt");
    const j = await this.post("/audio/transcriptions", null, ms, form);
    return { texto: j.text ?? "", tokensEntrada: 0, tokensSaida: 0, custo: 0 };
  }

  async lerImagem(img: Buffer, mime: string, pergunta: string, ms: number): Promise<RespostaGerar> {
    return this.gerar({ sistema: "Descreva objetivamente a imagem e transcreva dados de documentos.", historico: [{ papel: "cliente", texto: pergunta, imagem: { base64: img.toString("base64"), mime } }], tempoLimiteMs: ms });
  }
}
