import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Carregando, Chave, Modal, useDados } from "../componentes.tsx";
import { useAcao } from "../contexto.tsx";

const PROVEDORES: Record<string, { nome: string; desc: string; modelos: string[] }> = {
  anthropic: { nome: "Claude (Anthropic)", desc: "Ótimo em conversa natural e em seguir regras", modelos: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  openai: { nome: "ChatGPT (OpenAI)", desc: "Também usado para transcrever áudios", modelos: [] },
  gemini: { nome: "Gemini (Google)", desc: "Bom para ler imagens e documentos", modelos: [] },
  compativel: { nome: "Outro (compatível com OpenAI)", desc: "OpenRouter, DeepSeek, Groq… informe o endereço da API", modelos: [] },
  simulado: { nome: "Simulado (testes)", desc: "Regras simples, sem custo. Só para testes; não use em produção", modelos: ["regras"] },
};
const EXEMPLO_PREVIA: Record<string, string> = {
  consultora: "Oi! Que bom falar com você. Me passa a placa do carro que eu já vejo isso pra você?",
  especialista: "Claro. A pesquisa completa cruza leilão, sinistro e débitos — assim você evita surpresas. Qual a placa?",
  vendedor: "Perfeito! Te mando o link agora e em 5 minutos você tem o resultado. Qual a placa?",
  premium: "Bom dia, senhor. Será um prazer ajudar. Poderia, por gentileza, informar a placa do veículo?",
  mineiro: "Ô, que trem bão! Me passa a placa do carro que eu já vejo isso procê, uai.",
  personalizada: "(segue as instruções extras)",
};

export function Agente() {
  const acao = useAcao();
  const { dados } = useDados(() => api("/agente"));
  const [a, setA] = useState<any>(null);
  useEffect(() => { if (dados) setA(dados.agente ?? { personalidade: "consultora", nome: "Duda", emojis: "poucos", tratamento: "voce", instrucoes: "", modo_padrao: "ia", velocidade_escrita: "natural", regras: {}, capacidades: {}, classificacao: { interesses: [] }, anti_loop: {} }); }, [dados]);
  if (!a || !dados) return <div className="pagina"><Carregando /></div>;
  const set = (k: string, v: any) => setA({ ...a, [k]: v });
  const setR = (k: string, v: any) => setA({ ...a, regras: { ...a.regras, [k]: v } });
  const salvar = () => acao(() => api("/agente", { metodo: "PUT", corpo: a }), "Agente salvo");
  const P = dados.personalidades as Record<string, any>;
  const interesses: any[] = a.classificacao?.interesses ?? [];
  const setInteresses = (l: any[]) => set("classificacao", { ...a.classificacao, interesses: l });
  const al = { repeticoes: 3, maxPor10min: 8, maxDia: 60, roboMs: 2000, agruparMs: 4000, ...(a.anti_loop ?? {}) };

  return (
    <div className="pagina">
      <div className="cab"><div><span className="rotulo">Configuração</span><h1>Agente de IA</h1><p className="sub" style={{ margin: 0 }}>Defina quem a IA é, como ela fala, o que ela sabe e quais inteligências usa por trás.</p></div><button className="btn primario" onClick={salvar}>Salvar alterações</button></div>

      <div className="cartao" style={{ marginBottom: 14 }}>
        <h2>1. Personalidade</h2><p className="sub">Escolha um modelo pronto e ajuste. A prévia mostra como a IA responderia.</p>
        <div className="grade" style={{ gridTemplateColumns: "minmax(0,1fr) 300px" }}>
          <div className="grade g3" style={{ gap: 10, alignContent: "start" }}>
            {Object.entries(P).map(([k, p]) => <button key={k} className={"opcao" + (a.personalidade === k ? " ativo" : "")} onClick={() => set("personalidade", k)}><b>{p.nome}</b><div className="mini">{p.jeito}</div></button>)}
          </div>
          <div className="pilha">
            <div style={{ background: "var(--marinho)", borderRadius: 12, padding: 12 }}>
              <span className="rotulo" style={{ color: "#CFC8F5" }}>Prévia</span>
              <div className="msg" style={{ marginTop: 8, maxWidth: "90%" }}>Oi, quero fazer uma pesquisa de um carro.</div>
              <div className="msg ia" style={{ marginTop: 8, marginLeft: "auto", maxWidth: "90%" }}><div className="quem">{a.nome} · IA</div>{EXEMPLO_PREVIA[a.personalidade]}</div>
            </div>
            <label className="campo">Nome da assistente<input value={a.nome} onChange={(e) => set("nome", e.target.value)} /></label>
            <div className="grade g2"><label className="campo">Emojis<select value={a.emojis} onChange={(e) => set("emojis", e.target.value)}><option value="nenhum">Nenhum</option><option value="poucos">Poucos</option><option value="moderado">Moderado</option></select></label>
              <label className="campo">Tratamento<select value={a.tratamento} onChange={(e) => set("tratamento", e.target.value)}><option value="voce">Você</option><option value="senhor">Senhor/Senhora</option></select></label></div>
            <label className="campo">Instruções extras<textarea value={a.instrucoes} onChange={(e) => set("instrucoes", e.target.value)} placeholder="Ex.: sempre ofereça a pesquisa completa para quem vai comprar carro usado." /></label>
          </div>
        </div>
      </div>

      <Provedores />
      <Materiais />
      <Base />

      <div className="cartao" style={{ marginBottom: 14 }}>
        <h2>5. Regras, proibições e modo de trabalho</h2>
        <div className="grade g2" style={{ marginTop: 10 }}>
          <div className="pilha">
            <label className="campo">Passa para humano quando (uma regra por linha)<textarea rows={4} value={(a.regras.transferirQuando ?? ["o cliente pede atendente ou pessoa", "duas tentativas sem solução", "irritação ou reclamação", "negociação de desconto"]).join("\n")} onChange={(e) => setR("transferirQuando", e.target.value.split("\n").filter(Boolean))} /></label>
            <label className="campo">Proibições (uma por linha)<textarea rows={3} value={(a.regras.proibicoes ?? ["inventar preço, prazo ou informação", "falar de assuntos fora do negócio", "pedir senhas ou dados de cartão"]).join("\n")} onChange={(e) => setR("proibicoes", e.target.value.split("\n").filter(Boolean))} /></label>
          </div>
          <div className="pilha">
            <label className="campo">Modo padrão das novas conversas<select value={a.modo_padrao} onChange={(e) => set("modo_padrao", e.target.value)}><option value="ia">Automático (IA responde)</option><option value="aprova">IA sugere, você aprova</option></select></label>
            <label className="campo">Velocidade da escrita humana<select value={a.velocidade_escrita} onChange={(e) => set("velocidade_escrita", e.target.value)}><option value="rapida">Rápida</option><option value="natural">Natural</option><option value="calma">Calma</option></select></label>
            <label className="campo">Desconto máximo sem aprovação (%)<input type="number" min={0} max={100} value={a.regras.descontoMaximo ?? 10} onChange={(e) => setR("descontoMaximo", Number(e.target.value))} /></label>
            <div className="aviso">Regra fixa: se o cliente perguntar se fala com um robô, a IA confirma que é a assistente virtual e oferece um atendente. A IA responde só sobre o negócio (política da Meta para IA).</div>
          </div>
        </div>
      </div>

      <div className="cartao" style={{ marginBottom: 14 }}>
        <h2>6. Classificação de leads</h2><p className="sub">Quente 75–100 · Morno 45–74 · Frio 0–44. Cada interesse tem seus sinais e pesos.</p>
        <div className="pilha">
          {interesses.map((it, k) => (
            <div key={k} className="bloco pilha">
              <div className="linha entre"><input style={{ maxWidth: 260, fontWeight: 700 }} value={it.nome} onChange={(e) => setInteresses(interesses.map((x, j) => (j === k ? { ...x, nome: e.target.value } : x)))} /><button className="btn pequeno perigo" onClick={() => setInteresses(interesses.filter((_, j) => j !== k))}>Remover</button></div>
              {it.sinais.map((s: any, si: number) => (
                <div key={si} className="linha" style={{ flexWrap: "nowrap" }}>
                  <input value={s.sinal} onChange={(e) => setInteresses(interesses.map((x, j) => (j === k ? { ...x, sinais: x.sinais.map((y: any, z: number) => (z === si ? { ...y, sinal: e.target.value } : y)) } : x)))} />
                  <input type="number" style={{ width: 80 }} value={s.peso} onChange={(e) => setInteresses(interesses.map((x, j) => (j === k ? { ...x, sinais: x.sinais.map((y: any, z: number) => (z === si ? { ...y, peso: Number(e.target.value) } : y)) } : x)))} />
                  <button className="btn pequeno fantasma" onClick={() => setInteresses(interesses.map((x, j) => (j === k ? { ...x, sinais: x.sinais.filter((_: any, z: number) => z !== si) } : x)))}>✕</button>
                </div>))}
              <button className="btn pequeno" style={{ alignSelf: "flex-start" }} onClick={() => setInteresses(interesses.map((x, j) => (j === k ? { ...x, sinais: [...x.sinais, { sinal: "", peso: 10 }] } : x)))}>+ Sinal</button>
            </div>))}
          <button className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setInteresses([...interesses, { nome: "novo interesse", sinais: [] }])}>+ Interesse</button>
        </div>
      </div>

      <div className="cartao" style={{ marginBottom: 14 }}>
        <h2>7. Proteção contra loop</h2><p className="sub">O sistema decide SE a IA responde; a IA decide só O QUE responder.</p>
        <div className="grade g3">
          <label className="campo">Mesma mensagem repetida (vezes em 10 min)<input type="number" value={al.repeticoes} onChange={(e) => set("anti_loop", { ...al, repeticoes: Number(e.target.value) })} /></label>
          <label className="campo">Máx. respostas da IA a cada 10 min<input type="number" value={al.maxPor10min} onChange={(e) => set("anti_loop", { ...al, maxPor10min: Number(e.target.value) })} /></label>
          <label className="campo">Máx. respostas da IA por dia<input type="number" value={al.maxDia} onChange={(e) => set("anti_loop", { ...al, maxDia: Number(e.target.value) })} /></label>
          <label className="campo">Robô do outro lado: respostas em menos de (ms)<input type="number" value={al.roboMs} onChange={(e) => set("anti_loop", { ...al, roboMs: Number(e.target.value) })} /></label>
          <label className="campo">Mensagens picadas: esperar silêncio de (ms)<input type="number" value={al.agruparMs} onChange={(e) => set("anti_loop", { ...al, agruparMs: Number(e.target.value) })} /></label>
        </div>
      </div>
      <div className="linha fim"><button className="btn primario" onClick={salvar}>Salvar alterações</button></div>
    </div>
  );
}

