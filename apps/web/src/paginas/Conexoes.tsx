import { useEffect, useState } from "react";
import { api, tempoReal } from "../api.ts";
import { Carregando, Modal, useDados } from "../componentes.tsx";
import { useAcao, useApp } from "../contexto.tsx";

const STATUS: Record<string, [string, string]> = { conectada: ["Conectado", "verde"], caiu: ["Caiu", "urgente"], reconectando: ["Reconectando", "atencao"], precisa_atencao: ["Precisa de atenção", "urgente"], aguardando_qr: ["Aguardando QR", "atencao"], desconectada: ["Desconectado", "cinza"] };

export function Conexoes() {
  const acao = useAcao();
  const { eu } = useApp();
  const { dados: cx, recarregar } = useDados<any[]>(() => api("/conexoes"));
  const { dados: conta, recarregar: recConta } = useDados<any>(() => api("/conta"));
  const [nova, setNova] = useState<"" | "oficial" | "qr" | "simulador">("");
  const [qr, setQr] = useState<Record<string, string>>({});
  const [cfg, setCfg] = useState<any>(null);
  useEffect(() => { if (conta) setCfg(conta.config); }, [conta]);
  useEffect(() => {
    const s = tempoReal();
    const q = (e: any) => setQr((x) => ({ ...x, [e.id]: e.qrcode }));
    const st = () => recarregar();
    s.on("qrcode.atualizado", q); s.on("conexao.estado", st);
    return () => { s.off("qrcode.atualizado", q); s.off("conexao.estado", st); };
  }, []);
  if (!cx || !conta || !cfg) return <div className="pagina"><Carregando /></div>;
  const admin = eu?.perfil === "admin";
  const salvarCfg = (c: any) => { setCfg(c); return acao(() => api("/conta", { metodo: "PATCH", corpo: { config: c } }), "Regras salvas"); };

  const card = (tipo: string) => cx.filter((c) => c.tipo === tipo).map((c) => (
    <div key={c.id} className="bloco" style={{ marginTop: 10 }}>
      <div className="linha entre"><div><h3>{c.numero ? `${c.numero} · ` : ""}{c.nome}</h3><div className="mini">Modo padrão: {({ ia: "IA", aprova: "IA sugere", humano: "Humano" } as any)[c.modo_padrao]}</div></div><span className={`selo ${STATUS[c.status]?.[1]}`}>● {STATUS[c.status]?.[0]}</span></div>
      {c.tipo === "qr" && (qr[c.id] || c.qrcode) && c.status !== "conectada" && <div style={{ textAlign: "center", marginTop: 10 }}><img src={qr[c.id] || c.qrcode} alt="QR Code para conectar o WhatsApp" style={{ width: 220 }} /><div className="mini">WhatsApp no celular → Aparelhos conectados → Conectar aparelho</div></div>}
      {c.webhook && admin && <div className="mini" style={{ marginTop: 8 }}>Webhook: <code>{c.webhook}</code></div>}
      {admin && <div className="linha" style={{ marginTop: 8 }}>
        {c.tipo === "qr" && <button className="btn pequeno escuro" onClick={() => acao(() => api(`/conexoes/${c.id}/qrcode`, { corpo: {} })).then((r: any) => r?.qrcode && setQr({ ...qr, [c.id]: r.qrcode }))}>Gerar QR Code</button>}
        <select style={{ width: "auto" }} value={c.modo_padrao} onChange={async (e) => { await acao(() => api(`/conexoes/${c.id}`, { metodo: "PATCH", corpo: { modo_padrao: e.target.value } })); recarregar(); }}><option value="ia">Novas: IA</option><option value="aprova">Novas: IA sugere</option><option value="humano">Novas: Humano</option></select>
        {c.tipo !== "simulador" && <button className="btn pequeno" onClick={async () => { await acao(() => api(`/conexoes/${c.id}/desconectar`, { corpo: {} })); recarregar(); }}>Desconectar</button>}
        <button className="btn pequeno perigo" onClick={async () => { if (confirm("Remover esta conexão e as conversas dela?")) { await acao(() => api(`/conexoes/${c.id}`, { metodo: "DELETE" })); recarregar(); } }}>Remover</button>
      </div>}
    </div>));

  return (
    <div className="pagina">
      <div className="cab"><div><h1>Conexões do WhatsApp</h1><p className="sub" style={{ margin: 0 }}>Conecte quantos números quiser, pela API Oficial ou QR Code. Todas as conversas caem na mesma caixa de atendimento, e cada uma pode ser IA ou Humano.</p></div></div>
      <div className="grade g2" style={{ marginBottom: 14 }}>
        <div className="cartao"><span className="selo verde">Recomendado</span><h2 style={{ marginTop: 6 }}>API Oficial do WhatsApp</h2>
          <p className="sub">Conexão direta com a Meta (WhatsApp Cloud API). Estável, sem risco de bloqueio por uso não oficial, com disparo de campanhas por modelos aprovados.</p>
          {card("oficial")}
          <ul className="mini" style={{ paddingLeft: 18 }}><li>Responde grátis dentro da janela de 24h após o cliente escrever</li><li>Para iniciar contato, usa modelos aprovados pela Meta (cobrança por mensagem)</li><li>Ideal para volume alto e campanhas</li></ul>
          {admin && <button className="btn primario" onClick={() => setNova("oficial")}>+ Conectar número pela API Oficial</button>}</div>
        <div className="cartao"><span className="selo atencao">Conexão rápida</span><h2 style={{ marginTop: 6 }}>QR Code (WhatsApp Web)</h2>
          <p className="sub">Use o número que você já tem no celular. Rápido para começar, mas não é oficial: uso intenso ou disparos em massa podem bloquear o número.</p>
          {card("qr")}
          {admin && <button className="btn escuro" style={{ marginTop: 10 }} onClick={() => setNova("qr")}>+ Conectar por QR Code</button>}
          <h3 style={{ marginTop: 18 }}>Simulador (testes)</h3>{card("simulador")}
          {admin && <button className="btn" style={{ marginTop: 10 }} onClick={() => setNova("simulador")}>+ Simulador</button>}</div>
      </div>

      <div className="cartao" style={{ marginBottom: 14 }}>
        <div className="linha entre"><div><span className="selo">Entrada de leads</span><h2 style={{ marginTop: 6 }}>CRM: Goalfy</h2></div><span className="selo verde">● Recebendo · {conta.leads_hoje} leads hoje</span></div>
        <p className="sub">Cada lead novo no Goalfy chega aqui com a fonte (Google Ads, Meta Ads…), a campanha e as UTMs. A IA chama o cliente no WhatsApp em poucos minutos, enquanto o interesse está quente.</p>
        <div className="grade g2">
          <div className="pilha">
            <label className="campo">Endereço para o Goalfy enviar os leads (webhook)<div className="linha" style={{ flexWrap: "nowrap" }}><code style={{ flex: 1 }}>{conta.url_leads}</code><button className="btn pequeno" onClick={() => navigator.clipboard.writeText(conta.url_leads)}>Copiar</button></div></label>
            <label className="campo">Token de segurança<div className="linha" style={{ flexWrap: "nowrap" }}><code style={{ flex: 1 }}>{conta.token_leads}</code>{admin && <button className="btn pequeno" onClick={async () => { if (confirm("Gerar novo token? O antigo para de funcionar.")) { await acao(() => api("/conta/token-leads", { corpo: {} }), "Novo token gerado"); recConta(); } }}>Gerar novo</button>}</div></label>
            <div className="mini">Sem webhook no Goalfy? Conecte pelo Zapier, Make ou n8n usando o mesmo endereço, com o cabeçalho <code>Authorization: Bearer {"<token>"}</code>.</div>
          </div>
          <div className="bloco"><h3>Campos recebidos</h3><dl className="kv" style={{ marginTop: 6 }}><dt>nome → nome</dt><dd>telefone → WhatsApp</dd><dt>fonte → selo da fonte</dt><dd>campanha → campanha</dd><dt>utm → origem detalhada</dt><dd>interesse → interesse do lead</dd></dl>
            <label className="linha" style={{ marginTop: 10, gap: 8 }}><input type="checkbox" checked readOnly style={{ width: "auto" }} /> A IA chama o lead novo em até <input type="number" style={{ width: 60 }} value={cfg.contatoLeadMin} onChange={(e) => salvarCfg({ ...cfg, contatoLeadMin: Number(e.target.value) })} /> minutos</label>
            <label className="linha" style={{ gap: 8 }}><input type="checkbox" checked={cfg.devolverCrm} onChange={(e) => salvarCfg({ ...cfg, devolverCrm: e.target.checked })} style={{ width: "auto" }} /> Devolver ao Goalfy a temperatura e o status do lead</label></div>
        </div>
        <div className="aviso" style={{ marginTop: 12 }}>Preparado para o futuro CRM próprio da Domma: contatos, fontes e etapas já ficam guardados no Domma Chat. Quando o CRM próprio existir, ele usa os mesmos dados, sem migração.</div>
      </div>

      <div className="cartao">
        <h2>Como a IA entra e sai das conversas</h2><p className="sub">Vale para todos os números. Em cada conversa você ainda troca na hora pelo botão IA ⇄ Humano.</p>
        <div className="grade" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div className="bloco"><h3>Novas conversas começam com</h3><div className="seg" style={{ marginTop: 10 }}><button className={cfg.novasConversas !== "humano" ? "ativo" : ""} onClick={() => salvarCfg({ ...cfg, novasConversas: "ia" })}>IA</button><button className={cfg.novasConversas === "humano" ? "ativo hum" : ""} onClick={() => salvarCfg({ ...cfg, novasConversas: "humano" })}>Humano</button></div></div>
          <div className="bloco"><h3>IA passa para humano quando</h3><ul className="mini" style={{ paddingLeft: 16 }}><li>o cliente pede "atendente" ou "pessoa"</li><li>não resolve em 2 tentativas</li><li>o assunto é negociação de preço</li></ul><div className="mini">Ajuste em Agente de IA → Regras.</div></div>
          <div className="bloco"><h3>Humano sem responder</h3><label className="mini">Se ninguém responder em <input type="number" style={{ width: 56 }} value={cfg.alertas.atendenteSemResponderMin} onChange={(e) => salvarCfg({ ...cfg, alertas: { ...cfg.alertas, atendenteSemResponderMin: Number(e.target.value) } })} /> minutos, a IA avisa o cliente que já vai ser atendido.</label>
            <label className="mini" style={{ display: "block", marginTop: 6 }}>Alerta de espera após <input type="number" style={{ width: 56 }} value={cfg.alertas.esperaHumanoMin} onChange={(e) => salvarCfg({ ...cfg, alertas: { ...cfg.alertas, esperaHumanoMin: Number(e.target.value) } })} /> min</label></div>
          <div className="bloco"><h3>Horário comercial</h3><div className="linha" style={{ marginTop: 8 }}><input type="time" style={{ width: 110 }} value={cfg.horario.inicio} onChange={(e) => salvarCfg({ ...cfg, horario: { ...cfg.horario, inicio: e.target.value } })} /> às <input type="time" style={{ width: 110 }} value={cfg.horario.fim} onChange={(e) => salvarCfg({ ...cfg, horario: { ...cfg.horario, fim: e.target.value } })} /></div>
            <div className="linha" style={{ gap: 4, marginTop: 8 }}>{["D", "S", "T", "Q", "Q", "S", "S"].map((d, k) => <button key={k} className={"chip" + (cfg.horario.dias.includes(k) ? " ativo" : "")} onClick={() => salvarCfg({ ...cfg, horario: { ...cfg.horario, dias: cfg.horario.dias.includes(k) ? cfg.horario.dias.filter((x: number) => x !== k) : [...cfg.horario.dias, k].sort() } })}>{d}</button>)}</div></div>
        </div>
      </div>
      <div className="aviso" style={{ marginTop: 14 }}><b>Política da Meta para IA (em vigor desde 15/01/2026):</b> a Meta proíbe na API do WhatsApp assistentes de IA de uso geral. Continuam permitidas IAs voltadas ao negócio — por isso o Agente do Domma Chat responde só com a base de conhecimento e o escopo da empresa.</div>
      {nova && <NovaConexao tipo={nova} fechar={() => setNova("")} criada={(c: any) => { setNova(""); if (c?.qrcode) setQr({ ...qr, [c.id]: c.qrcode }); recarregar(); }} />}
    </div>
  );
}

