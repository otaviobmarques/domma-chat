/** Utilidades de texto e telefone usadas no porteiro, nas regras e nas importações. */

export function normalizarTelefone(t: string): string {
  let d = (t || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = "55" + d; // número brasileiro sem DDI
  return d;
}

export function normalizarTexto(t: string): string {
  return (t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Similaridade de Jaccard em bigramas de caracteres (0..1). */
export function similaridade(a: string, b: string): number {
  const na = normalizarTexto(a), nb = normalizarTexto(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const bi = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bi(na), B = bi(nb);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

/** Mascara números de cartão e senhas antes de gravar (seção 2.13). */
export function mascararSensiveis(t: string): { texto: string; mascarou: boolean } {
  let mascarou = false;
  let out = t.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const dig = m.replace(/\D/g, "");
    if (dig.length < 13 || !luhn(dig)) return m;
    mascarou = true;
    return "•••• •••• •••• " + dig.slice(-4);
  });
  out = out.replace(/\b(senha|password|pin)\s*(?:é|e|:|=)?\s*(\S+)/gi, (_m, k) => {
    mascarou = true;
    return `${k} ••••••`;
  });
  return { texto: out, mascarou };
}

function luhn(n: string): boolean {
  let s = 0, alt = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = Number(n[i]);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    s += d; alt = !alt;
  }
  return s % 10 === 0;
}

export function iniciais(nome?: string | null): string {
  const p = (nome || "?").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