function Provedores() {
  const acao = useAcao();
  const { dados: lista, recarregar } = useDados<any[]>(() => api("/provedores-ia"));
  const [novo, setNovo] = useState<any>(null);
  const [chaves, setChaves] = useState<Record<string, string>>({});
  const [testes, setTestes] = useState<Record<string, any>>({});
  if (!lista) return <Carregando />;
  const mover = async (k: number, d: number) => { const ids = lista.map((p) => p.id); [ids[k], ids[k + d]] = [ids[k + d], ids[k]]; await acao(() => api("/provedores-ia/ordem", { metodo: "PUT", corpo: { ids } })); recarregar(); };
  return (
    <div className="cartao" style={{ marginBottom: 14 }}>
      <div className="linha entre"><h2>2. Inteligências (provedores de IA)</h2><span className="selo">Ordem: {lista.filter((p) => p.ativo).map((p) => p.rotulo ?? p.provedor).join(" → ") || "nenhuma"}</span></div>
      <p className="sub">Cole a chave de API de cada provedor. A ordem define quem responde: se o principal falhar, demorar ou passar do limite do mês, o próximo assume sozinho. As chaves ficam criptografadas e nunca mais são exibidas.</p>
      <div className="pilha">
        {lista.map((p, k) => (
          <div key={p.id} className="bloco pilha" style={{ opacity: p.ativo ? 1 : 0.6 }}>
            <div className="linha entre">
              <div className="linha"><span className="selo" style={{ background: k === 0 ? "var(--roxo)" : "var(--marinho)", color: "#fff", borderRadius: 6 }}>{!p.ativo ? "Desligado" : k === 0 ? "Principal" : `Backup ${k}`}</span>
                <div><h3>{PROVEDORES[p.provedor]?.nome ?? p.provedor}{p.rotulo ? ` · ${p.rotulo}` : ""}</h3><div className="mini">{PROVEDORES[p.provedor]?.desc}</div></div></div>
              <div className="linha">
                {k > 0 && <button className="btn pequeno" onClick={() => mover(k, -1)}>Subir na ordem</button>}
                {p.ultimo_erro ? <span className="selo urgente" title={p.ultimo_erro}>Com falha</span> : p.ultimo_tempo_ms ? <span className="selo verde">Conectado · {(p.ultimo_tempo_ms / 1000).toFixed(1)} s</span> : null}
                <Chave marcado={p.ativo} onChange={async (v) => { await acao(() => api(`/provedores-ia/${p.id}`, { metodo: "PATCH", corpo: { ativo: v } })); recarregar(); }} />
              </div>
            </div>
            <div className="grade g3">
              <label className="campo">Chave de API {p.chave_final && <span className="mini">(atual {p.chave_final})</span>}<input type="password" placeholder={p.provedor === "simulado" ? "não precisa" : "Cole a chave aqui"} value={chaves[p.id] ?? ""} onChange={(e) => setChaves({ ...chaves, [p.id]: e.target.value })} onBlur={async () => { if (chaves[p.id]) { await acao(() => api(`/provedores-ia/${p.id}`, { metodo: "PATCH", corpo: { chave: chaves[p.id] } }), "Chave salva"); setChaves({ ...chaves, [p.id]: "" }); recarregar(); } }} /></label>
              <label className="campo">Modelo<input list={`modelos-${p.provedor}`} defaultValue={p.modelo} onBlur={async (e) => { if (e.target.value !== p.modelo) { await acao(() => api(`/provedores-ia/${p.id}`, { metodo: "PATCH", corpo: { modelo: e.target.value } }), "Modelo salvo"); recarregar(); } }} />
                <datalist id={`modelos-${p.provedor}`}>{PROVEDORES[p.provedor]?.modelos.map((m) => <option key={m} value={m} />)}</datalist></label>
              <label className="campo">Limite de gasto mensal (US$)<input type="number" defaultValue={p.limite_mensal ?? ""} placeholder="sem limite" onBlur={async (e) => { await acao(() => api(`/provedores-ia/${p.id}`, { metodo: "PATCH", corpo: { limite_mensal: e.target.value ? Number(e.target.value) : null } })); recarregar(); }} />
                <span className="mini">Gasto no mês: US$ {Number(p.gasto_mes).toFixed(2)} · aviso em 80%</span></label>
            </div>
            <div className="linha entre">
              <div className="linha mini">Usar para: {["conversa", "transcricao", "imagem"].map((t) => <label key={t} className="linha" style={{ gap: 4 }}><input type="checkbox" style={{ width: "auto" }} checked={p.tarefas.includes(t)} onChange={async (e) => { const tarefas = e.target.checked ? [...p.tarefas, t] : p.tarefas.filter((x: string) => x !== t); await acao(() => api(`/provedores-ia/${p.id}`, { metodo: "PATCH", corpo: { tarefas } })); recarregar(); }} />{({ conversa: "Conversa", transcricao: "Transcrição de áudio", imagem: "Leitura de imagem" } as any)[t]}</label>)}</div>
              <div className="linha">
                {testes[p.id] && <span className={`selo ${testes[p.id].ok ? "verde" : "urgente"}`}>{testes[p.id].ok ? `OK · ${testes[p.id].ms} ms` : testes[p.id].erro}</span>}
                <button className="btn pequeno" onClick={async () => { const r = await acao(() => api(`/provedores-ia/${p.id}/testar`, { corpo: {} })); if (r) setTestes({ ...testes, [p.id]: r }); recarregar(); }}>Testar conexão</button>
                <button className="btn pequeno perigo" onClick={async () => { if (confirm("Remover este provedor?")) { await acao(() => api(`/provedores-ia/${p.id}`, { metodo: "DELETE" })); recarregar(); } }}>Remover</button>
              </div>
            </div>
          </div>))}
        <button className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setNovo({ provedor: "anthropic", modelo: "claude-opus-5-5", chave: "", endereco_api: "" })}>+ Adicionar provedor</button>
      </div>
      {novo && <Modal titulo="Adicionar provedor de IA" fechar={() => setNovo(null)}>
        <form className="pilha" onSubmit={async (e) => { e.preventDefault(); const r = await acao(() => api("/provedores-ia", { corpo: { ...novo, endereco_api: novo.endereco_api || null, chave: novo.chave || undefined } }), "Provedor adicionado"); if (r) { setNovo(null); recarregar(); } }}>
          <label className="campo">Provedor<select value={novo.provedor} onChange={(e) => setNovo({ ...novo, provedor: e.target.value, modelo: PROVEDORES[e.target.value].modelos[0] ?? "" })}>{Object.entries(PROVEDORES).map(([k, v]) => <option key={k} value={k}>{v.nome}</option>)}</select></label>
          <label className="campo">Modelo<input list="modelos-novo" value={novo.modelo} onChange={(e) => setNovo({ ...novo, modelo: e.target.value })} required placeholder="nome do modelo no provedor" /><datalist id="modelos-novo">{PROVEDORES[novo.provedor].modelos.map((m) => <option key={m} value={m} />)}</datalist></label>
          {novo.provedor === "compativel" && <label className="campo">Endereço da API<input value={novo.endereco_api} onChange={(e) => setNovo({ ...novo, endereco_api: e.target.value })} placeholder="https://openrouter.ai/api/v1" required /></label>}
          {novo.provedor !== "simulado" && <label className="campo">Chave de API<input type="password" value={novo.chave} onChange={(e) => setNovo({ ...novo, chave: e.target.value })} required /></label>}
          <div className="linha fim"><button type="button" className="btn" onClick={() => setNovo(null)}>Cancelar</button><button className="btn primario">Adicionar</button></div>
        </form></Modal>}
    </div>
  );
}

