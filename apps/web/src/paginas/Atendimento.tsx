import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, baixar, tempoReal } from "../api.ts";
import { Modal, SeloFonte, Temperatura } from "../componentes.tsx";
import { useAcao, useApp } from "../contexto.tsx";
import { dataHora, FONTE_LONGA, hora, iniciais, MODO, quando } from "../util.ts";

const ATALHOS = ["Resumir conversa", "Oferecer reunião", "Dar um tempo até amanhã", "Partir pro fechamento", "Tom mais formal", "Mandar a apresentação"];

export function Atendimento() {
  const { id } = useParams();
  const [qs] = useSearchParams();
  const nav = useNavigate();
  const [lista, setLista] = useState<any[]>([]);
  const [modo, setModo] = useState(qs.get("modo") ?? "");
  const [filtro, setFiltro] = useState("");
  const [fonte, setFonte] = useState("");
  const [busca, setBusca] = useState("");

  const carregarLista = () => {
    const p = new URLSearchParams();
    if (modo) p.set("modo", modo); if (filtro) p.set("filtro", filtro); if (fonte) p.set("fonte", fonte); if (busca) p.set("busca", busca);
    api(`/conversas?${p}`).then(setLista).catch(() => {});
  };
  useEffect(() => { const t = setTimeout(carregarLista, busca ? 300 : 0); return () => clearTimeout(t); }, [modo, filtro, fonte, busca]);
  useEffect(() => {
    const s = tempoReal();
    let t: any; const ag = () => { clearTimeout(t); t = setTimeout(carregarLista, 400); };
    s.on("mensagem.nova", ag); s.on("conversa.atualizada", ag);
    return () => { s.off("mensagem.nova", ag); s.off("conversa.atualizada", ag); };
  });
  const cont = useMemo(() => ({ ia: lista.filter((c) => c.modo === "ia").length, aprova: lista.filter((c) => c.modo === "aprova").length, humano: lista.filter((c) => c.modo === "humano").length }), [lista]);

  return (
    <div className={"atend" + (id ? " com-conversa" : "")}>
      <section className="lista-col">
        <div style={{ padding: "14px 12px 8px" }} className="linha entre"><h2>Conversas</h2><span className="mini">IA {cont.ia} · Aprovar {cont.aprova} · Você {cont.humano}</span></div>
        <div style={{ padding: "0 12px 10px" }}><input placeholder="Buscar por nome ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar conversa" /></div>
        <div className="filtros">
          {[["", "Todas"], ["ia", "IA"], ["aprova", "Aprovar"], ["humano", "Humano"]].map(([v, n]) => <button key={v} className={"chip" + (modo === v ? " ativo" : "")} onClick={() => setModo(v)}>{n}</button>)}
        </div>
        <div className="filtros">
          <button className={"chip" + (filtro === "quentes" ? " ativo" : "")} onClick={() => setFiltro(filtro === "quentes" ? "" : "quentes")}><span className="ponto bg-quente" /> Quentes</button>
          <button className={"chip" + (filtro === "agendadas" ? " ativo" : "")} onClick={() => setFiltro(filtro === "agendadas" ? "" : "agendadas")}>🕘 Agendadas</button>
          <select value={fonte} onChange={(e) => setFonte(e.target.value)} style={{ width: "auto", padding: "3px 8px", fontSize: 12, borderRadius: 99 }} aria-label="Fonte">
            <option value="">Todas as fontes</option>{Object.entries(FONTE_LONGA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="conv-lista">
          {lista.length === 0 && <div className="vazio">Nenhuma conversa aqui. Use o <Link to="/simulador">Simulador</Link> para testar.</div>}
          {lista.map((c) => (
            <div key={c.id} className={"conv-item" + (c.id === id ? " ativo" : "")} onClick={() => nav(`/atendimento/${c.id}`)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && nav(`/atendimento/${c.id}`)}>
              <div className="avatar">{iniciais(c.contato_nome)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="linha entre" style={{ flexWrap: "nowrap" }}>
                  <span className="nome">{c.contato_nome ?? "+" + c.telefone}</span>
                  {c.retorno ? <span className="selo amarelo" title={`Retorno agendado ${dataHora(c.retorno.quando)}`}>🕘 {c.retorno.rotulo}</span> : <span className="mini">{quando(c.ultima_mensagem_em)}</span>}
                </div>
                <div className="prev">{c.ultima_mensagem_texto}</div>
                <div className="linha" style={{ gap: 6, marginTop: 4 }}>
                  <span className={`selo ${c.modo === "humano" ? "cinza" : ""}`}>{c.modo === "humano" ? "Humano" : c.modo === "aprova" ? "IA sugere" : "IA atendendo"}</span>
                  <Temperatura t={c.temperatura} />
                  <span style={{ marginLeft: "auto" }}><SeloFonte fonte={c.fonte_ultima} campanha={c.campanha} entrada={c.entrou_em} /></span>
                </div>
              </div>
              {c.nao_lidas > 0 && c.id !== id && <span className="badge">{c.nao_lidas}</span>}
            </div>
          ))}
        </div>
      </section>
      {id ? <Conversa key={id} id={id} /> : <section className="chat-col" style={{ display: "grid", placeItems: "center" }}><div className="vazio">Escolha uma conversa à esquerda.</div></section>}
    </div>
  );
}

function Conversa({ id }: { id: string }) {
  const { eu } = useApp();
  const acao = useAcao();
  const nav = useNavigate();
  const [c, setC] = useState<any>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [texto, setTexto] = useState("");
  const [interna, setInterna] = useState(false);
  const [pedido, setPedido] = useState("");
  const [digitando, setDigitando] = useState(false);
  const [devolver, setDevolver] = useState(false);
  const [discordancia, setDiscordancia] = useState<any>(null);
  const [editando, setEditando] = useState<string[] | null>(null);
  const [modal, setModal] = useState<"" | "cobranca" | "reuniao" | "material" | "retorno" | "exportar">("");
  const [aguardandoIA, setAguardandoIA] = useState(false);
  const fim = useRef<HTMLDivElement>(null);

  const carregar = async () => { const [cv, ms] = await Promise.all([api(`/conversas/${id}`), api(`/conversas/${id}/mensagens`)]); setC(cv); setMsgs(ms); };
  useEffect(() => { carregar().catch(() => nav("/atendimento")); }, [id]);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [msgs.length, digitando]);
  useEffect(() => {
    const s = tempoReal();
    const nova = (m: any) => { if (m.conversa_id !== id) return; setMsgs((x) => (x.some((y) => y.id === m.id) ? x : [...x, m])); if (m.autor === "ia") setDigitando(false); if (m.autor === "nota" && m.conteudo?.startsWith("🤖")) setAguardandoIA(false); };
    const status = (m: any) => m?.conversa_id === id && setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, ...m } : y)));
    const conv = (cv: any) => cv?.id === id && setC((a: any) => ({ ...a, ...cv }));
    const dig = (e: any) => e.conversaId === id && setDigitando(e.ativo);
    const sug = (s2: any) => s2.conversaId === id && (setC((a: any) => ({ ...a, sugestao: s2 })), setAguardandoIA(false));
    const ins = (r: any) => { if (r.conversaId !== id) return; setAguardandoIA(false); if (r.decisao === "sugerida" || r.decisao === "recusada") setDiscordancia(r); };
    s.on("mensagem.nova", nova); s.on("mensagem.status", status); s.on("conversa.atualizada", conv); s.on("ia.digitando", dig); s.on("sugestao.pronta", sug); s.on("instrucao.resposta", ins);
    return () => { s.off("mensagem.nova", nova); s.off("mensagem.status", status); s.off("conversa.atualizada", conv); s.off("ia.digitando", dig); s.off("sugestao.pronta", sug); s.off("instrucao.resposta", ins); };
  }, [id]);

  if (!c) return <section className="chat-col"><div className="vazio" style={{ padding: 20 }}>Carregando…</div></section>;

  const trocarModo = async (m: string, retomada?: string) => {
    if (m === "ia" && c.modo !== "ia" && !retomada) { setDevolver(true); return; }
    const r = await acao(() => api(`/conversas/${id}/modo`, { metodo: "PATCH", corpo: { modo: m, retomada } }));
    if (r) setC((a: any) => ({ ...a, ...r })); setDevolver(false);
  };
  const enviar = async () => {
    if (!texto.trim()) return;
    const t = texto; setTexto("");
    const r = await acao(() => api(`/conversas/${id}/mensagens`, { corpo: { texto: t, interna } }));
    if (!r) setTexto(t);
  };
  const pedirIA = async (t: string) => {
    if (!t.trim()) return;
    setPedido(""); setAguardandoIA(true); setDiscordancia(null);
    await acao(() => api(`/conversas/${id}/instrucoes`, { corpo: { texto: t } }));
  };
  const sugerir = async () => { setAguardandoIA(true); await acao(() => api(`/conversas/${id}/sugestao`, { corpo: {} })); };
  const resolverSugestao = async (a: "aprovar" | "editar" | "descartar", partes?: string[]) => {
    const ok = await acao(() => api(`/sugestoes/${c.sugestao.id}/${a}`, { corpo: partes ? { partes } : {} }));
    if (ok) { setC((x: any) => ({ ...x, sugestao: null })); setEditando(null); }
  };
  const travada = c.modo === "humano" && c.responsavel_id && c.responsavel_id !== eu?.id && eu?.perfil === "atendente";

  return (
    <>
      <section className="chat-col">
        <div className="linha entre cab-conversa" style={{ padding: "10px 14px", borderBottom: "1px solid var(--borda)", flexWrap: "nowrap" }}>
          <div className="linha" style={{ flexWrap: "nowrap", minWidth: 0 }}>
            <button className="btn pequeno voltar" onClick={() => nav("/atendimento")} aria-label="Voltar">←</button>
            <div className="avatar">{iniciais(c.contato_nome)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="linha" style={{ gap: 6 }}><h2 style={{ fontSize: 15 }}>{c.contato_nome ?? "+" + c.telefone}</h2><Temperatura t={c.temperatura} /><SeloFonte fonte={c.fonte_ultima} campanha={c.campanha} entrada={c.entrou_em} /></div>
              <div className="mini">+{c.telefone} · {c.conexao_tipo === "oficial" ? "API Oficial" : c.conexao_tipo === "qr" ? "QR Code" : "Simulador"}{c.opt_out ? " · ⛔ pediu para não receber" : ""}</div>
            </div>
          </div>
          <div className="linha controles-modo" style={{ flexWrap: "nowrap" }}>
            <span className="mini rotulo-modo" style={{ whiteSpace: "nowrap" }}>Quem responde:</span>
            <div className="seg" role="radiogroup" aria-label="Quem responde">
              <button className={c.modo === "ia" ? "ativo" : ""} onClick={() => trocarModo("ia")}>🤖 IA</button>
              <button className={c.modo === "aprova" ? "ativo" : ""} onClick={() => trocarModo("aprova")}>✓ IA sugere</button>
              <button className={c.modo === "humano" ? "ativo hum" : ""} onClick={() => trocarModo("humano")}>👤 Humano</button>
            </div>
            <button className="btn pequeno" onClick={() => setModal("exportar")} title="Exportar conversa">⤓</button>
          </div>
        </div>

        {devolver && (
          <div className="sugestao" style={{ marginTop: 10 }}>
            <h3>Devolver esta conversa para a IA</h3><div className="mini" style={{ marginBottom: 10 }}>Escolha como a IA retoma o atendimento de {c.contato_nome?.split(" ")[0] ?? "cliente"}.</div>
            <div className="grade g2" style={{ gap: 8 }}>
              <button className="opcao ativo" onClick={() => trocarModo("ia", "agora")}><b>Voltar com a IA e já falar com o cliente</b><div className="mini">A IA lê o histórico e envia a próxima mensagem agora.</div></button>
              <button className="opcao" onClick={() => trocarModo("ia", "esperar")}><b>Só voltar com a IA e esperar</b><div className="mini">A IA fica ativa e responde quando o cliente escrever.</div></button>
            </div>
            <div className="linha fim" style={{ marginTop: 8 }}><button className="btn pequeno fantasma" onClick={() => setDevolver(false)}>Cancelar</button></div>
          </div>
        )}

        <div className="mensagens" aria-live="polite">
          {msgs.map((m) => <Mensagem key={m.id} m={m} />)}
          {digitando && <div className="digitando">{c.modo === "ia" ? "IA digitando…" : "IA escrevendo sugestão…"}</div>}
          {aguardandoIA && <div className="digitando">A IA está pensando no seu pedido…</div>}
          <div ref={fim} />
        </div>

        {discordancia && (
          <div className="sugestao" style={{ borderColor: "var(--laranja)", marginBottom: 8 }}>
            <span className="rotulo" style={{ color: "#C46A12" }}>{discordancia.decisao === "recusada" ? "A IA não pode fazer isso" : "A IA sugere outro caminho"}</span>
            <p style={{ margin: "6px 0 10px" }}>{discordancia.explicacao}</p>
            <div className="linha">
              {discordancia.alternativa?.rotulo && <button className="btn primario pequeno" onClick={async () => { await acao(() => api(`/instrucoes/${discordancia.instrucaoId}/alternativa`, { corpo: {} })); setDiscordancia(null); }}>{discordancia.alternativa.rotulo} (sugestão da IA)</button>}
              {discordancia.decisao === "sugerida" && <button className="btn pequeno" onClick={async () => { const r = await acao(() => api(`/instrucoes/${discordancia.instrucaoId}/seguir`, { corpo: {} })); if (r) { setDiscordancia(null); setAguardandoIA(true); } }}>Seguir com meu pedido</button>}
              <button className="btn pequeno fantasma" onClick={async () => { await api(`/instrucoes/${discordancia.instrucaoId}/cancelar`, { corpo: {} }); setDiscordancia(null); }}>Cancelar</button>
            </div>
          </div>
        )}

        <div className="copiloto">
          <div className="linha rolar" style={{ gap: 6, marginBottom: 8 }}>
            <span className="rotulo" style={{ fontSize: 9.5 }}>Fale com a IA</span>
            {ATALHOS.map((a) => <button key={a} className="chip" onClick={() => pedirIA(a)}>{a}</button>)}
          </div>
          <form className="linha" style={{ flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); pedirIA(pedido); }}>
            <input value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Peça algo à IA nesta conversa. Ex.: ofereça a pesquisa completa com frete grátis" aria-label="Pedido para a IA" />
            <button className="btn primario">✦ Pedir</button>
          </form>
          <div className="mini" style={{ marginTop: 6 }}>Só a equipe vê. {c.modo === "ia" ? "No modo IA a IA envia na hora." : "Neste modo, o que a IA escrever vira sugestão para você aprovar."}</div>
        </div>

        {c.sugestao && (
          <div className="sugestao" style={{ marginTop: 8 }}>
            <span className="rotulo">Sugestão da IA · confira antes de enviar</span>
            {editando ? (
              <div className="pilha" style={{ marginTop: 8 }}>{editando.map((p, k) => <textarea key={k} value={p} onChange={(e) => setEditando(editando.map((x, j) => (j === k ? e.target.value : x)))} />)}</div>
            ) : (
              <div style={{ margin: "8px 0" }}>{c.sugestao.partes.map((p: string, k: number) => <p key={k} style={{ margin: "4px 0" }}>{/^\[\[material:/.test(p) ? "📎 (arquivo da biblioteca de materiais)" : p}</p>)}</div>
            )}
            <div className="linha">
              {editando ? <button className="btn primario pequeno" onClick={() => resolverSugestao("editar", editando.filter((x) => x.trim()))}>Enviar editada</button>
                : <button className="btn primario pequeno" onClick={() => resolverSugestao("aprovar")}>Aprovar e enviar</button>}
              {!editando && <button className="btn pequeno" onClick={() => setEditando([...c.sugestao.partes])}>Editar</button>}
              <button className="btn pequeno fantasma" onClick={() => (editando ? setEditando(null) : resolverSugestao("descartar"))}>{editando ? "Cancelar" : "Descartar"}</button>
            </div>
          </div>
        )}

        <div className="compor">
          <div className="linha rolar" style={{ gap: 6 }}>
            <button className="chip" onClick={sugerir}>✦ Sugerir resposta</button>
            <button className="chip" onClick={() => setModal("cobranca")}>Enviar cobrança Pix</button>
            <button className="chip" onClick={() => setModal("reuniao")}>Marcar reunião com vendedor</button>
            <button className="chip" onClick={() => setModal("material")}>📎 Enviar material</button>
            <label className="linha mini" style={{ marginLeft: "auto", gap: 6 }}><input type="checkbox" checked={interna} onChange={(e) => setInterna(e.target.checked)} style={{ width: "auto" }} /> Nota interna</label>
          </div>
          {travada ? <div className="aviso amarelo">Conversa travada: {c.responsavel_nome} está atendendo.</div> : (
            <form className="linha" style={{ flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); enviar(); }}>
              <textarea rows={1} style={{ minHeight: 40, background: interna ? "var(--amarelo-bg)" : undefined }} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={interna ? "Nota interna (só a equipe vê)…" : c.modo === "humano" ? "Escreva sua mensagem…" : "Escreva para assumir a conversa…"}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }} aria-label="Mensagem" />
              <button className="btn escuro" aria-label="Enviar" style={{ height: 40 }}>➤</button>
            </form>
          )}
        </div>
      </section>
      <PainelContato c={c} setC={setC} abrirRetorno={() => setModal("retorno")} />
      {modal === "cobranca" && <ModalCobranca id={id} fechar={() => setModal("")} />}
      {modal === "reuniao" && <ModalReuniao id={id} c={c} fechar={() => setModal("")} />}
      {modal === "material" && <ModalMaterial id={id} fechar={() => setModal("")} />}
      {modal === "retorno" && <ModalRetorno id={id} c={c} fechar={() => setModal("")} />}
      {modal === "exportar" && <ModalExportar id={id} nome={c.contato_nome} fechar={() => setModal("")} />}
    </>
  );
}

