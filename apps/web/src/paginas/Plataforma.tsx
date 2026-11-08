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

function Clientes() {
  const acao = useAcao();
  const { dados: contas, recarregar } = useDados<any[]>(() => api("/plataforma/contas"));
  const [nova, setNova] = useState(false);
  if (!contas) return <Carregando />;
  return (
    <div className="cartao">
      <div className="cartao-cab"><h2>Clientes ({contas.length})</h2><button className="btn primario" onClick={() => setNova(true)}>+ Novo cliente</button></div>
      <table className="tab"><thead><tr><th>Cliente</th><th>Plano</th><th className="num">Usuários</th><th className="num">Números</th><th className="num">Conversas 30d</th><th className="num">IA no mês</th><th>Última atividade</th><th>Situação</th><th /></tr></thead>
        <tbody>{contas.map((c) => <tr key={c.id}>
          <td><b>{c.nome}</b>{c.plano === "plataforma" && <span className="selo" style={{ marginLeft: 6 }}>◆ conta da plataforma</span>}<div className="mini">desde {new Date(c.criado_em).toLocaleDateString("pt-BR")}{c.usuarios === 0 && c.plano !== "plataforma" ? " · sem usuários: use Entrar como para cadastrar a equipe" : ""}</div></td>
          <td>{c.plano}</td><td className="num">{c.usuarios}</td>
          <td className="num">{c.numeros ? <span className={c.numeros_ok < c.numeros ? "temp-morno" : ""}>{c.numeros_ok}/{c.numeros}</span> : "–"}</td>
          <td className="num">{c.conversas_30d}</td><td className="num">US$ {Number(c.custo_ia_mes).toFixed(2)}</td><td>{c.ultima_atividade ? dataHora(c.ultima_atividade) : "–"}</td>
          <td>{c.plano === "plataforma" ? <span className="mini">—</span> : <button className={`btn pequeno ${c.ativa ? "" : "perigo"}`} title={c.ativa ? "Clique para suspender" : "Clique para reativar"} onClick={async () => { if (confirm(c.ativa ? `Suspender ${c.nome}? A equipe dele não consegue mais entrar.` : `Reativar ${c.nome}?`)) { await acao(() => api(`/plataforma/contas/${c.id}`, { metodo: "PATCH", corpo: { ativa: !c.ativa } })); recarregar(); } }}>{c.ativa ? "● Ativa" : "Suspensa"}</button>}</td>
          <td>{c.plano !== "plataforma" && <button className="btn pequeno" onClick={async () => { const r: any = await acao(() => api(`/plataforma/contas/${c.id}/entrar`, { corpo: {} })); if (r) { try { sessionStorage.setItem("domma.token.plataforma", sessao.token); } catch { /* ok */ } sessao.token = r.token; location.href = "/"; } }}>Entrar como</button>}</td>
        </tr>)}</tbody></table>
      {nova && <Modal titulo="Novo cliente" fechar={() => setNova(false)}>
        <form className="pilha" onSubmit={async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); const r = await acao(() => api("/plataforma/contas", { corpo: f }), "Cliente criado"); if (r) { setNova(false); recarregar(); } }}>
          <label className="campo">Nome da empresa<input name="nome" required placeholder="RedBox" /></label>
          <label className="campo">Plano<input name="plano" defaultValue="padrao" /></label>
          <h3 style={{ marginTop: 6 }}>Primeiro administrador do cliente</h3>
          <label className="campo">Nome<input name="admin_nome" required /></label>
          <label className="campo">E-mail<input name="admin_email" type="email" required /></label>
          <label className="campo">Senha inicial (mín. 8)<input name="admin_senha" type="password" minLength={8} required /></label>
          <div className="mini">A conta nasce com filas padrão, o agente no modo "IA sugere" e o simulador para testes. O cliente configura números, IA e pagamentos no próprio painel.</div>
          <div className="linha fim"><button type="button" className="btn" onClick={() => setNova(false)}>Cancelar</button><button className="btn primario">Criar cliente</button></div>
        </form></Modal>}
    </div>
  );
}