function Materiais() {
  const acao = useAcao();
  const { dados: lista, recarregar } = useDados<any[]>(() => api("/materiais"));
  const [aberto, setAberto] = useState(false);
  return (
    <div className="cartao" style={{ marginBottom: 14 }}>
      <div className="linha entre"><h2>3. Materiais que a IA pode enviar</h2><button className="btn" onClick={() => setAberto(true)}>+ Adicionar material</button></div>
      <p className="sub">Apresentações, catálogos e tabelas em PDF ou imagem. A IA envia na conversa quando o momento combinar com "quando enviar" — por exemplo, a apresentação para os contatos de franquia — e não repete o mesmo arquivo para o mesmo cliente.</p>
      {!lista ? <Carregando /> : lista.length === 0 ? <div className="vazio">Nenhum material ainda.</div> : (
        <table className="tab"><thead><tr><th>Material</th><th>Quando enviar</th><th>Interesses</th><th className="num">Envios</th><th>Ativo</th><th /></tr></thead>
          <tbody>{lista.map((m) => <tr key={m.id}>
            <td><a href={m.link} target="_blank" rel="noreferrer"><b>📄 {m.titulo}</b></a><div className="mini">{m.nome_arquivo}</div></td>
            <td style={{ maxWidth: 340 }}>{m.quando_enviar}</td><td>{m.interesses.join(", ") || "todos"}</td><td className="num">{m.envios}</td>
            <td><Chave marcado={m.ativo} onChange={async (v) => { await acao(() => api(`/materiais/${m.id}`, { metodo: "PATCH", corpo: { ativo: v } })); recarregar(); }} /></td>
            <td><button className="btn pequeno perigo" onClick={async () => { if (confirm("Remover este material?")) { await acao(() => api(`/materiais/${m.id}`, { metodo: "DELETE" })); recarregar(); } }}>Remover</button></td>
          </tr>)}</tbody></table>)}
      {aberto && <Modal titulo="Adicionar material" fechar={() => setAberto(false)}>
        <form className="pilha" onSubmit={async (e) => { e.preventDefault(); const r = await acao(() => api("/materiais", { form: new FormData(e.currentTarget) }), "Material adicionado"); if (r) { setAberto(false); recarregar(); } }}>
          <label className="campo">Título<input name="titulo" required placeholder="Apresentação da Franquia" /></label>
          <label className="campo">Quando a IA deve enviar<textarea name="quando_enviar" required placeholder="Quando o contato demonstrar interesse em franquia ou pedir mais informações/apresentação." /></label>
          <label className="campo">Interesses (separados por vírgula, vazio = todos)<input name="interesses" placeholder="franquia" /></label>
          <label className="campo">Legenda no WhatsApp (opcional)<input name="legenda" /></label>
          <label className="campo">Arquivo (PDF ou imagem, até 20 MB)<input name="arquivo" type="file" accept="application/pdf,image/*" required /></label>
          <div className="linha fim"><button type="button" className="btn" onClick={() => setAberto(false)}>Cancelar</button><button className="btn primario">Salvar</button></div>
        </form></Modal>}
    </div>
  );
}