function Mensagem({ m }: { m: any }) {
  if (m.tipo === "evento" || m.autor === "sistema") return <div className="evento">{m.conteudo} · {hora(m.criado_em)}</div>;
  if (m.tipo === "reacao") return <div className={m.autor === "cliente" ? "" : "digitando"} style={{ alignSelf: m.autor === "cliente" ? "flex-start" : "flex-end", fontSize: 20 }} title="Reação">{m.conteudo}</div>;
  const quem = m.autor === "ia" ? "IA" : m.autor === "humano" ? (m.autor_nome ?? (m.leitura === "enviada pelo celular" ? "Atendente (celular)" : "Atendente")) : m.autor === "nota" ? `Nota interna${m.autor_nome ? " · " + m.autor_nome : ""} · só a equipe vê` : null;
  return (
    <div className={`msg ${m.autor === "cliente" ? "" : m.autor}${m.status === "falhou" ? " falhou" : ""}`}>
      {quem && <div className="quem">{quem}</div>}
      {m.tipo === "audio" && (m.midia_link ? <audio controls src={m.midia_link} style={{ width: 240, height: 36 }} /> : <div className="mini">🎤 Áudio</div>)}
      {m.tipo === "imagem" && (m.midia_link ? <img src={m.midia_link} alt="Foto enviada" style={{ maxWidth: 240, borderRadius: 8, display: "block" }} /> : <div className="mini">📷 Foto</div>)}
      {m.tipo === "documento" && <a href={m.midia_link} target="_blank" rel="noreferrer" style={{ display: "block", fontWeight: 700, color: "inherit" }}>📄 {m.leitura ?? "Documento"}</a>}
      {m.conteudo && <div>{m.conteudo}</div>}
      {m.leitura && ["audio", "imagem"].includes(m.tipo) && <div className="leitura"><b>{m.tipo === "audio" ? "TRANSCRIÇÃO DA IA" : "A IA LEU NA FOTO"}</b>{m.leitura}</div>}
      {m.status === "falhou" && <div className="mini" style={{ color: "var(--vermelho)" }}>Não enviada: {m.erro}</div>}
      <div className="meta">{hora(m.criado_em)}{m.autor !== "cliente" && m.autor !== "nota" && <span>{({ pendente: "⏳", enviada: "✓", entregue: "✓✓", lida: "✓✓ lida" } as any)[m.status] ?? ""}</span>}</div>
    </div>
  );
}

