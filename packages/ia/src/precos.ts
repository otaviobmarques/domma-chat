/** Preço por 1M de tokens (US$) para estimar o custo de cada chamada. Ajuste conforme a tabela vigente do fornecedor. */
const PRECOS: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-fable-5-1": [10, 50],
};

export function custoEstimado(modelo: string, entrada: number, saida: number): number {
  const p = PRECOS[modelo] ?? Object.entries(PRECOS).find(([k]) => modelo.startsWith(k))?.[1];
  if (!p) return 0;
  return (entrada * p[0] + saida * p[1]) / 1_000_000;
}