function Base() {
  const acao = useAcao();
  const { dados: lista, recarregar } = useDados<any[]>(() => api("/base-conhecimento"));
  const [modo, setModo] = useState<"" | "texto" | "site" | "arquivo">("");
  return (
    <div className="cartao" style={{ marginBottom: 14 }}>
      <div className="linha entre"><h2>4. Base de conhecimento</h2><div className="linha"><button className="btn" onClick={() => setModo("arquivo")}>+ Arquivo</button><button className="btn" onClick={() => setModo("site")}>+ Site</button><button className="btn" onClick={() => setModo("texto")}>+ Informação rápida</button></div></div>
      <p className="sub">A IA responde apenas com base neste conteúdo: tabela de serviços e preços, perguntas frequentes, horários, endereços e formas de pagamento.</p>
      {!lista ? <Carregando /> : <div className="lista">{lista.map((d) => <div key={d.id} className="item linha entre" style={{ flexWrap: "nowrap" }}>
        <div style={{ minWidth: 0 }}><h3>{({ arquivo: "📄", site: "🌐", texto: "📝" } as any)[d.tipo]} {d.titulo}</h3><div className="mini" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 800 }}>{d.previa}</div></div>
        <button className="btn pequeno perigo" onClick={async () => { if (confirm("Remover?")) { await acao(() => api(`/base-conhecimento/${d.id}`, { metodo: "DELETE" })); recarregar(); } }}>Remover</button></div>)}</div>}
      {modo && <Modal titulo={modo === "arquivo" ? "Adicionar arquivo" : modo === "site" ? "Adicionar site" : "Informação rápida"} fechar={() => setModo("")}>
        <form className="pilha" onSubmit={async (e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget);
          const r = await acao(() => (modo === "arquivo" ? api("/base-conhecimento", { form: f }) : api("/base-conhecimento", { corpo: { tipo: modo, titulo: f.get("titulo"), conteudo: f.get("conteudo") ?? undefined, url: f.get("url") ?? undefined } })), "Adicionado à base");
          if (r) { setModo(""); recarregar(); }
        }}>
          {modo === "arquivo" ? <><label className="campo">Título (opcional)<input name="titulo" /></label><label className="campo">Arquivo (PDF, Word .docx, CSV ou texto)<input type="file" name="arquivo" required accept=".pdf,.docx,.csv,.txt,.md" /></label></>
            : <><label className="campo">Título<input name="titulo" required /></label>
              {modo === "site" ? <label className="campo">Endereço do site<input name="url" type="url" required placeholder="https://" /></label> : <label className="campo">Conteúdo<textarea name="conteudo" rows={6} required placeholder="Horário: segunda a sexta, 8h às 18h…" /></label>}</>}
          <div className="linha fim"><button type="button" className="btn" onClick={() => setModo("")}>Cancelar</button><button className="btn primario">Adicionar</button></div>
        </form></Modal>}
    </div>
  );
}