function PainelContato({ c, setC, abrirRetorno }: { c: any; setC: (f: any) => void; abrirRetorno: () => void }) {
  const acao = useAcao();
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [filas, setFilas] = useState<any[]>([]);
  useEffect(() => { api("/usuarios").then(setUsuarios).catch(() => {}); api("/filas").then(setFilas).catch(() => {}); }, []);
  const patch = async (corpo: any) => { const r = await acao(() => api(`/conversas/${c.id}`, { metodo: "PATCH", corpo })); if (r) setC((a: any) => ({ ...a, ...r })); };
  const dados = Object.entries(c.dados_extraidos ?? {});
  return (
    <section className="lado painel">
      <div className="bloco" style={c.temperatura === "quente" ? { borderColor: "var(--vermelho)" } : undefined}>
        <div className="linha entre"><span className="rotulo" style={{ margin: 0 }}>Classificação da IA</span><b className={`temp-${c.temperatura}`} style={{ fontSize: 18 }}>{c.nota ?? "–"}</b></div>
        {c.temperatura ? <>
          <div className="linha" style={{ gap: 6, margin: "8px 0" }}><span className={`selo ${c.temperatura === "quente" ? "urgente" : c.temperatura === "morno" ? "atencao" : ""}`}>● Lead {c.temperatura}</span>{c.interesse && <span className="selo">{c.interesse}</span>}</div>
          <div className="mini">Por quê</div><div style={{ fontSize: 12.5, marginBottom: 8 }}>{c.motivo_classificacao}</div>
          {dados.length > 0 && <dl className="kv" style={{ background: "var(--lavanda)", padding: 8, borderRadius: 8 }}>{dados.map(([k, v]) => <><dt key={k}>{k}</dt><dd key={k + "v"}>{String(v)}</dd></>)}</dl>}
          <div className="linha entre" style={{ marginTop: 8 }}><span className="mini">Corrigir</span>
            <select style={{ width: "auto" }} value="" onChange={async (e) => { const r = await acao(() => api(`/conversas/${c.id}/classificacao`, { metodo: "PATCH", corpo: { temperatura: e.target.value } }), "Correção registrada"); if (r) setC((a: any) => ({ ...a, ...r })); }}>
              <option value="">Manter</option><option value="quente">Quente</option><option value="morno">Morno</option><option value="frio">Frio</option>
            </select></div>
        </> : <div className="mini" style={{ marginTop: 6 }}>A IA classifica a cada mensagem.</div>}
      </div>
      {c.retorno && (
        <div className="bloco" style={{ borderColor: "var(--amarelo)", background: "#FFFDF5" }}>
          <span className="rotulo" style={{ color: "#9B7A1C" }}>🕘 Retorno agendado</span>
          <h3>{c.retorno.rotulo}</h3>
          <div className="mini" style={{ margin: "4px 0 8px" }}>{c.retorno.executor === "ia" ? "No horário, a IA retoma a conversa com o contexto." : "Conversa com humano: no horário, você recebe o lembrete."}</div>
          <div className="linha"><button className="btn pequeno" onClick={abrirRetorno}>Alterar horário</button><button className="btn pequeno fantasma" onClick={async () => { await acao(() => api(`/conversas/${c.id}/retorno`, { metodo: "DELETE" }), "Retorno cancelado"); setC((a: any) => ({ ...a, retorno: null })); }}>Cancelar</button></div>
        </div>
      )}
      {!c.retorno && <button className="btn pequeno" onClick={abrirRetorno}>🕘 Agendar retorno</button>}
      <div className="bloco"><span className="rotulo">Origem</span><dl className="kv">
        <dt>Fonte</dt><dd><SeloFonte fonte={c.fonte_ultima} /></dd><dt>Primeira fonte</dt><dd>{FONTE_LONGA[c.fonte_primeira] ?? "–"}</dd>
        <dt>Campanha</dt><dd>{c.campanha ?? "–"}</dd><dt>Entrada</dt><dd>{dataHora(c.entrou_em)}</dd></dl></div>
      <div className="bloco"><span className="rotulo">Contato</span><dl className="kv">
        <dt>Telefone</dt><dd>+{c.telefone}</dd><dt>Cidade</dt><dd>{c.cidade ?? "–"}</dd><dt>Conexão</dt><dd>{c.conexao_nome}</dd>
        <dt>Etiquetas</dt><dd>{(c.etiquetas ?? []).join(", ") || "–"}</dd></dl></div>
      <div className="bloco pilha"><span className="rotulo" style={{ margin: 0 }}>Atendimento</span>
        <label className="campo">Fila<select value={c.fila ?? ""} onChange={(e) => patch({ fila: e.target.value })}>{filas.map((f) => <option key={f.id}>{f.nome}</option>)}</select></label>
        <label className="campo">Responsável<select value={c.responsavel_id ?? ""} onChange={(e) => patch({ responsavel_id: e.target.value || null })}><option value="">—</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome} ({u.status})</option>)}</select></label>
        <label className="campo">Etapa do funil<select value="" onChange={(e) => e.target.value && patch({ etiquetas: [...(c.etiquetas ?? []), e.target.value] })}><option value="">Adicionar etiqueta…</option>{["Novo contato", "Orçamento enviado", "Reunião marcada", "Aguardando pagamento", "Pagou"].map((x) => <option key={x}>{x}</option>)}</select></label>
        <button className="btn pequeno fantasma" onClick={() => patch({ estado: "encerrada" })}>Encerrar conversa</button>
      </div>
      <div className="bloco"><span className="rotulo">Resumo da IA</span><div style={{ fontSize: 12.5 }}>{c.resumo_ia ?? "Ainda sem resumo."}</div>{c.motivo_transferencia && <div className="mini" style={{ marginTop: 6 }}>Transferência: {c.motivo_transferencia}</div>}</div>
    </section>
  );
}

