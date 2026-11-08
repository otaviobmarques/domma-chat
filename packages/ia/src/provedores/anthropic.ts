import Anthropic from "@anthropic-ai/sdk";
import { custoEstimado } from "../precos.ts";
import { ErroProvedor, type ConfigProvedor, type IAProvider, type PedidoGerar, type RespostaGerar } from "../tipos.ts";

/** Claude (Anthropic) pelo SDK oficial. Modelo padrão: claude-opus-5-5 (configurável no painel). */
export class ProvedorAnthropic implements IAProvider {
  readonly nome = "anthropic";
  private client: Anthropic;
  constructor(private cfg: ConfigProvedor) {
    if (!cfg.chave) throw new ErroProvedor("Claude sem chave de API", false);
    this.client = new Anthropic({ apiKey: cfg.chave, maxRetries: 0 });
  }

  async gerar(req: PedidoGerar): Promise<RespostaGerar> {
    const messages = juntarPapeis(req.historico);
    try {
      const resp = await this.client.beta.messages.create(
        {
          model: this.cfg.modelo,
          max_tokens: req.maxTokens ?? 4000,
          system: req.sistema,
          messages,
          // Atendimento em tempo real: esforço baixo para responder rápido.
          output_config: {
            effort: "low",
            ...(req.esquema ? { format: { type: "json_schema", schema: req.esquema } } : {}),
          },
          // Se o modelo recusar por política, o próprio servidor tenta outro modelo Claude na mesma chamada.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        } as any,
        { timeout: req.tempoLimiteMs },
      );
      if (resp.stop_reason === "refusal") throw new ErroProvedor("Claude recusou a solicitação");
      const texto = resp.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
      const ent = resp.usage.input_tokens ?? 0, sai = resp.usage.output_tokens ?? 0;
      return { texto, tokensEntrada: ent, tokensSaida: sai, custo: custoEstimado(this.cfg.modelo, ent, sai) };
    } catch (e) {
      if (e instanceof ErroProvedor) throw e;
      if (e instanceof Anthropic.AuthenticationError) throw new ErroProvedor("Claude: chave inválida", false);
      if (e instanceof Anthropic.RateLimitError) throw new ErroProvedor("Claude: limite de requisições");
      if (e instanceof Anthropic.APIConnectionTimeoutError) throw new ErroProvedor("Claude: tempo esgotado");
      if (e instanceof Anthropic.APIError) throw new ErroProvedor(`Claude: erro ${e.status} ${e.message}`);
      throw new ErroProvedor(`Claude: ${(e as Error).message}`);
    }
  }

  async lerImagem(img: Buffer, mime: string, pergunta: string, tempoLimiteMs: number): Promise<RespostaGerar> {
    return this.gerar({
      sistema: "Você lê imagens enviadas por clientes no WhatsApp e descreve objetivamente o que há nelas, transcrevendo dados de documentos (placa, nomes, números).",
      historico: [{ papel: "cliente", texto: pergunta, imagem: { base64: img.toString("base64"), mime } }],
      tempoLimiteMs,
      maxTokens: 1500,
    });
  }
}

/** A API exige alternância user/assistant: agrupa mensagens seguidas do mesmo lado. */
function juntarPapeis(hist: PedidoGerar["historico"]) {
  const out: { role: "user" | "assistant"; content: any[] }[] = [];
  for (const m of hist) {
    const role = m.papel === "assistente" ? "assistant" : "user";
    const blocos: any[] = [];
    if (m.imagem) blocos.push({ type: "image", source: { type: "base64", media_type: m.imagem.mime, data: m.imagem.base64 } });
    blocos.push({ type: "text", text: m.papel === "equipe" ? `[nota da equipe] ${m.texto}` : m.texto || "(sem texto)" });
    const ult = out[out.length - 1];
    if (ult && ult.role === role) ult.content.push(...blocos);
    else out.push({ role, content: blocos });
  }
  if (out[0]?.role === "assistant") out.unshift({ role: "user", content: [{ type: "text", text: "(início da conversa)" }] });
  return out;
}
