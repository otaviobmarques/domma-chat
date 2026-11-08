import { useState } from "react";
import { api, sessao } from "../api.ts";
import { Carregando, Modal, useDados } from "../componentes.tsx";
import { useAcao } from "../contexto.tsx";
import { dataHora } from "../util.ts";
import { PainelSaude } from "./Saude.tsx";

/** Área do administrador da plataforma Domma (SaaS): infraestrutura comum e clientes. */
export function Plataforma() {
  const [aba, setAba] = useState<"saude" | "clientes">("saude");
  return (
    <div className="pagina">
      <div className="cab"><div><span className="rotulo">Administrador da plataforma</span><h1>Plataforma Domma</h1><p className="sub" style={{ margin: 0 }}>Infraestrutura que atende todos os clientes, e as contas do SaaS.</p></div>
        <div className="seg"><button className={aba === "saude" ? "ativo" : ""} onClick={() => setAba("saude")}>Saúde da plataforma</button><button className={aba === "clientes" ? "ativo" : ""} onClick={() => setAba("clientes")}>Clientes</button></div></div>
      {aba === "saude" ? <PainelSaude rota="/plataforma/saude" titulo="Plataforma" descricao="Railway, Supabase, Redis, filas, domínios, DNS, SSL, Evolution API e fornecedores." /> : <Clientes />}
    </div>
  );
}

const fmtData = (d?: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "–");
const vencido = (d?: string | null) => !!d && new Date(d.slice(0, 10) + "T23:59:59") < new Date();
const venceEm = (d?: string | null) => (d ? Math.ceil((new Date(d.slice(0, 10) + "T23:59:59").getTime() - Date.now()) / 86400000) : null);

function entrarComo(acao: ReturnType<typeof useAcao>, id: string) {
  return acao(() => api<any>(`/plataforma/contas/${id}/entrar`, { corpo: {} })).then((r) => {
    if (!r) return;
    try { sessionStorage.setItem("domma.token.plataforma", sessao.token); } catch { /* ok */ }
    sessao.token = r.token; location.href = "/";
  });
}

function Clientes() {
  const acao = useAcao();
  const { dados: contas, recarregar } = useDados<any[]>(() => api("/plataforma/contas"));
  const [nova, setNova] = useState(false);
  const [ficha, setFicha] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  if (!contas) return <Carregando />;
  const lista = contas.filter((c) => !busca || [c.nome, c.razao_social, c.cnpj, c.responsavel_nome, c.cidade].some((v) => v && String(v).toLowerCase().includes(busca.toLowerCase())));
  return (
    <div className="cartao">
      <div className="cartao-cab"><h2>Clientes ({contas.filter((c) => c.plano !== "plataforma").length})</h2>
        <div className="linha"><input placeholder="Buscar por nome, CNPJ, responsável ou cidade" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ width: 300 }} /><button className="btn primario" onClick={() => setNova(true)}>+ Novo cliente</button></div></div>
      <div style={{ overflowX: "auto" }}>
      <table className="tab"><thead><tr><th>Cliente</th><th>Plano</th><th className="num">Usuários</th><th className="num">Números</th><th className="num">Conversas 30d</th><th className="num">IA no mês</th><th>Vencimento</th><th>Situação</th><th /></tr></thead>
        <tbody>{lista.map((c) => { const dias = venceEm(c.vencimento); return <tr key={c.id}>
          <td><b>{c.nome}</b>{c.plano === "plataforma" && <span className="selo" style={{ marginLeft: 6 }}>◆ conta da plataforma</span>}
            <div className="mini">{[c.razao_social, c.cnpj, c.cidade && `${c.cidade}${c.uf ? "/" + c.uf : ""}`].filter(Boolean).join(" · ") || `desde ${new Date(c.criado_em).toLocaleDateString("pt-BR")}`}{c.usuarios === 0 && c.plano !== "plataforma" ? " · sem usuários" : ""}</div></td>
          <td>{c.plano}</td>
          <td className="num">{c.usuarios}{c.limite_usuarios ? <span className="mini">/{c.limite_usuarios}</span> : ""}</td>
          <td className="num">{c.numeros ? <span className={c.numeros_ok < c.numeros ? "temp-morno" : ""}>{c.numeros_ok}/{c.numeros}</span> : "–"}{c.limite_numeros != null ? <span className="mini"> (máx. {c.limite_numeros})</span> : ""}</td>
          <td className="num">{c.conversas_30d}</td>
          <td className="num">US$ {Number(c.custo_ia_mes).toFixed(2)}{c.limite_ia_mensal ? <div className="mini">de {Number(c.limite_ia_mensal).toFixed(0)}</div> : ""}</td>
          <td>{c.vencimento ? <span className={vencido(c.vencimento) ? "temp-quente" : dias !== null && dias <= 7 ? "temp-morno" : ""} style={{ fontWeight: 600 }}>{fmtData(c.vencimento)}</span> : "–"}</td>
          <td>{c.plano === "plataforma" ? <span className="mini">—</span> : c.ativa ? <span className="selo verde">● Ativa</span> : <span className="selo urgente" title={c.bloqueio_motivo ?? ""}>● Bloqueada</span>}</td>
          <td><div className="linha" style={{ flexWrap: "nowrap" }}>{c.plano !== "plataforma" && <><button className="btn pequeno" onClick={() => setFicha(c.id)}>Abrir ficha</button><button className="btn pequeno fantasma" onClick={() => entrarComo(acao, c.id)}>Entrar como</button></>}</div></td>
        </tr>; })}</tbody></table>
      </div>
      {nova && <NovoCliente fechar={() => setNova(false)} criado={() => { setNova(false); recarregar(); }} />}
      {ficha && <FichaCliente id={ficha} fechar={() => setFicha(null)} mudou={recarregar} />}
    </div>
  );
}