function ModalCobranca({ id, fechar }: { id: string; fechar: () => void }) {
  const acao = useAcao(); const [valor, setValor] = useState(""); const [descricao, setDescricao] = useState(""); const [forma, setForma] = useState("pix");
  return <Modal titulo="Enviar cobrança" fechar={fechar}><form className="pilha" onSubmit={async (e) => { e.preventDefault(); const r = await acao(() => api(`/conversas/${id}/cobrancas`, { corpo: { valor: Number(valor.replace(",", ".")), descricao, forma } })); if (r) { fechar(); } }}>
    <label className="campo">Serviço / descrição<input value={descricao} onChange={(e) => setDescricao(e.target.value)} required placeholder="Pesquisa veicular completa" /></label>
    <div className="grade g2"><label className="campo">Valor (R$)<input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} required /></label>
      <label className="campo">Forma<select value={forma} onChange={(e) => setForma(e.target.value)}><option value="pix">Pix</option><option value="boleto">Boleto</option><option value="cartao">Cartão</option></select></label></div>
    <div className="mini">Valores acima do limite configurado pedem aprovação de supervisor. O link é enviado na conversa e, quando o pagamento cair, a conversa recebe a etiqueta "Pagou".</div>
    <div className="linha fim"><button type="button" className="btn" onClick={fechar}>Cancelar</button><button className="btn primario">Gerar e enviar</button></div></form></Modal>;
}