function NovaConexao({ tipo, fechar, criada }: { tipo: string; fechar: () => void; criada: (c: any) => void }) {
  const acao = useAcao();
  return <Modal titulo={tipo === "oficial" ? "Conectar pela API Oficial" : tipo === "qr" ? "Conectar por QR Code" : "Nova conexão simulador"} fechar={fechar}>
    <form className="pilha" onSubmit={async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); const r = await acao(() => api("/conexoes", { corpo: { tipo, ...f } }), "Conexão criada"); if (r) criada(r); }}>
      <label className="campo">Nome<input name="nome" required placeholder={tipo === "qr" ? "Atendimento loja" : "Master Laudo"} /></label>
      <label className="campo">Número (exibição)<input name="numero" placeholder="(31) 3xxx-0000" /></label>
      {tipo === "oficial" && <>
        <label className="campo">Token de sistema (System User, permanente)<input name="token" type="password" required /></label>
        <div className="grade g2"><label className="campo">phone_number_id<input name="phone_number_id" required /></label><label className="campo">waba_id<input name="waba_id" /></label></div>
        <label className="campo">App secret (valida a assinatura do webhook)<input name="app_secret" type="password" required /></label>
        <div className="mini">Na Meta for Developers, assine o campo "messages" no webhook <code>/webhooks/meta</code> com o verify token configurado no servidor.</div></>}
      {tipo === "qr" && <div className="aviso amarelo">Precisa da Evolution API configurada no servidor. Use ritmo baixo e evite disparos em massa por QR Code.</div>}
      <div className="linha fim"><button type="button" className="btn" onClick={fechar}>Cancelar</button><button className="btn primario">Conectar</button></div>
    </form></Modal>;
}