function CamposFicha({ c }: { c?: any }) {
  return <>
    <div className="grade g2">
      <label className="campo">Nome fantasia<input name="nome" defaultValue={c?.nome} required /></label>
      <label className="campo">Razão social<input name="razao_social" defaultValue={c?.razao_social ?? ""} /></label>
      <label className="campo">CNPJ<input name="cnpj" defaultValue={c?.cnpj ?? ""} placeholder="00.000.000/0000-00" /></label>
      <div className="grade" style={{ gridTemplateColumns: "1fr 80px" }}><label className="campo">Cidade<input name="cidade" defaultValue={c?.cidade ?? ""} /></label><label className="campo">UF<input name="uf" maxLength={2} defaultValue={c?.uf ?? ""} style={{ textTransform: "uppercase" }} /></label></div>
    </div>
    <h3 style={{ marginTop: 8 }}>Responsável no cliente</h3>
    <div className="grade g3">
      <label className="campo">Nome<input name="responsavel_nome" defaultValue={c?.responsavel_nome ?? ""} /></label>
      <label className="campo">E-mail<input name="responsavel_email" type="email" defaultValue={c?.responsavel_email ?? ""} /></label>
      <label className="campo">Telefone / WhatsApp<input name="responsavel_telefone" defaultValue={c?.responsavel_telefone ?? ""} /></label>
    </div>
    <h3 style={{ marginTop: 8 }}>Plano e limites</h3>
    <div className="grade g3">
      <label className="campo">Plano<input name="plano" defaultValue={c?.plano ?? "padrao"} required /></label>
      <label className="campo">Início do contrato<input name="inicio_contrato" type="date" defaultValue={c?.inicio_contrato?.slice(0, 10) ?? ""} /></label>
      <label className="campo">Vencimento<input name="vencimento" type="date" defaultValue={c?.vencimento?.slice(0, 10) ?? ""} /></label>
      <label className="campo">Máx. de usuários<input name="limite_usuarios" type="number" min={1} defaultValue={c?.limite_usuarios ?? ""} placeholder="sem limite" /></label>
      <label className="campo">Máx. de números de WhatsApp<input name="limite_numeros" type="number" min={0} defaultValue={c?.limite_numeros ?? ""} placeholder="sem limite" /></label>
      <label className="campo">Limite de IA por mês (US$)<input name="limite_ia_mensal" type="number" min={0} step="0.01" defaultValue={c?.limite_ia_mensal ?? ""} placeholder="sem limite" /></label>
    </div>
    <label className="campo">Observações internas (só a Domma vê)<textarea name="observacoes" defaultValue={c?.observacoes ?? ""} /></label>
  </>;
}

