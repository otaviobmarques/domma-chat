import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../api.ts";
import { useApp } from "../contexto.tsx";

export function Login() {
  const { eu, entrar } = useApp();
  const nav = useNavigate();
  const [email, setEmail] = useState(""); const [senha, setSenha] = useState("");
  const [erro, setErro] = useState(""); const [enviando, setEnviando] = useState(false);
  if (eu) return <Navigate to={eu.admin_plataforma && !eu.suporte ? "/plataforma" : "/"} replace />;
  return (
    <div className="login">
      <form className="cartao pilha" onSubmit={async (e) => {
        e.preventDefault(); setErro(""); setEnviando(true);
        try { const r = await api<{ token: string; usuario: { plataforma?: boolean } }>("/auth/login", { corpo: { email, senha } }); await entrar(r.token); nav(r.usuario.plataforma ? "/plataforma" : "/"); }
        catch (x) { setErro((x as Error).message); } finally { setEnviando(false); }
      }}>
        <img src="/logo.png" alt="Domma Tecnologia" style={{ height: 40, alignSelf: "flex-start", marginBottom: 6 }} />
        <div><span className="rotulo">Domma Chat</span><h1>Entrar</h1><p className="sub" style={{ margin: 0 }}>Atendimento e vendas no WhatsApp com IA.</p></div>
        <label className="campo">E-mail ou usuário<input type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="campo">Senha<input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></label>
        {erro && <div className="aviso amarelo" role="alert">{erro}</div>}
        <button className="btn primario" disabled={enviando} style={{ justifyContent: "center", padding: 11 }}>{enviando ? "Entrando…" : "Entrar"}</button>
      </form>
    </div>
  );
}