function ModalReuniao({ id, c, fechar }: { id: string; c: any; fechar: () => void }) {
  const acao = useAcao(); const [us, setUs] = useState<any[]>([]); const [v, setV] = useState(""); const [ini, setIni] = useState(""); const [dur, setDur] = useState(30); const [formato, setFormato] = useState("meet");
  useEffect(() => { api("/usuarios").then((u) => { setUs(u); const cid = (c.dados_extraidos?.cidade ?? c.cidade ?? "").toLowerCase(); setV((u.find((x: any) => x.cidades?.some((y: string) => y.toLowerCase() === cid)) ?? u[0])?.id ?? ""); }); }, []);
  return <Modal titulo="Marcar reunião com vendedor" fechar={fechar}><form className="pilha" onSubmit={async (e) => { e.preventDefault(); const r = await acao(() => api(`/conversas/${id}/reunioes`, { corpo: { vendedor_id: v, inicio: new Date(ini).toISOString(), duracao_min: dur, formato } }), "Reunião marcada"); if (r) fechar(); }}>
    <label className="campo">Vendedor<select value={v} onChange={(e) => setV(e.target.value)}>{us.map((u) => <option key={u.id} value={u.id}>{u.nome}{u.cidades?.length ? ` · ${u.cidades.join(", ")}` : ""}{u.google_agenda_conectada ? " · agenda ✓" : ""}</option>)}</select></label>
    <div className="grade g3"><label className="campo">Início<input type="datetime-local" value={ini} onChange={(e) => setIni(e.target.value)} required /></label>
      <label className="campo">Duração<select value={dur} onChange={(e) => setDur(Number(e.target.value))}>{[20, 30, 45, 60].map((d) => <option key={d} value={d}>{d} min</option>)}</select></label>
      <label className="campo">Formato<select value={formato} onChange={(e) => setFormato(e.target.value)}><option value="meet">Google Meet</option><option value="ligacao">Ligação</option><option value="presencial">Presencial</option></select></label></div>
    <div className="aviso">O resumo da conversa, os gatilhos de fechamento e o link da conversa vão na descrição do evento.</div>
    <div className="linha fim"><button type="button" className="btn" onClick={fechar}>Cancelar</button><button className="btn primario">Marcar</button></div></form></Modal>;
}

