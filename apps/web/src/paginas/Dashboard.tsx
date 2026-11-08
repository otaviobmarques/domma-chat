import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, baixar, tempoReal } from "../api.ts";
import { Carregando, SeloFonte } from "../componentes.tsx";
import { useAcao, useApp } from "../contexto.tsx";
import { brl, FONTE_LONGA, hora, iniciais } from "../util.ts";

const NIVEL: Record<string, string> = { urgente: "Urgente", atencao: "Atenção", info: "Info" };
const STATUS_CX: Record<string, [string, string]> = { conectada: ["Conectado", "verde"], caiu: ["Caiu", "urgente"], reconectando: ["Reconectando", "atencao"], precisa_atencao: ["Precisa de atenção", "urgente"], aguardando_qr: ["Aguardando QR", "atencao"], desconectada: ["Desconectado", "urgente"] };

export function Dashboard() {
  const { eu } = useApp();
  const acao = useAcao();
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [baixando, setBaixando] = useState(false);
  useEffect(() => {
    const carregar = () => api("/dashboard").then(setD).catch(() => {});
    carregar();
    const s = tempoReal();
    // Atualização em tempo real: eventos relevantes + métricas a cada 10 s.
    let t: any; const agendar = () => { clearTimeout(t); t = setTimeout(carregar, 600); };
    const evs = ["dashboard.metricas", "alerta.novo", "conversa.atualizada", "conexao.estado"];
    evs.forEach((e) => s.on(e, agendar));
    return () => { evs.forEach((e) => s.off(e, agendar)); clearTimeout(t); };
  }, []);
  if (!d) return <div className="pagina"><Carregando /></div>;
  const i = d.indicadores;
  const saudacao = new Date().getHours() < 12 ? "Bom dia" : new Date().getHours() < 18 ? "Boa tarde" : "Boa noite";
  const maxFonte = Math.max(1, ...d.fontes.map((f: any) => f.contatos));
  const maxAssunto = Math.max(1, ...d.assuntos.map((a: any) => a.n));
  const humorTot = (d.humor?.positivo ?? 0) + (d.humor?.neutro ?? 0) + (d.humor?.negativo ?? 0) || 1;
  const acaoAlerta = (a: any) => a.alvo?.conversaId ? ["Ver conversa", () => nav(`/atendimento/${a.alvo.conversaId}`)] : a.tipo === "conexao" ? ["Reconectar", () => nav("/conexoes")] : a.tipo?.startsWith("ia") ? ["Ver IAs", () => nav("/agente")] : a.tipo === "espera" ? ["Ver fila", () => nav("/atendimento?modo=humano")] : ["Resolver", () => acao(() => api(`/alertas/${a.id}/resolver`, { corpo: {} })).then(() => api("/dashboard").then(setD))];

  return (
    <div className="pagina">
      <div className="cab">
        <div><span className="rotulo">Ao vivo</span><h1>{saudacao}{eu ? `, ${eu.nome.split(" ")[0]}` : ""}! Assim está a operação agora</h1></div>
        <div className="linha">
          {d.alertas.length > 0 && <span className="selo atencao"><span className="ponto" style={{ background: "var(--laranja)" }} /> {d.alertas.length} pontos de atenção</span>}
          <button className="btn" disabled={baixando} onClick={async () => { setBaixando(true); await acao(() => baixar("/dashboard.pdf", "dashboard.pdf")); setBaixando(false); }}>⤓ {baixando ? "Gerando…" : "Exportar PDF"}</button>
        </div>
      </div>

      <div className="grade g6" style={{ marginBottom: 14 }}>
        <div className="cartao kpi"><div className="rot">Conversas abertas</div><div className="val">{i.abertas}</div><div className="nota">agora</div></div>
        <div className="cartao kpi"><div className="rot">IA atendendo</div><div className="val">{i.ia}</div><div className="nota">{i.abertas ? Math.round((100 * i.ia) / i.abertas) : 0}% das abertas</div></div>
        <div className={"cartao kpi" + (i.esperando ? " destaque" : "")}><div className="rot">Esperando humano</div><div className="val">{i.esperando}</div><div className="nota">maior espera: {i.maior_espera_min} min</div></div>
        <div className="cartao kpi"><div className="rot">Resolvidas pela IA hoje</div><div className="val">{i.pct_ia}%</div><div className="nota">{i.conversas_hoje} conversas hoje</div></div>
        <div className="cartao kpi"><div className="rot">Vendas hoje</div><div className="val" style={{ fontSize: 22 }}>{brl(i.vendas_hoje)}</div><div className="nota">{i.pagamentos_hoje} pagamentos</div></div>
        <div className="cartao kpi"><div className="rot">Reuniões hoje</div><div className="val">{i.reunioes_hoje}</div><div className="nota">{d.reunioes[0] ? `próxima às ${hora(d.reunioes.find((r: any) => new Date(r.inicio) > new Date())?.inicio)}` : "nenhuma"}</div></div>
      </div>

      <div className="grade g-2-1" style={{ marginBottom: 14 }}>
        <div className="cartao">
          <div className="cartao-cab"><h2>Alertas</h2></div>
          <div className="pilha">
            {d.alertas.length === 0 && <div className="vazio">Nenhum alerta. Tudo certo por aqui ✨</div>}
            {d.alertas.map((a: any) => { const [rot, fn] = acaoAlerta(a) as [string, () => void]; return (
              <div key={a.id} className="linha entre" style={{ border: "1px solid var(--borda)", borderRadius: 10, padding: "10px 12px", flexWrap: "nowrap" }}>
                <div className="linha" style={{ flexWrap: "nowrap", minWidth: 0 }}>
                  <span className={`selo ${a.nivel}`} style={{ minWidth: 64, justifyContent: "center" }}>{NIVEL[a.nivel]}</span>
                  <div style={{ minWidth: 0 }}><h3>{a.titulo}</h3><div className="mini">{a.detalhe}</div></div>
                </div>
                <button className="btn pequeno" onClick={fn}>{rot}</button>
              </div>); })}
          </div>
        </div>
        <div className="cartao">
          <div className="cartao-cab"><h2>Esperando humano</h2><Link to="/atendimento?modo=humano" className="mini" style={{ color: "var(--roxo-2)", fontWeight: 700 }}>Abrir fila</Link></div>
          <div className="lista">
            {d.esperandoHumano.length === 0 && <div className="vazio">Ninguém esperando.</div>}
            {d.esperandoHumano.map((e: any) => (
              <Link key={e.id} to={`/atendimento/${e.id}`} className="item" style={{ color: "inherit" }}>
                <div className="avatar">{iniciais(e.nome)}</div>
                <div style={{ flex: 1, minWidth: 0 }}><h3>{e.nome ?? "Cliente"}</h3><div className="mini">{e.motivo_transferencia}</div></div>
                <span className={`selo ${e.min >= 5 ? "urgente" : "cinza"}`}>{Math.max(0, e.min)} min</span>
              </Link>))}
          </div>
        </div>
      </div>

      <div className="grade g3" style={{ marginBottom: 14 }}>
        <div className="cartao">
          <div className="cartao-cab"><h2>Leads quentes</h2></div>
          <div className="sub" style={{ marginTop: -6, marginBottom: 8 }}>A IA detectou intenção de compra nestas conversas.</div>
          <div className="pilha">
            {d.leadsQuentes.length === 0 && <div className="vazio">Nenhum lead quente agora.</div>}
            {d.leadsQuentes.map((l: any) => (
              <Link key={l.id} to={`/atendimento/${l.id}`} style={{ color: "inherit", background: "var(--lavanda)", borderRadius: 10, padding: 10 }}>
                <div className="linha entre"><h3>{l.nome ?? "Contato"}</h3><span className="temp-quente" style={{ fontWeight: 800 }}>● {l.nota}</span></div>
                <div className="linha" style={{ gap: 6, margin: "4px 0" }}><span className="selo">{l.interesse}</span><SeloFonte fonte={l.fonte_ultima} /></div>
                <div className="mini">{l.motivo_classificacao}</div>
              </Link>))}
          </div>
        </div>
        <div className="cartao">
          <div className="cartao-cab"><h2>Reuniões de hoje</h2></div>
          <div className="lista">
            {d.reunioes.length === 0 && <div className="vazio">Sem reuniões hoje.</div>}
            {d.reunioes.map((r: any, k: number) => (
              <div key={k} className="item"><span className="selo" style={{ background: "var(--roxo)", color: "#fff", borderRadius: 6 }}>{hora(r.inicio)}</span>
                <div><h3>{r.contato}</h3><div className="mini">{r.vendedor} · {({ meet: "Google Meet", ligacao: "Ligação", presencial: "Presencial" } as any)[r.formato]}</div></div></div>))}
          </div>
          <h2 style={{ margin: "14px 0 6px" }}>Pagamentos de hoje</h2>
          <div className="lista">
            {d.pagamentos.length === 0 && <div className="vazio">Sem cobranças hoje.</div>}
            {d.pagamentos.map((c: any, k: number) => (
              <div key={k} className="item linha entre"><div><h3>{c.contato}</h3><div className="mini">{c.descricao} · {c.gateway}</div></div>
                <div style={{ textAlign: "right" }}><b>{brl(c.valor)}</b><div className={`mini ${c.status === "paga" ? "" : ""}`} style={{ color: c.status === "paga" ? "var(--verde)" : "var(--laranja)", fontWeight: 700 }}>{c.status === "paga" ? "Pago" : "Aguardando"}</div></div></div>))}
          </div>
        </div>
        <div className="cartao">
          <div className="cartao-cab"><h2>Do que estão falando hoje</h2></div>
          <div className="pilha">
            {d.assuntos.length === 0 && <div className="vazio">Ainda sem conversas hoje.</div>}
            {d.assuntos.map((a: any) => (<div key={a.assunto}><div className="linha entre" style={{ fontSize: 13 }}><span>{a.assunto}</span><b>{a.n}</b></div><div className="barra"><div style={{ width: `${(100 * a.n) / maxAssunto}%` }} /></div></div>))}
          </div>
          <h3 style={{ margin: "16px 0 6px" }}>Humor dos clientes</h3>
          <div style={{ display: "flex", height: 10, borderRadius: 99, overflow: "hidden", background: "#EEECF5" }}>
            <div style={{ width: `${(100 * (d.humor?.positivo ?? 0)) / humorTot}%`, background: "var(--verde)" }} />
            <div style={{ width: `${(100 * (d.humor?.neutro ?? 0)) / humorTot}%`, background: "var(--cinza-claro)" }} />
            <div style={{ width: `${(100 * (d.humor?.negativo ?? 0)) / humorTot}%`, background: "var(--vermelho)" }} />
          </div>
          <div className="mini" style={{ marginTop: 6 }}>Positivo {Math.round((100 * (d.humor?.positivo ?? 0)) / humorTot)}% · Neutro {Math.round((100 * (d.humor?.neutro ?? 0)) / humorTot)}% · Negativo {Math.round((100 * (d.humor?.negativo ?? 0)) / humorTot)}%</div>
        </div>
      </div>

      <div className="grade g2" style={{ marginBottom: 14 }}>
        <div className="cartao">
          <div className="cartao-cab"><h2>🕘 Retornos de hoje</h2></div>
          <div className="lista">
            {d.retornos.length === 0 && <div className="vazio">Sem retornos agendados para hoje.</div>}
            {d.retornos.map((r: any, k: number) => (
              <Link key={k} to={`/atendimento/${r.conversa_id}`} className="item" style={{ color: "inherit" }}>
                <span className="selo amarelo" style={{ borderRadius: 6 }}>{hora(r.quando)}</span>
                <div style={{ flex: 1, minWidth: 0 }}><h3>{r.nome}</h3><div className="mini" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.resumo_ia}</div></div>
                <span className={`selo ${r.executor === "ia" ? "" : "cinza"}`}>{r.executor === "ia" ? "IA" : "Lembrete p/ você"}</span>
              </Link>))}
          </div>
        </div>
        <div className="cartao">
          <div className="cartao-cab"><h2>Contatos de hoje por fonte</h2><Link to="/relatorios" className="mini" style={{ color: "var(--roxo-2)", fontWeight: 700 }}>Ver relatório</Link></div>
          <div className="pilha">
            {d.fontes.length === 0 && <div className="vazio">Nenhum contato novo hoje.</div>}
            {d.fontes.map((f: any) => (<div key={f.fonte} className="linha" style={{ flexWrap: "nowrap" }}><SeloFonte fonte={f.fonte} /><div className="barra" style={{ flex: 1 }}><div style={{ width: `${(100 * f.contatos) / maxFonte}%` }} /></div><span className="mini" style={{ minWidth: 90, textAlign: "right" }}><b style={{ color: "var(--texto)" }}>{f.contatos}</b> · <span className="temp-quente">{f.quentes} quentes</span></span></div>))}
          </div>
        </div>
      </div>

      <div className="cartao">
        <div className="cartao-cab"><h2>Saúde do sistema</h2><Link to="/saude" className="mini" style={{ color: "var(--roxo-2)", fontWeight: 700 }}>Ver tudo</Link></div>
        <div className="grade" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
          {d.saude.conexoes.map((c: any) => (<div key={c.id} className="bloco"><div className="mini">WhatsApp</div><h3>{c.tipo === "oficial" ? "API Oficial" : c.tipo === "qr" ? "QR Code" : "Simulador"} · {c.nome}</h3><span className={`selo ${STATUS_CX[c.status]?.[1]}`} style={{ marginTop: 6 }}>{STATUS_CX[c.status]?.[0] ?? c.status}</span></div>))}
          {d.saude.provedores.map((p: any, k: number) => { const falha = p.degradado_ate && new Date(p.degradado_ate) > new Date(); const lenta = (p.ultimo_tempo_ms ?? 0) > 8000; return (
            <div key={p.id} className="bloco"><div className="mini">{k === 0 ? "IA principal" : `IA backup ${k}`}</div><h3>{p.nome}</h3><span className={`selo ${!p.ativo ? "cinza" : falha ? "urgente" : lenta ? "atencao" : "verde"}`} style={{ marginTop: 6 }}>{!p.ativo ? "Desligado" : falha ? "Com falha" : lenta ? "Lento" : "Respondendo"}{p.ultimo_tempo_ms ? ` · ${(p.ultimo_tempo_ms / 1000).toFixed(1)} s` : ""}</span></div>); })}
          {d.saude.gateways.map((g: any) => (<div key={g.tipo} className="bloco"><div className="mini">Pagamentos</div><h3>{g.tipo}</h3><span className="selo verde" style={{ marginTop: 6 }}>Operando</span></div>))}
          <div className="bloco"><div className="mini">Agenda</div><h3>Google Agenda · {d.saude.agenda} vendedores</h3><span className={`selo ${d.saude.agenda ? "verde" : "cinza"}`} style={{ marginTop: 6 }}>{d.saude.agenda ? "Sincronizada" : "Não conectada"}</span></div>
        </div>
      </div>
      <p className="mini" style={{ marginTop: 10 }}>Fontes: {Object.values(FONTE_LONGA).join(", ")}. Atualiza sozinho em tempo real.</p>
    </div>
  );
}
