import { useState } from "react";
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
import { api } from "./api.ts";

const MENU = [
  ["/", "Dashboard"], ["/atendimento", "Atendimento"], ["/campanhas", "Campanhas"], ["/agente", "Agente de IA"], ["/equipe", "Equipe"],
  ["/relatorios", "Relatórios"], ["/conexoes", "Conexões"], ["/pagamentos", "Pagamentos"], ["/simulador", "Simulador"],
] as const;

function Topo() {
  const { eu, sair } = useApp();
  const [aberto, setAberto] = useState(false);
  const [status, setStatus] = useState(eu?.status ?? "online");
  const loc = useLocation();
  return (
    <header className="topo">
      <button className="menu-movel" onClick={() => setAberto(!aberto)} aria-label="Menu">☰</button>
      <div className="marca"><img src="/logo-branco.png" alt="Domma Tecnologia" /><span>Chat</span></div>
      <nav className={aberto ? "aberto" : ""} onClick={() => setAberto(false)}>
        {MENU.filter(([c]) => eu?.perfil !== "atendente" || ["/", "/atendimento", "/simulador"].includes(c)).map(([c, n]) => (
          <NavLink key={c} to={c} end={c === "/"} className={({ isActive }) => (isActive || (c !== "/" && loc.pathname.startsWith(c)) ? "ativo" : "")}>{n}</NavLink>
        ))}
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

function Protegido({ children, gestor }: { children: JSX.Element; gestor?: boolean }) {
  const { eu, carregando } = useApp();
  if (carregando) return null;
  if (!eu) return <Navigate to="/login" replace />;
  if (gestor && eu.perfil === "atendente") return <Navigate to="/atendimento" replace />;
  return <><Topo />{children}</>;
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
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </Provedor>
  );
}
