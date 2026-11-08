import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, sessao } from "./api.ts";

export interface Eu { id: string; nome: string; email: string; perfil: "admin" | "supervisor" | "atendente"; status: string; conta_nome: string; conta_id: string; vapidPublica: string | null; admin_plataforma: boolean; suporte?: boolean }
interface Ctx { eu: Eu | null; carregando: boolean; entrar: (token: string) => Promise<void>; sair: () => void; aviso: (t: string, erro?: boolean) => void }
const C = createContext<Ctx>(null as any);
export const useApp = () => useContext(C);

export function Provedor({ children }: { children: ReactNode }) {
  const [eu, setEu] = useState<Eu | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [toast, setToast] = useState<{ t: string; erro?: boolean } | null>(null);
  const carregar = useCallback(async () => {
    if (!sessao.token) { setCarregando(false); return; }
    try { setEu(await api<Eu>("/auth/eu")); } catch { sessao.token = ""; } finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const aviso = useCallback((t: string, erro?: boolean) => { setToast({ t, erro }); setTimeout(() => setToast(null), 4000); }, []);
  return (
    <C.Provider value={{ eu, carregando, aviso, entrar: async (token) => { sessao.token = token; await carregar(); }, sair: () => { sessao.token = ""; setEu(null); location.href = "/login"; } }}>
      {children}
      {toast && <div className={"toast" + (toast.erro ? " erro" : "")} role="status">{toast.t}</div>}
    </C.Provider>
  );
}

/** Executa uma ação e mostra o erro em um aviso. */
export function useAcao() {
  const { aviso } = useApp();
  return useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    try { const r = await fn(); if (ok) aviso(ok); return r; } catch (e) { aviso((e as Error).message, true); return undefined; }
  }, [aviso]);
}
