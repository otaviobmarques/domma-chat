import { z } from "zod";

/** Saída estruturada de cada resposta da IA (seções 2.10 e 6.3). */
export const SaidaResposta = z.object({
  responder: z.boolean(),
  partes: z.array(z.string()),
  transferir: z.object({ motivo: z.string() }).nullable(),
  etiquetas: z.array(z.string()),
  agendar_retorno: z.boolean(),
  oferecer_reuniao: z.boolean(),
  resumo: z.string(),
  sentimento: z.enum(["positivo", "neutro", "negativo"]),
  assunto: z.string(),
  fontes: z.array(z.string()),
  enviar_materiais: z.array(z.string()).default([]),
  classificacao: z.object({
    temperatura: z.enum(["quente", "morno", "frio"]),
    nota: z.number(),
    interesse: z.string(),
    motivo: z.string(),
    dados: z.array(z.object({ campo: z.string(), valor: z.string() })),
    lead_quente: z.boolean(),
  }),
});
export type SaidaResposta = z.infer<typeof SaidaResposta>;

const str = { type: "string" };
const obj = (props: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });

export const ESQUEMA_RESPOSTA = obj({
  responder: { type: "boolean", description: "false quando o silêncio é a melhor resposta (ex.: cliente só se despediu)" },
  partes: { type: "array", items: str, description: "mensagens curtas, uma ideia cada, na ordem de envio" },
  transferir: { anyOf: [obj({ motivo: str }), { type: "null" }] },
  etiquetas: { type: "array", items: str, description: "etapas do funil a aplicar" },
  agendar_retorno: { type: "boolean", description: "true se o cliente pediu para ser chamado depois" },
  oferecer_reuniao: { type: "boolean" },
  resumo: { ...str, description: "resumo atualizado da conversa em até 3 frases" },
  sentimento: { type: "string", enum: ["positivo", "neutro", "negativo"] },
  assunto: { ...str, description: "tema principal em até 4 palavras" },
  fontes: { type: "array", items: str, description: "ids dos trechos da base usados" },
  enviar_materiais: { type: "array", items: str, description: "ids dos MATERIAIS a enviar agora como arquivo (só quando o momento combinar com 'quando enviar')" },
  classificacao: obj({
    temperatura: { type: "string", enum: ["quente", "morno", "frio"] },
    nota: { type: "integer", description: "0 a 100" },
    interesse: str,
    motivo: { ...str, description: "motivo da nota em uma frase" },
    dados: { type: "array", items: obj({ campo: str, valor: str }) },
    lead_quente: { type: "boolean" },
  }),
});

/** Resposta do copiloto "Fale com a IA" (seção 2.2). */
export const SaidaInstrucao = z.object({
  decisao: z.enum(["executar", "discordar", "recusar"]),
  explicacao: z.string(),
  alternativa: z.string().nullable(),
  mensagens_cliente: z.array(z.string()),
  agendar_retorno: z.string().nullable(),
  etiquetas: z.array(z.string()),
  enviar_materiais: z.array(z.string()).default([]),
});
export type SaidaInstrucao = z.infer<typeof SaidaInstrucao>;

export const ESQUEMA_INSTRUCAO = obj({
  decisao: { type: "string", enum: ["executar", "discordar", "recusar"] },
  explicacao: { ...str, description: "nota interna para a equipe (o cliente nunca vê)" },
  alternativa: { anyOf: [{ ...str, description: "rótulo curto da ação sugerida no lugar" }, { type: "null" }] },
  mensagens_cliente: { type: "array", items: str, description: "mensagens a enviar ao cliente se a decisão for executar (ou da alternativa, se discordar)" },
  agendar_retorno: { anyOf: [{ ...str, description: "quando retomar, em palavras: 'amanhã', 'amanhã à tarde', 'mais tarde'" }, { type: "null" }] },
  etiquetas: { type: "array", items: str },
  enviar_materiais: { type: "array", items: str, description: "ids dos MATERIAIS a enviar ao cliente" },
});

/** Extrai o primeiro objeto JSON do texto (provedores sem saída estruturada nativa às vezes cercam com ```). */
export function extrairJson(texto: string): unknown {
  const t = texto.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {}
  const i = t.indexOf("{"), f = t.lastIndexOf("}");
  if (i >= 0 && f > i) return JSON.parse(t.slice(i, f + 1));
  throw new Error("resposta da IA sem JSON");
}