const formParaObjeto = (f: HTMLFormElement) => Object.fromEntries([...new FormData(f).entries()].map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));

function NovoCliente({ fechar, criado }: { fechar: () => void; criado: () => void }) {
  const acao = useAcao();
  return <Modal titulo="Novo cliente" fechar={fechar} largura={760}>
    <form className="pilha" onSubmit={async (e) => { e.preventDefault(); const r = await acao(() => api("/plataforma/contas", { corpo: formParaObjeto(e.currentTarget) }), "Cliente criado"); if (r) criado(); }}>
      <CamposFicha />
      <h3 style={{ marginTop: 8 }}>Primeiro administrador do cliente</h3>
      <div className="grade g3">
        <label className="campo">Nome<input name="admin_nome" required /></label>
        <label className="campo">E-mail (login)<input name="admin_email" type="email" required /></label>
        <label className="campo">Senha inicial (mín. 8)<input name="admin_senha" type="password" minLength={8} required /></label>
      </div>
      <div className="mini">A conta nasce com filas padrão, o agente no modo "IA sugere" e o simulador para testes. O cliente configura números, IA e pagamentos no próprio painel.</div>
      <div className="linha fim"><button type="button" className="btn" onClick={fechar}>Cancelar</button><button className="btn primario">Criar cliente</button></div>
    </form></Modal>;
}

const ACAO_HIST: Record<string, string> = { "plataforma:criar_conta": "Cliente criado", "plataforma:editar_conta": "Dados editados", "plataforma:bloquear": "Bloqueado", "plataforma:reativar": "Reativado", "plataforma:entrar_como": "Acesso de suporte", "plataforma:redefinir_senha": "Senha redefinida" };

