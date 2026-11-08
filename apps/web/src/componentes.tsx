import { useEffect, useState, type ReactNode } from "react";
import { FONTE, FONTE_LONGA, TEMP, dataHora } from "./util.ts";

export function Chave({ marcado, onChange, rotulo }: { marcado: boolean; onChange: (v: boolean) => void; rotulo?: string }) {
  return (
    <label className="linha" style={{ gap: 8, cursor: "pointer" }}>
      <span className="chave"><input type="checkbox" checked={marcado} onChange={(e) => onChange(e.target.checked)} /><span /></span>
      {rotulo && <span style={{ fontSize: 13 }}>{rotulo}</span>}
    </label>
  );
}

export function Modal({ titulo, children, fechar, largura }: { titulo: string; children: ReactNode; fechar: () => void; largura?: number }) {
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === "Escape" && fechar(); addEventListener("keydown", f); return () => removeEventListener("keydown", f); }, [fechar]);
  return (
    <div className="fundo-modal" onClick={fechar}>
      <div className="modal" style={largura ? { width: `min(${largura}px, 100%)` } : undefined} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titulo}>
        <div className="linha entre" style={{ marginBottom: 14 }}><h2>{titulo}</h2><button className="btn fantasma" onClick={fechar} aria-label="Fechar">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export function SeloFonte({ fonte, campanha, entrada }: { fonte?: string | null; campanha?: string | null; entrada?: string | null }) {
  if (!fonte) return null;
  const cls = fonte === "meta_ads" ? "" : fonte === "google_ads" ? "" : fonte === "indicacao" ? "atencao" : fonte === "site" ? "verde" : "cinza";
  return <span className={`selo ${cls}`} title={`Fonte: ${FONTE_LONGA[fonte] ?? fonte}${campanha ? `\nCampanha: ${campanha}` : ""}${entrada ? `\nEntrada: ${dataHora(entrada)}` : ""}`}>{FONTE[fonte] ?? fonte}</span>;
}

export function Temperatura({ t }: { t?: string | null }) {
  if (!t) return null;
  return <span className={`mini temp-${t}`} style={{ fontWeight: 700 }}><span className={`ponto bg-${t}`} /> {TEMP[t]}</span>;
}

export function Carregando() { return <div className="vazio">Carregando…</div>; }

export function useDados<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const recarregar = () => fn().then(setDados).catch((e) => setErro(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recarregar(); }, deps);
  return { dados, erro, recarregar, setDados };
}
