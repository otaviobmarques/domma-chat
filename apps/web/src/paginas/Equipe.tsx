import { useState } from "react";
import { api } from "../api.ts";
import { Carregando, Modal, useDados } from "../componentes.tsx";
import { useAcao, useApp } from "../contexto.tsx";
import { iniciais } from "../util.ts";

export function Equipe() {
  const acao = useAcao(); const { eu } = useApp();
  const { dados: us, recarregar } = useDados<any[]>(() => api("/usuarios"));
  const { dados: filas, recarregar: recFilas } = useDados<any[]>(() => api("/filas"));
  const [edit, setEdit] = useState<any>(null);
  const [fila, setFila] = useState("");
  if (!us || !filas) return <div className="pagina"><Carregando /></div>;
  const admin = eu?.perfil === "admin";
  return (
    <div className="pagina">
      <div className="cab"><div><h1>Equipe e agenda dos vendedores</h1><p className="sub" style={{ margin: 0 }}>Conversas transferidas vão para quem está online, na fila certa e com menos conversas abertas.</p></div>{admin && <button className="btn primario" onClick={() => setEdit({ perfil: "atendente", filas: [], cidades: [] })}>+ Adicionar pessoa</button>}</div>
      <div className="grade g-2-1">
        <div className="cartao"><table className="tab"><thead><tr><th>Pessoa</th><th>Perfil</th><th>Filas</th><th>Status</th><th className="num">Abertas</th><th>Agenda</th><th /></tr></thead>
          <tbody>{us.map((u) => <tr key={u.id}>
            <td><div className="linha" style={{ flexWrap: "nowrap" }}><div className="avatar">{iniciais(u.nome)}</div><div><b>{u.nome}</b><div className="mini">{u.email}{u.cidades?.length ? ` · ${u.cidades.join(", ")}` : ""}</div></div></div></td>
            <td>{({ admin: "Administrador", supervisor: "Supervisor", atendente: "Atendente / Vendedor" } as any)[u.perfil]}</td>
            <td>{u.filas.join(", ") || "todas"}</td>
            <td><span className={`selo ${u.status === "online" ? "verde" : u.status === "ausente" ? "atencao" : "cinza"}`}>● {u.status}</span></td>
            <td className="num">{u.conversas_abertas}</td>
            <td>{u.google_agenda_conectada ? <span className="selo verde">Conectada</span> : <span className="selo cinza" title="A conexão com o Google Agenda entra na Fase 2">Não conectada</span>}</td>
            <td>{admin && <button className="btn pequeno" onClick={() => setEdit(u)}>Editar</button>}</td></tr>)}</tbody></table></div>
        <div className="cartao"><h2>Filas</h2><div className="lista" style={{ marginTop: 8 }}>{filas.map((f) => <div key={f.id} className="item linha entre"><span>{f.nome}</span>{admin && <button className="btn pequeno fantasma" onClick={async () => { await acao(() => api(`/filas/${f.id}`, { metodo: "DELETE" })); recFilas(); }}>✕</button>}</div>)}</div>
          {admin && <form className="linha" style={{ marginTop: 10, flexWrap: "nowrap" }} onSubmit={async (e) => { e.preventDefault(); if (!fila) return; await acao(() => api("/filas", { corpo: { nome: fila } })); setFila(""); recFilas(); }}><input value={fila} onChange={(e) => setFila(e.target.value)} placeholder="Nova fila" /><button className="btn">Adicionar</button></form>}
          <div className="aviso" style={{ marginTop: 14 }}><b>Reuniões com vendedores (Google Agenda):</b> a IA escolhe o vendedor (cidade do cliente, rodízio ou quem já atendeu), oferece horários livres e cria o evento com o resumo da conversa e os gatilhos de fechamento.</div></div>
      </div>
      {edit && <Modal titulo={edit.id ? "Editar pessoa" : "Adicionar pessoa"} fechar={() => setEdit(null)}>
        <form className="pilha" onSubmit={async (e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget);
          const corpo: any = { nome: f.get("nome"), perfil: f.get("perfil"), filas: f.getAll("filas"), cidades: String(f.get("cidades") ?? "").split(",").map((s) => s.trim()).filter(Boolean) };
          if (!edit.id) { corpo.email = f.get("email"); corpo.senha = f.get("senha"); } else if (f.get("senha")) corpo.senha = f.get("senha");
          const r = await acao(() => api(edit.id ? `/usuarios/${edit.id}` : "/usuarios", { metodo: edit.id ? "PATCH" : "POST", corpo }), "Salvo");
          if (r) { setEdit(null); recarregar(); }
        }}>
          <label className="campo">Nome<input name="nome" defaultValue={edit.nome} required /></label>
          {!edit.id && <label className="campo">E-mail<input name="email" type="email" required /></label>}
          <label className="campo">{edit.id ? "Nova senha (opcional)" : "Senha (mín. 8)"}<input name="senha" type="password" minLength={8} required={!edit.id} /></label>
          <label className="campo">Perfil<select name="perfil" defaultValue={edit.perfil}><option value="atendente">Atendente / Vendedor</option><option value="supervisor">Supervisor</option><option value="admin">Administrador</option></select></label>
          <div className="campo"><span style={{ fontSize: 12.5, fontWeight: 600 }}>Filas</span><div className="linha">{filas.map((f) => <label key={f.id} className="linha" style={{ gap: 4 }}><input type="checkbox" name="filas" value={f.nome} defaultChecked={edit.filas?.includes(f.nome)} style={{ width: "auto" }} />{f.nome}</label>)}</div></div>
          <label className="campo">Cidades que atende (para escolher o vendedor)<input name="cidades" defaultValue={edit.cidades?.join(", ")} placeholder="Belo Horizonte, Contagem" /></label>
          <div className="linha entre">{edit.id && edit.id !== eu?.id ? <button type="button" className="btn perigo" onClick={async () => { if (confirm("Excluir esta pessoa?")) { await acao(() => api(`/usuarios/${edit.id}`, { metodo: "DELETE" })); setEdit(null); recarregar(); } }}>Excluir</button> : <span />}
            <div className="linha"><button type="button" className="btn" onClick={() => setEdit(null)}>Cancelar</button><button className="btn primario">Salvar</button></div></div>
        </form></Modal>}
    </div>
  );
}
