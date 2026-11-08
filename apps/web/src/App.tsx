import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Provedor, useApp } from "./contexto.tsx";
import { Login } from "./paginas/Login.tsx";
import { Dashboard } from "./paginas/Dashboard.tsx";
import { Atendimento } from "./paginas/Atendimento.tsx";
import { Simulador } from "./paginas/Simulador.tsx";
import { Agente } from "./paginas/Agente.tsx";
import { Conexoes } from "./paginas/Conexoes.tsx";
import { Equipe } from "./paginas/Equipe.tsx";
import { Relatorios } from "./paginas/Relatorios.tsx";
import { Pagamentos } from "./paginas/Pagamentos.tsx";
import { Campanhas } from "./paginas/Campanhas.tsx";
import { Saude } from "./paginas/Saude.tsx";
import { Plataforma } from "./paginas/Plataforma.tsx";
import { api, sessao } from "./api.ts";

/** Faixa amarela quando o administrador da plataforma está dentro da conta de um cliente. */
function FaixaSuporte() {
  const { eu } = useApp();
  if (!eu?.suporte) return null;
  return (
    <div style={{ background: "var(--amarelo-bg)", borderBottom: "1px solid var(--amarelo)", padding: "6px 16px", fontSize: 13, display: "flex", gap: 12, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
      Você está na conta <b>{eu.conta_nome}</b> como suporte Domma. Tudo o que fizer fica registrado.
      <button className="btn pequeno" onClick={() => { let t = ""; try { t = sessionStorage.getItem("domma.token.plataforma") ?? ""; sessionStorage.removeItem("domma.token.plataforma"); } catch { /* ok */ } sessao.token = t; location.href = t ? "/plataforma" : "/login"; }}>Voltar para a Plataforma</button>
    </div>
  );
}

const MENU = [["/", "Dashboard"], ["/atendimento", "Atendimento"], ["/campanhas", "Campanhas"], ["/relatorios", "Relatórios"], ["/saude", "Saúde"]] as const;
const CONFIGURAR = [["/agente", "Agente de IA"], ["/conexoes", "Conexões"], ["/equipe", "Equipe"], ["/pagamentos", "Pagamentos"], ["/simulador", "Simulador"]] as const;
const SO_ATENDENTE = ["/", "/atendimento", "/simulador"];

function Topo() {
  const { eu, sair } = useApp();
  const [aberto, setAberto] = useState(false);
  const [status, setStatus] = useState(eu?.status ?? "online");
  const loc = useLocation();
  // Fecha o menu "Configurar" ao clicar fora ou trocar de página.
  useEffect(() => {
    const fechar = (e: MouseEvent) => document.querySelectorAll<HTMLDetailsElement>("details.menu-config[open]").forEach((d) => { if (!d.contains(e.target as Node)) d.open = false; });
    document.addEventListener("click", fechar);
    return () => document.removeEventListener("click", fechar);
  }, []);
  useEffect(() => { document.querySelectorAll<HTMLDetailsElement>("details.menu-config[open]").forEach((d) => (d.open = false)); }, [loc.pathname]);
  return (
    <header className="topo">
      <button className="menu-movel" onClick={() => setAberto(!aberto)} aria-label="Menu">☰</button>
      <div className="marca"><img src="/logo-branco.png" alt="Domma Tecnologia" /><span>Chat</span></div>
      <nav className={aberto ? "aberto" : ""} onClick={() => setAberto(false)}>
        {MENU.filter(([c]) => eu?.perfil !== "atendente" || SO_ATENDENTE.includes(c)).map(([c, n]) => (
          <NavLink key={c} to={c} end={c === "/"} className={({ isActive }) => (isActive || (c !== "/" && loc.pathname.startsWith(c)) ? "ativo" : "")}>{n}</NavLink>
        ))}
        {eu?.perfil === "atendente" ? <NavLink to="/simulador">Simulador</NavLink> : (
          <details className="menu-config">
            <summary className={CONFIGURAR.some(([c]) => loc.pathname.startsWith(c)) ? "ativo" : ""}>Configurar ▾</summary>
            <div>{CONFIGURAR.map(([c, n]) => <NavLink key={c} to={c} onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; setAberto(false); }}>{n}</NavLink>)}</div>
          </details>
        )}
        {eu?.admin_plataforma && <NavLink to="/plataforma" className={({ isActive }) => (isActive ? "ativo" : "")} style={{ color: "#C9BEFF" }}>◆ Plataforma</NavLink>}
      </nav>
      <div className="conta">
        <select aria-label="Seu status" value={status} onChange={async (e) => { setStatus(e.target.value); await api("/auth/status", { metodo: "PATCH", corpo: { status: e.target.value } }); }}
          style={{ width: "auto", padding: "3px 8px", background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,.25)", fontSize: 12 }}>
          <option value="online">● Online</option><option value="ausente">● Ausente</option><option value="offline">● Offline</option>
        </select>
        <span className="nome-conta">Conta: {eu?.conta_nome}</span>
        <button className="btn pequeno fantasma" style={{ color: "#CFC8F5" }} onClick={sair}>Sair</button>
      </div>
    </header>
  );
}

function Protegido({ children, gestor, plataforma }: { children: JSX.Element; gestor?: boolean; plataforma?: boolean }) {
  const { eu, carregando } = useApp();
  if (carregando) return null;
  if (!eu) return <Navigate to="/login" replace />;
  if (plataforma && !eu.admin_plataforma) return <Navigate to="/" replace />;
  if (gestor && eu.perfil === "atendente") return <Navigate to="/atendimento" replace />;
  return <><Topo /><FaixaSuporte />{children}</>;
}

export function App() {
  return (
    <Provedor>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Protegido><Dashboard /></Protegido>} />
          <Route path="/atendimento" element={<Protegido><Atendimento /></Protegido>} />
          <Route path="/atendimento/:id" element={<Protegido><Atendimento /></Protegido>} />
          <Route path="/simulador" element={<Protegido><Simulador /></Protegido>} />
          <Route path="/campanhas" element={<Protegido gestor><Campanhas /></Protegido>} />
          <Route path="/agente" element={<Protegido gestor><Agente /></Protegido>} />
          <Route path="/equipe" element={<Protegido gestor><Equipe /></Protegido>} />
          <Route path="/relatorios" element={<Protegido gestor><Relatorios /></Protegido>} />
          <Route path="/conexoes" element={<Protegido gestor><Conexoes /></Protegido>} />
          <Route path="/pagamentos" element={<Protegido gestor><Pagamentos /></Protegido>} />
          <Route path="/saude" element={<Protegido gestor><Saude /></Protegido>} />
          <Route path="/plataforma" element={<Protegido plataforma><Plataforma /></Protegido>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </Provedor>
  );
}