function ModalMaterial({ id, fechar }: { id: string; fechar: () => void }) {
  const acao = useAcao(); const [ms, setMs] = useState<any[] | null>(null);
  useEffect(() => { api("/materiais").then(setMs); }, []);
  return <Modal titulo="Enviar material" fechar={fechar}>
    {!ms ? <div className="vazio">Carregando…</div> : ms.length === 0 ? <div className="vazio">Nenhum material cadastrado. Cadastre em <Link to="/agente">Agente de IA → Materiais</Link>.</div> :
      <div className="lista">{ms.filter((m) => m.ativo).map((m) => <div key={m.id} className="item linha entre"><div><h3>📄 {m.titulo}</h3><div className="mini">{m.nome_arquivo} · enviado {m.envios}x</div></div>
        <button className="btn pequeno primario" onClick={async () => { const r = await acao(() => api(`/conversas/${id}/materiais/${m.id}`, { corpo: {} }), "Material enviado"); if (r) fechar(); }}>Enviar</button></div>)}</div>}
  </Modal>;
}

function ModalRetorno({ id, c, fechar }: { id: string; c: any; fechar: () => void }) {
  const acao = useAcao(); const [q, setQ] = useState(""); const [ex, setEx] = useState(c.modo === "humano" ? "lembrete" : "ia");
  return <Modal titulo="Retorno agendado" fechar={fechar}><form className="pilha" onSubmit={async (e) => { e.preventDefault(); const r = await acao(() => api(`/conversas/${id}/retorno`, { metodo: "PUT", corpo: { quando: new Date(q).toISOString(), executor: ex } }), "Retorno agendado"); if (r) fechar(); }}>
    <label className="campo">Quando<input type="datetime-local" value={q} onChange={(e) => setQ(e.target.value)} required /></label>
    <label className="campo">Quem retoma<select value={ex} onChange={(e) => setEx(e.target.value)}><option value="ia">A IA retoma a conversa</option><option value="lembrete">Lembrete para a equipe</option></select></label>
    <div className="mini">Fora do horário comercial ou em feriado, o retorno vai para a próxima abertura. Se o cliente escrever antes, é cancelado.</div>
    <div className="linha fim"><button type="button" className="btn" onClick={fechar}>Cancelar</button><button className="btn primario">Agendar</button></div></form></Modal>;
}

