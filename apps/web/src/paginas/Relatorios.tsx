import { useState } from "react";
import { api, baixar } from "../api.ts";
import { Carregando, useDados } from "../componentes.tsx";
import { useAcao } from "../contexto.tsx";
import { brl, FONTE_LONGA } from "../util.ts";

const seg = (s: number) => (s < 60 ? `${s} s` : `${Math.round(s / 60)} min`);

export function Relatorios() {
  const acao = useAcao();
  const [periodo, setPeriodo] = useState("7d");
  const [de, setDe] = useState(""); const [ate, setAte] = useState("");
  const qs = periodo === "custom" && de && ate ? `de=${de}&ate=${ate}` : `periodo=${periodo === "custom" ? "7d" : periodo}`;
  const { dados: r } = useDados<any>(() => api(`/relatorios?${qs}`), [qs]);
  const [gerando, setGerando] = useState("");
  const exportar = async (f: "pdf" | "csv") => { setGerando(f); await acao(() => baixar(`/relatorios.${f}?${qs}`, `numeros.${f}`)); setGerando(""); };
  if (!r) return <div className="pagina"><Carregando /></div>;
  const s = r.resumo;
  const maxDia = Math.max(1, ...r.porDia.map((d: any) => d.ia + d.humano));
  const top = (k: string) => [...r.fontes].sort((a: any, b: any) => b[k] - a[k])[0];
  const pago = r.fontes.filter((f: any) => ["google_ads", "meta_ads"].includes(f.fonte)).sort((a: any, b: any) => b.taxa - a.taxa)[0];
  return (
    <div className="pagina">
      <div className="cab"><div><span className="rotulo">Histórico</span><h1>Relatórios</h1><p className="sub" style={{ margin: 0 }}>Os números do negócio no período.</p></div>
        <div className="linha">
          <div className="seg">{[["hoje", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"], ["custom", "Personalizado"]].map(([v, n]) => <button key={v} className={periodo === v ? "ativo" : ""} onClick={() => setPeriodo(v)}>{n}</button>)}</div>
          {periodo === "custom" && <><input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={{ width: "auto" }} aria-label="De" /><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={{ width: "auto" }} aria-label="Até" /></>}
          <button className="btn" disabled={!!gerando} onClick={() => exportar("csv")}>{gerando === "csv" ? "Gerando…" : "⤓ CSV"}</button>
          <button className="btn primario" disabled={!!gerando} onClick={() => exportar("pdf")}>{gerando === "pdf" ? "Gerando…" : "⤓ Exportar PDF"}</button>
        </div></div>

      <div className="grade g6" style={{ marginBottom: 14 }}>
        <div className="cartao kpi"><div className="rot">Conversas</div><div className="val">{s.conversas}</div></div>
        <div className="cartao kpi"><div className="rot">Resolvidas só pela IA</div><div className="val">{s.pct_so_ia}%</div></div>
        <div className="cartao kpi"><div className="rot">1ª resposta (IA)</div><div className="val">{seg(s.primeira_resposta_ia_s)}</div><div className="nota">equipe: {seg(s.primeira_resposta_humano_s)}</div></div>
        <div className="cartao kpi"><div className="rot">Reuniões marcadas</div><div className="val">{s.reunioes}</div></div>
        <div className="cartao kpi"><div className="rot">Vendas pela conversa</div><div className="val" style={{ fontSize: 22 }}>{brl(s.vendas_total)}</div><div className="nota">{s.vendas_n} pagamentos</div></div>
        <div className="cartao kpi"><div className="rot">Custo de IA</div><div className="val" style={{ fontSize: 22 }}>US$ {s.custo_ia.toFixed(2)}</div><div className="nota">US$ {s.custo_medio_conversa.toFixed(3)} por conversa</div></div>
      </div>

      <div className="grade g-2-1" style={{ marginBottom: 14 }}>
        <div className="cartao"><h2>Conversas por dia</h2><div className="linha mini" style={{ margin: "4px 0 10px" }}><span className="ponto" style={{ background: "var(--roxo)" }} /> IA <span className="ponto" style={{ background: "var(--marinho)" }} /> Humano</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 180, borderBottom: "1px solid var(--borda)" }}>
            {r.porDia.map((d: any) => <div key={d.dia} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }} title={`${d.dia}: IA ${d.ia} · Humano ${d.humano}`}>
              <div style={{ height: `${(100 * d.humano) / maxDia}%`, background: "var(--marinho)", borderRadius: "3px 3px 0 0" }} />
              <div style={{ height: `${(100 * d.ia) / maxDia}%`, background: "var(--roxo)" }} /></div>)}
          </div>
          <div style={{ display: "flex", gap: 4 }}>{r.porDia.map((d: any) => <div key={d.dia} className="mini" style={{ flex: 1, textAlign: "center", fontSize: 10 }}>{r.porDia.length <= 14 ? d.dia : ""}</div>)}</div></div>
        <div className="cartao"><h2>Funil das campanhas</h2>
          {r.campanhas.length === 0 ? <div className="vazio">Nenhuma campanha no período.</div> : <table className="tab" style={{ marginTop: 8 }}><thead><tr><th>Campanha</th><th className="num">Env.</th><th className="num">Lidas</th><th className="num">Resp.</th><th className="num">Fech.</th></tr></thead>
            <tbody>{r.campanhas.map((c: any) => <tr key={c.nome}><td>{c.nome}</td><td className="num">{c.enviadas}</td><td className="num">{c.lidas}</td><td className="num">{c.responderam}</td><td className="num">{c.fecharam}</td></tr>)}</tbody></table>}</div>
      </div>

      <div className="cartao" style={{ marginBottom: 14 }}>
        <h2>Fontes de dados</h2>
        <div className="grade g3" style={{ margin: "10px 0" }}>
          <div className="bloco"><div className="mini">Mais gera contato</div><h2>{top("contatos") ? FONTE_LONGA[top("contatos").fonte] ?? top("contatos").fonte : "–"}</h2></div>
          <div className="bloco"><div className="mini">Mais fecha</div><h2>{top("fechamentos")?.fechamentos ? FONTE_LONGA[top("fechamentos").fonte] : "–"}</h2></div>
          <div className="bloco"><div className="mini">Melhor anúncio pago</div><h2>{pago ? FONTE_LONGA[pago.fonte] : "–"}</h2>{pago && <div className="mini">taxa de fechamento {pago.taxa}%</div>}</div>
        </div>
        <div className="grade g2">
          <table className="tab"><thead><tr><th>Fonte</th><th className="num">Contatos</th><th className="num">Quentes</th><th className="num">Fechamentos</th><th className="num">Taxa</th></tr></thead>
            <tbody>{r.fontes.map((f: any) => <tr key={f.fonte}><td>{FONTE_LONGA[f.fonte] ?? f.fonte}</td><td className="num">{f.contatos}</td><td className="num">{f.quentes}</td><td className="num">{f.fechamentos}</td><td className="num">{f.taxa}%</td></tr>)}</tbody></table>
          <table className="tab"><thead><tr><th>Campanha</th><th>Fonte</th><th className="num">Contatos</th><th className="num">Quentes</th></tr></thead>
            <tbody>{r.campanhasFonte.map((c: any, k: number) => <tr key={k}><td>{c.campanha}</td><td>{FONTE_LONGA[c.fonte] ?? c.fonte}</td><td className="num">{c.contatos}</td><td className="num">{c.quentes}</td></tr>)}</tbody></table>
        </div>
      </div>

      <div className="grade g2">
        <div className="cartao"><h2>Desempenho por pessoa (incluindo a IA)</h2><table className="tab" style={{ marginTop: 8 }}><thead><tr><th>Pessoa</th><th className="num">Atendidas</th><th className="num">Reuniões</th><th className="num">Vendas</th></tr></thead>
          <tbody>{r.pessoas.map((p: any) => <tr key={p.nome}><td>{p.nome === "IA" ? "🤖 IA" : p.nome}</td><td className="num">{p.atendidas}</td><td className="num">{p.reunioes}</td><td className="num">{brl(p.vendas)}</td></tr>)}</tbody></table></div>
        <div className="cartao"><h2>Custos do período</h2><table className="tab" style={{ marginTop: 8 }}><thead><tr><th>Provedor de IA</th><th className="num">Chamadas</th><th className="num">Falhas</th><th className="num">Custo</th></tr></thead>
          <tbody>{r.custos.map((c: any) => <tr key={c.provedor}><td>{c.provedor}</td><td className="num">{c.chamadas}</td><td className="num">{c.falhas}</td><td className="num">US$ {c.custo.toFixed(4)}</td></tr>)}</tbody></table>
          <div className="mini" style={{ marginTop: 8 }}>Custos de IA estimados pelos tokens. Mensagens da Meta e taxas dos gateways: conferir na fatura de cada fornecedor.</div></div>
      </div>
    </div>
  );
}