function FichaCliente({ id, fechar, mudou }: { id: string; fechar: () => void; mudou: () => void }) {
  const acao = useAcao();
  const { dados: c, recarregar } = useDados<any>(() => api(`/plataforma/contas/${id}`), [id]);
  const [aba, setAba] = useState<"dados" | "usuarios" | "acoes">("dados");
  const [motivo, setMotivo] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const atualizar = () => { recarregar(); mudou(); };
  return <Modal titulo={c ? `Ficha · ${c.nome}` : "Ficha do cliente"} fechar={fechar} largura={820}>
    {!c ? <Carregando /> : <div className="pilha">
      <div className="linha entre">
        <div className="seg"><button className={aba === "dados" ? "ativo" : ""} onClick={() => setAba("dados")}>Dados e plano</button><button className={aba === "usuarios" ? "ativo" : ""} onClick={() => setAba("usuarios")}>Usuários ({c.usuarios.length})</button><button className={aba === "acoes" ? "ativo" : ""} onClick={() => setAba("acoes")}>Bloquear / excluir</button></div>
        <div className="linha">{c.ativa ? <span className="selo verde">● Ativa</span> : <span className="selo urgente">● Bloqueada</span>}<button className="btn pequeno" onClick={() => entrarComo(acao, c.id)}>Entrar como</button></div>
      </div>

      {aba === "dados" && <form className="pilha" onSubmit={async (e) => { e.preventDefault(); const r = await acao(() => api(`/plataforma/contas/${c.id}`, { metodo: "PATCH", corpo: formParaObjeto(e.currentTarget) }), "Ficha salva"); if (r) atualizar(); }}>
        <CamposFicha c={c} />
        <div className="linha entre"><span className="mini">Cliente desde {new Date(c.criado_em).toLocaleDateString("pt-BR")}</span><button className="btn primario">Salvar</button></div>
        {c.historico?.length > 0 && <div className="bloco"><span className="rotulo">Histórico</span><div className="lista">{c.historico.map((h: any, k: number) => <div key={k} className="item mini" style={{ padding: "6px 0" }}><b style={{ color: "var(--texto)", minWidth: 130 }}>{ACAO_HIST[h.acao] ?? h.acao}</b><span>{h.dados?.motivo ?? ""}</span><span style={{ marginLeft: "auto" }}>{h.usuario} · {dataHora(h.criado_em)}</span></div>)}</div></div>}
      </form>}

      {aba === "usuarios" && <div>
        {c.usuarios.length === 0 ? <div className="vazio">Este cliente ainda não tem usuários. Use "Entrar como" e cadastre a equipe em Configurar → Equipe.</div> :
          <table className="tab"><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Status</th><th /></tr></thead>
            <tbody>{c.usuarios.map((u: any) => <tr key={u.id}><td><b>{u.nome}</b></td><td>{u.email}{u.login ? <div className="mini">usuário: {u.login}</div> : null}</td>
              <td>{({ admin: "Administrador", supervisor: "Supervisor", atendente: "Atendente" } as any)[u.perfil]}</td><td>{u.status}</td>
              <td><button className="btn pequeno" onClick={async () => { const s = prompt(`Nova senha para ${u.nome} (mín. 8 caracteres):`); if (s) await acao(() => api(`/plataforma/contas/${c.id}/usuarios/${u.id}/senha`, { corpo: { senha: s } }), "Senha redefinida. Avise o usuário."); }}>Redefinir senha</button></td></tr>)}</tbody></table>}
      </div>}

      {aba === "acoes" && <div className="pilha">
        {c.ativa ? <div className="bloco pilha"><h3>Bloquear acesso</h3>
          <div className="mini">A equipe do cliente é desconectada e não consegue entrar. O WhatsApp e a IA continuam recebendo mensagens, e os dados ficam guardados. Use para inadimplência ou suspensão temporária.</div>
          <label className="campo">Motivo (aparece para o cliente no login)<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: pagamento pendente" /></label>
          <button className="btn perigo" style={{ alignSelf: "flex-start" }} disabled={motivo.trim().length < 3} onClick={async () => { const r = await acao(() => api(`/plataforma/contas/${c.id}/bloquear`, { corpo: { motivo } }), "Cliente bloqueado"); if (r) { setMotivo(""); atualizar(); } }}>Bloquear cliente</button></div>
          : <div className="bloco pilha"><h3>Cliente bloqueado</h3><div className="mini">Motivo: {c.bloqueio_motivo ?? "–"} · desde {dataHora(c.bloqueado_em)}</div>
            <button className="btn primario" style={{ alignSelf: "flex-start" }} onClick={async () => { const r = await acao(() => api(`/plataforma/contas/${c.id}/reativar`, { corpo: {} }), "Cliente reativado"); if (r) atualizar(); }}>Reativar acesso</button></div>}
        <div className="bloco pilha" style={{ borderColor: "var(--vermelho)", background: "#FFF7F7" }}><h3 style={{ color: "var(--vermelho)" }}>Excluir cliente</h3>
          <div className="mini">Apaga <b>definitivamente</b> a conta e todos os dados: conversas, contatos, mensagens, campanhas, configurações e usuários. Não dá para desfazer. Antes, exporte o que precisar (Relatórios e exportação das conversas).</div>
          <label className="campo">Para confirmar, digite o nome do cliente: <b>{c.nome}</b><input value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} /></label>
          <button className="btn perigo" style={{ alignSelf: "flex-start", background: confirmacao.trim().toLowerCase() === c.nome.toLowerCase() ? "var(--vermelho)" : undefined, color: confirmacao.trim().toLowerCase() === c.nome.toLowerCase() ? "#fff" : undefined }}
            disabled={confirmacao.trim().toLowerCase() !== c.nome.toLowerCase()}
            onClick={async () => { const r: any = await acao(() => api(`/plataforma/contas/${c.id}`, { metodo: "DELETE", corpo: { confirmacao } })); if (r) { alert(`${r.excluido} foi excluído (${r.contatos} contatos e ${r.mensagens} mensagens apagados).`); mudou(); fechar(); } }}>Excluir definitivamente</button></div>
      </div>}
    </div>}
  </Modal>;
}
