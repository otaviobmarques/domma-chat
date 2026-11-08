import { io, type Socket } from "socket.io-client";

const CHAVE = "domma.token";
export const sessao = {
  get token() { try { return localStorage.getItem(CHAVE) ?? ""; } catch { return ""; } },
  set token(v: string) { try { v ? localStorage.setItem(CHAVE, v) : localStorage.removeItem(CHAVE); } catch { /* sem storage */ } },
};

export class ErroApi extends Error { constructor(public status: number, msg: string) { super(msg); } }

export async function api<T = any>(caminho: string, opts: { metodo?: string; corpo?: unknown; form?: FormData } = {}): Promise<T> {
  const r = await fetch("/api/v1" + caminho, {
    method: opts.metodo ?? (opts.corpo || opts.form ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${sessao.token}`, ...(opts.form ? {} : opts.corpo !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: opts.form ?? (opts.corpo !== undefined ? JSON.stringify(opts.corpo) : undefined),
  });
  if (r.status === 401 && !caminho.startsWith("/auth/login")) { sessao.token = ""; location.href = "/login"; }
  const j = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  if (!r.ok) throw new ErroApi(r.status, j?.erro ?? `erro ${r.status}`);
  return j as T;
}

/** Baixa um arquivo autenticado (PDF/CSV/TXT) e abre o "salvar como". */
export async function baixar(caminho: string, nomePadrao: string) {
  const r = await fetch("/api/v1" + caminho, { headers: { Authorization: `Bearer ${sessao.token}` } });
  if (!r.ok) throw new ErroApi(r.status, "não foi possível gerar o arquivo");
  const nome = r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? nomePadrao;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a"); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

let socket: Socket | null = null;
export function tempoReal(): Socket {
  // Em produção o painel fica na Vercel e o WebSocket vai direto para a API (VITE_API_URL).
  const base = import.meta.env.VITE_API_URL as string | undefined;
  if (!socket) socket = io(base || undefined, { path: "/tempo-real", auth: { token: sessao.token }, transports: ["websocket", "polling"] });
  return socket;
}
export function fecharTempoReal() { socket?.disconnect(); socket = null; }

export async function ativarPush(chavePublica: string | null) {
  if (!chavePublica || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const reg = await navigator.serviceWorker.register("/sw.js");
  if ((await Notification.requestPermission()) !== "granted") return false;
  const pad = "=".repeat((4 - (chavePublica.length % 4)) % 4);
  const raw = atob((chavePublica + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
  await api("/auth/push", { corpo: sub.toJSON() });
  return true;
}
