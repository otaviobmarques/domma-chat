export const FONTE: Record<string, string> = { google_ads: "G Ads", meta_ads: "Meta", site: "Site", indicacao: "Indic.", lista: "Lista", organico: "Orgân.", outro: "Outro" };
export const FONTE_LONGA: Record<string, string> = { google_ads: "Google Ads", meta_ads: "Meta Ads", site: "Site", indicacao: "Indicação", lista: "Lista", organico: "Orgânico", outro: "Outro" };
export const MODO: Record<string, string> = { ia: "IA atendendo", aprova: "IA sugere", humano: "Humano" };
export const TEMP: Record<string, string> = { quente: "Quente", morno: "Morno", frio: "Frio" };
export const brl = (v: number) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const hora = (d?: string | null) => (d ? new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
export const dataHora = (d?: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
export const iniciais = (n?: string | null) => { const p = (n || "?").trim().split(/\s+/); return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase(); };
export const quando = (d?: string | null) => {
  if (!d) return "";
  const dt = new Date(d), hoje = new Date();
  return dt.toDateString() === hoje.toDateString() ? hora(d) : dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};
