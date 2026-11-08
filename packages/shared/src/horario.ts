/** Horário comercial, feriados e regras de agendamento de retorno (seção 2.11). Fuso: America/Sao_Paulo. */

export interface HorarioComercial {
  dias: number[];        // 0=domingo ... 6=sábado
  inicio: string;        // "08:00"
  fim: string;           // "18:00"
  fuso?: string;
}

export const HORARIO_PADRAO: HorarioComercial = { dias: [1, 2, 3, 4, 5], inicio: "08:00", fim: "18:00", fuso: "America/Sao_Paulo" };

const FUSO_OFFSET_MIN = -180; // America/Sao_Paulo sem horário de verão desde 2019

/** Converte Date (UTC) em componentes do horário local de São Paulo. */
export function local(d: Date) {
  const l = new Date(d.getTime() + FUSO_OFFSET_MIN * 60000);
  return { ano: l.getUTCFullYear(), mes: l.getUTCMonth(), dia: l.getUTCDate(), dow: l.getUTCDay(), min: l.getUTCHours() * 60 + l.getUTCMinutes() };
}

export function deLocal(ano: number, mes: number, dia: number, minutos: number): Date {
  return new Date(Date.UTC(ano, mes, dia, 0, minutos) - FUSO_OFFSET_MIN * 60000);
}

const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
const isoDia = (d: Date) => { const l = local(d); return `${l.ano}-${String(l.mes + 1).padStart(2, "0")}-${String(l.dia).padStart(2, "0")}`; };

export function ehDiaUtil(d: Date, h: HorarioComercial, feriados: Set<string>): boolean {
  return h.dias.includes(local(d).dow) && !feriados.has(isoDia(d));
}

export function dentroDoHorario(d: Date, h: HorarioComercial = HORARIO_PADRAO, feriados = new Set<string>()): boolean {
  const l = local(d);
  return ehDiaUtil(d, h, feriados) && l.min >= hm(h.inicio) && l.min < hm(h.fim);
}

/** Próxima abertura do horário comercial a partir de d (ou o próprio d se já estiver aberto). */
export function proximaAbertura(d: Date, h: HorarioComercial = HORARIO_PADRAO, feriados = new Set<string>()): Date {
  if (dentroDoHorario(d, h, feriados)) return d;
  let l = local(d);
  let cand = l.min < hm(h.inicio) ? deLocal(l.ano, l.mes, l.dia, hm(h.inicio)) : deLocal(l.ano, l.mes, l.dia + 1, hm(h.inicio));
  for (let i = 0; i < 30 && !ehDiaUtil(cand, h, feriados); i++) {
    l = local(cand);
    cand = deLocal(l.ano, l.mes, l.dia + 1, hm(h.inicio));
  }
  return cand;
}

export function somarDiasUteis(d: Date, n: number, minutos: number, h: HorarioComercial, feriados: Set<string>): Date {
  let l = local(d);
  let cand = deLocal(l.ano, l.mes, l.dia, minutos);
  let cont = 0;
  for (let i = 0; i < 60 && cont < n; i++) {
    l = local(cand);
    cand = deLocal(l.ano, l.mes, l.dia + 1, minutos);
    if (ehDiaUtil(cand, h, feriados)) cont++;
  }
  return cand;
}

export type PedidoRetorno =
  | { tipo: "agendar"; quando: Date; rotulo: string }
  | { tipo: "perguntar_dia" }
  | { tipo: "despedida" }
  | null;

/** Interpreta pedidos como "me chama mais tarde", "amanhã à tarde", "outro dia" (tabela da seção 2.11). */
export function interpretarRetorno(texto: string, agora = new Date(), h: HorarioComercial = HORARIO_PADRAO, feriados = new Set<string>()): PedidoRetorno {
  const t = texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/\b(boa noite|ate amanha|tchau|falou)\b/.test(t) && /\bate amanha\b/.test(t) && !/\b(me chama|me liga|me procura|retorn)/.test(t)) return { tipo: "despedida" };
  const pede = /\b(me chama|me liga|me procura|me chame|fala comigo|retorna|volta a falar|pode me chamar|chama de novo)\b/.test(t);
  if (!pede && !/\b(depois do almoco|mais tarde)\b/.test(t)) return null;

  const horaExplicita = t.match(/\b(\d{1,2})\s*(?:h|:|horas?)\s*(\d{2})?\b/);
  const periodo = /\btarde\b/.test(t) && !/mais tarde/.test(t) ? 14 * 60 : /\bnoite\b/.test(t) ? 18 * 60 : /\bmanha\b/.test(t) && !/amanha/.test(t.replace("de manha", "")) ? 9 * 60 : null;
  const minutosAlvo = horaExplicita ? Number(horaExplicita[1]) * 60 + Number(horaExplicita[2] ?? 0) : periodo ?? 9 * 60;

  if (/\bamanha\b/.test(t)) {
    const quando = somarDiasUteis(agora, 1, minutosAlvo, h, feriados);
    return { tipo: "agendar", quando, rotulo: `Amanhã ${Math.floor(minutosAlvo / 60)}h` };
  }
  if (/\bdepois do almoco\b/.test(t)) {
    const l = local(agora);
    const quando = proximaAbertura(deLocal(l.ano, l.mes, l.dia, Math.max(l.min, 14 * 60)), h, feriados);
    return { tipo: "agendar", quando, rotulo: rotular(quando, agora) };
  }
  if (/\b(outro dia|semana que vem|qualquer dia|outra hora)\b/.test(t)) return { tipo: "perguntar_dia" };
  if (/\bmais tarde\b/.test(t) || pede) {
    const quando = proximaAbertura(new Date(agora.getTime() + 3 * 3600_000), h, feriados);
    return { tipo: "agendar", quando, rotulo: rotular(quando, agora) };
  }
  return null;
}

export function rotular(quando: Date, agora = new Date()): string {
  const a = local(agora), q = local(quando);
  const hora = `${Math.floor(q.min / 60)}h${q.min % 60 ? String(q.min % 60).padStart(2, "0") : ""}`;
  const diffDias = Math.round((Date.UTC(q.ano, q.mes, q.dia) - Date.UTC(a.ano, a.mes, a.dia)) / 86400000);
  if (diffDias === 0) return `Hoje ${hora}`;
  if (diffDias === 1) return `Amanhã ${hora}`;
  return `${String(q.dia).padStart(2, "0")}/${String(q.mes + 1).padStart(2, "0")} ${hora}`;
}
