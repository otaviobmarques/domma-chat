export * from "./crypto.ts";
export * from "./texto.ts";
export * from "./horario.ts";
export * from "./eventos.ts";

export type Modo = "ia" | "aprova" | "humano";
export type Temperatura = "quente" | "morno" | "frio";
export const FONTES = ["google_ads", "meta_ads", "site", "indicacao", "lista", "organico", "outro"] as const;
export type Fonte = (typeof FONTES)[number];
