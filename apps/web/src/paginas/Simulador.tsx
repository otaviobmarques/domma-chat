import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, tempoReal } from "../api.ts";
import { useAcao } from "../contexto.tsx";
import { hora } from "../util.ts";

/** Simulador: você escreve como se fosse o cliente no WhatsApp e vê a IA responder de verdade (com "digitando…"). */
export function Simulador() {
  const acao = useAcao();
  const [conexoes, setConexoes] = useState<any[]>([]);
  const [cx, setCx] = useState("");
  const [tel, setTel] = useState(() => { try { return localStorage.getItem("sim.tel") ?? "5531999990001"; } catch { return "5531999990001"; } });
  const [nome, setNome] = useState("Cliente Teste");
  const [texto, setTexto] = useState("");
  const [msgs, setMsgs] = useState<any[]>([]);
  const [conv, setConv] = useState<any>(null);
  const [digitando, setDigitando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => { api("/conexoes").then((cs) => { const s = cs.filter((c: any) => c.tipo === "simulador"); setConexoes(s); setCx(s[0]?.id ?? ""); }); }, []);
  const carregar = () => cx && api(`/simulador/${cx}/conversa?telefone=${tel}`).then((r) => { setConv(r.conversa); setMsgs(r.mensagens); });
  useEffect(() => { carregar(); try { localStorage.setItem("sim.tel", tel); } catch { /* ok */ } }, [cx, tel]);
  useEffect(() => {
    const s = tempoReal();
    const nova = (m: any) => { if (conv && m.conversa_id === conv.id) carregar(); else if (!conv) carregar(); };
    const dig = (e: any) => conv && e.conversaId === conv.id && setDigitando(e.ativo);
    s.on("mensagem.nova", nova); s.on("ia.digitando", dig);
    return () => { s.off("mensagem.nova", nova); s.off("ia.digitando", dig); };
  });
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [msgs.length, digitando]);

  const enviar = async (corpo: any) => { await acao(() => api(`/simulador/${cx}/mensagem`, { corpo: { telefone: tel, nome, ...corpo } })); carregar(); };

  if (!conexoes.length) return <div className="pagina"><h1>Simulador</h1><div className="aviso">Crie uma conexão do tipo <b>Simulador</b> em <Link to="/conexoes">Conexões</Link> para testar sem WhatsApp.</div></div>;
  return (
    <div className="pagina" style={{ maxWidth: 980 }}>
      <div className="cab"><div><span className="rotulo">Teste sem WhatsApp</span><h1>Simulador de cliente</h1><p className="sub" style={{ margin: 0 }}>Escreva como se fosse o cliente. A conversa aparece em Atendimento, igual a uma real.</p></div>
        {conv && <Link className="btn" to={`/atendimento/${conv.id}`}>Abrir no Atendimento →</Link>}</div>
      <div className="grade" style={{ gridTemplateColumns: "260px 1fr", alignItems: "start" }}>
        <div className="cartao pilha">
          <label className="campo">Conexão<select value={cx} onChange={(e) => setCx(e.target.value)}>{conexoes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
          <label className="campo">Telefone do cliente<input value={tel} onChange={(e) => setTel(e.target.value.replace(/\D/g, ""))} /></label>
          <label className="campo">Nome no WhatsApp<input value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          <button className="btn" onClick={() => setTel("55319" + String(Date.now()).slice(-8))}>Novo cliente</button>
          <div className="mini">Experimente: "oi", "quanto custa a pesquisa?", "quero abrir uma franquia, me manda a apresentação", "você é um robô?", "quero falar com um atendente", "me chama amanhã", "SAIR".</div>
        </div>
        <div className="cartao" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", height: "70vh", background: "#EFEAE2" }}>
          <div style={{ background: "#075E54", color: "#fff", padding: "10px 14px" }}><b>{nome}</b><div className="mini" style={{ color: "#cfe" }}>{digitando ? "a empresa está digitando…" : "simulação do WhatsApp do cliente"}</div></div>
          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
            {msgs.map((m) => (
              <div key={m.id} style={{ alignSelf: m.autor === "cliente" ? "flex-end" : "flex-start", background: m.autor === "cliente" ? "#DCF8C6" : "#fff", borderRadius: 8, padding: "6px 10px", maxWidth: "75%", boxShadow: "0 1px 1px rgba(0,0,0,.08)", whiteSpace: "pre-wrap", fontSize: 14 }}>
                {m.tipo === "reacao" ? <span style={{ fontSize: 18 }}>{m.conteudo}</span> : <>
                  {m.tipo === "documento" && <a href={m.midia_link} target="_blank" rel="noreferrer" style={{ display: "block", fontWeight: 700 }}>📄 {m.leitura ?? "arquivo"}</a>}
                  {m.tipo === "audio" && <i>🎤 áudio</i>}
                  {m.tipo === "imagem" && (m.midia_link ? <img src={m.midia_link} alt="" style={{ maxWidth: 200, display: "block", borderRadius: 6 }} /> : <i>📷 foto</i>)}
                  {m.conteudo}</>}
                <div style={{ fontSize: 10, color: "#888", textAlign: "right" }}>{hora(m.criado_em)}</div>
              </div>))}
            {digitando && <div style={{ alignSelf: "flex-start", background: "#fff", borderRadius: 8, padding: "6px 12px", color: "#888" }}>digitando…</div>}
            <div ref={fim} />
          </div>
          <form className="linha" style={{ padding: 10, background: "#F0F0F0", flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); if (texto.trim()) { enviar({ texto }); setTexto(""); } }}>
            <button type="button" className="btn pequeno" title="Simular áudio" onClick={() => enviar({ audio: true })}>🎤</button>
            <label className="btn pequeno" title="Enviar foto">📷<input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const b = await f.arrayBuffer(); const b64 = btoa(String.fromCharCode(...new Uint8Array(b))); enviar({ imagemBase64: b64, mime: f.type, texto: "" }); }} /></label>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Mensagem como cliente" aria-label="Mensagem como cliente" />
            <button className="btn primario">Enviar</button>
          </form>
        </div>
      </div>
    </div>
  );
}
