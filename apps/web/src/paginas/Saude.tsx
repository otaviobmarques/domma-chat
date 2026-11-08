import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Carregando } from "../componentes.tsx";
import { useAcao } from "../contexto.tsx";

type Situacao = "ok" | "atencao" | "falha" | "inativo";
interface Checagem { id: string; grupo: string; nome: string; status: Situacao; detalhe: string; ms?: number; link?: string }
interface Relatorio { gerado_em: string; geral: Situacao; checagens: Checagem[] }

const COR: Record<Situacao, string> = { ok: "var(--verde)", atencao: "var(--laranja)", falha: "var(--vermelho)", inativo: "var(--cinza-claro)" };
const ROTULO: Record<Situacao, string> = { ok: "Funcionando", atencao: "Atenção", falha: "Com problema", inativo: "Não configurado" };
const GERAL: Record<Situacao, string> = { ok: "Tudo funcionando", atencao: "Funcionando, com pontos de atenção", falha: "Há itens com problema", inativo: "Sem itens configurados" };

/** Painel de saúde reutilizado pela aba do cliente e pela aba da plataforma. Atualiza sozinho a cada 60 s. */
export function PainelSaude({ rota, titulo, descricao }: { rota: string; titulo: string; descricao: string }) {
  const acao = useAcao();
  const [r, setR] = useState<Relatorio | null>(null);
  const [verificando, setVerificando] = useState(false);
  const carregar = (forcar = false) => api<Relatorio>(`${rota}${forcar ? "?forcar=1" : ""}`).then(setR);
  useEffect(() => { carregar().catch(() => {}); const t = setInterval(() => carregar().catch(() => {}), 60000); return () => clearInterval(t); }, [rota]);
  if (!r) return <Carregando />;
  const grupos = [...new Set(r.checagens.map((c) => c.grupo))];
  const conta = (s: Situacao) => r.checagens.filter((c) => c.status === s).length;
  return (
    <div className="pilha" style={{ gap: 14 }}>
      <div className="cartao linha entre" style={{ borderColor: COR[r.geral], background: r.geral === "ok" ? "#F6FCF9" : r.geral === "falha" ? "#FFF7F7" : "#FFFBF6" }}>
        <div className="linha" style={{ flexWrap: "nowrap" }}>
          <span className="ponto" style={{ width: 14, height: 14, background: COR[r.geral], boxShadow: `0 0 0 5px color-mix(in srgb, ${COR[r.geral]} 20%, transparent)` }} />
          <div><h2>{titulo}: {GERAL[r.geral]}</h2><div className="mini">{descricao} Verificado às {new Date(r.gerado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.</div></div>
        </div>
        <div className="linha">
          <span className="selo verde">{conta("ok")} ok</span>{conta("atencao") > 0 && <span className="selo atencao">{conta("atencao")} atenção</span>}{conta("falha") > 0 && <span className="selo urgente">{conta("falha")} problema</span>}
          <button className="btn" disabled={verificando} onClick={async () => { setVerificando(true); await acao(() => carregar(true)); setVerificando(false); }}>{verificando ? "Verificando…" : "↻ Verificar agora"}</button>
        </div>
      </div>
      {grupos.map((g) => (
        <div key={g} className="cartao">
          <div className="cartao-cab"><h2>{g}</h2></div>
          <div className="lista">
            {r.checagens.filter((c) => c.grupo === g).map((c) => (
              <div key={c.id} className="item" style={{ alignItems: "flex-start" }}>
                <span className="ponto" style={{ background: COR[c.status], marginTop: 6 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="linha entre"><h3>{c.nome}</h3><span className="mini" style={{ color: COR[c.status], fontWeight: 700 }}>{c.status === "inativo" && c.grupo === "Fornecedores" ? "Consultar página" : ROTULO[c.status]}{c.ms !== undefined && c.status !== "inativo" ? ` · ${c.ms < 1000 ? `${c.ms} ms` : `${(c.ms / 1000).toFixed(1)} s`}` : ""}</span></div>
                  <div className="mini" style={{ marginTop: 2 }}>{c.detalhe}{c.link && <> · <a href={c.link} target="_blank" rel="noreferrer">abrir ↗</a></>}</div>
                </div>
              </div>))}
          </div>
        </div>))}
      <p className="mini">Verificação automática a cada 5 minutos. Quando algo falha, abre um alerta no Dashboard e avisa no celular; quando volta, o alerta se resolve sozinho.</p>
    </div>
  );
}

export function Saude() {
  return (
    <div className="pagina">
      <div className="cab"><div><span className="rotulo">Sua operação</span><h1>Saúde do sistema</h1><p className="sub" style={{ margin: 0 }}>Números de WhatsApp, inteligências, pagamentos e integrações da sua conta.</p></div></div>
      <PainelSaude rota="/saude" titulo="Sua operação" descricao="Itens da sua conta." />
    </div>
  );
}