function ModalExportar({ id, nome, fechar }: { id: string; nome?: string; fechar: () => void }) {
  const acao = useAcao(); const [notas, setNotas] = useState(true); const [gerando, setGerando] = useState("");
  const ir = async (formato: "pdf" | "txt") => { setGerando(formato); await acao(() => baixar(`/conversas/${id}/exportar?formato=${formato}&notas=${notas ? 1 : 0}`, `conversa-${nome ?? id}.${formato}`)); setGerando(""); fechar(); };
  return <Modal titulo="Exportar conversa" fechar={fechar}><div className="pilha">
    <p className="sub" style={{ margin: 0 }}>Histórico completo com quem falou (cliente, IA, atendente), transcrições de áudio, leituras de foto, arquivos enviados, classificação e resumo da IA. O PDF sai com a identidade da Domma, em página única.</p>
    <label className="linha" style={{ gap: 8 }}><input type="checkbox" checked={notas} onChange={(e) => setNotas(e.target.checked)} style={{ width: "auto" }} /> Incluir notas internas e conversas com a IA (só a equipe via)</label>
    <div className="linha fim"><button className="btn" disabled={!!gerando} onClick={() => ir("txt")}>{gerando === "txt" ? "Gerando…" : "Baixar TXT"}</button><button className="btn primario" disabled={!!gerando} onClick={() => ir("pdf")}>{gerando === "pdf" ? "Gerando…" : "Baixar PDF"}</button></div>
  </div></Modal>;
}
