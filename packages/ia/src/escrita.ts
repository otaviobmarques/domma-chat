import { VELOCIDADE_MS_POR_CARACTERE } from "./personalidades.ts";

export type Velocidade = keyof typeof VELOCIDADE_MS_POR_CARACTERE;
export interface PassoEscrita { tipo: "digitando" | "texto"; atrasoMs: number; indice: number; texto?: string }

const aleatorio = (a: number, b: number, rnd: () => number) => a + (b - a) * rnd();
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Quebra texto longo em mensagens curtas, de uma ideia cada. */
export function quebrarEmPartes(partes: string[], maxCaracteres = 220): string[] {
  const out: string[] = [];
  for (const p of partes.map((s) => s.trim()).filter(Boolean)) {
    if (p.length <= maxCaracteres) { out.push(p); continue; }
    let atual = "";
    for (const frase of p.split(/(?<=[.!?])\s+/)) {
      if ((atual + " " + frase).trim().length > maxCaracteres && atual) { out.push(atual.trim()); atual = frase; }
      else atual = (atual + " " + frase).trim();
    }
    if (atual) out.push(atual.trim());
  }
  return out;
}

/**
 * Motor de escrita humana (seção 6.3): devolve a linha do tempo de "digitando…" e envios.
 * pausaLeitura 0,7–1,2 s; digitação clamp(600 + chars*fator, 1100, 5000) ±15%; pausa entre mensagens 0,45–1,1 s.
 */
export function planejarEscrita(partes: string[], velocidade: Velocidade = "natural", rnd: () => number = Math.random): PassoEscrita[] {
  const fator = VELOCIDADE_MS_POR_CARACTERE[velocidade];
  let t = aleatorio(700, 1200, rnd);
  const passos: PassoEscrita[] = [];
  partes.forEach((texto, i) => {
    passos.push({ tipo: "digitando", atrasoMs: Math.round(t), indice: i });
    t += clamp(600 + texto.length * fator, 1100, 5000) * aleatorio(0.85, 1.15, rnd);
    passos.push({ tipo: "texto", atrasoMs: Math.round(t), indice: i, texto });
    t += aleatorio(450, 1100, rnd);
  });
  return passos;
}
