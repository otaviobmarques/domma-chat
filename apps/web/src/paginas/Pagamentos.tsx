import { useState } from "react";
import { api } from "../api.ts";
import { Carregando, Chave, useDados } from "../componentes.tsx";
import { useAcao } from "../contexto.tsx";

const GW = { asaas: { nome: "Asaas", desc: "Pix, boleto e cartão. Ótimo para o Brasil." }, mercadopago: { nome: "Mercado Pago", desc: "Pix e checkout com link." }, stripe: { nome: "Stripe", desc: "Cartão via Checkout / Payment Link." } } as const;

export function Pagamentos() {
  const acao = useAcao();
  const { dados: gws, recarregar } = useDados<any[]>(() => api("/gateways"));
  const { dados: conta, recarregar: recConta } = useDados<any>(() => api("/conta"));
  const [form, setForm] = useState<Record<string, any>>({});
  if (!gws || !conta) return <div className="pagina"><Carregando /></div>;
  const val = (t: string) => form[t] ?? { ...(gws.find((g) => g.tipo === t) ?? { ativo: false, padrao: false, ambiente: "teste", formas: ["pix"] }), chave: "" };
  const set = (t: string, k: string, v: any) => setForm({ ...form, [t]: { ...val(t), [k]: v } });
  return (
    <div className="pagina">
      <div className="cab"><div><h1>Pagamentos</h1><p className="sub" style={{ margin: 0 }}>A IA e a equipe enviam cobranças dentro da conversa. Quando o pagamento cai, a conversa recebe a etiqueta "Pagou" e a IA agradece.</p></div></div>
      <div className="grade g3" style={{ marginBottom: 14 }}>
        {(Object.keys(GW) as (keyof typeof GW)[]).map((t) => { const g = val(t); const salvo = gws.find((x) => x.tipo === t); return (
          <div key={t} className="cartao pilha">
            <div className="linha entre"><div><h2>{GW[t].nome}</h2><div className="mini">{GW[t].desc}</div></div><Chave marcado={g.ativo} onChange={(v) => set(t, "ativo", v)} rotulo="Ativar" /></div>
            <label className="campo">Chave de acesso {salvo?.chave_final && <span className="mini">(atual {salvo.chave_final})</span>}<input type="password" value={g.chave} onChange={(e) => set(t, "chave", e.target.value)} placeholder="Cole a chave" /></label>
            <label className="campo">Ambiente<select value={g.ambiente} onChange={(e) => set(t, "ambiente", e.target.value)}><option value="teste">Teste (sandbox)</option><option value="producao">Produção</option></select></label>
            <div className="linha">{["pix", "boleto", "cartao"].map((f) => <label key={f} className="linha" style={{ gap: 4 }}><input type="checkbox" style={{ width: "auto" }} checked={g.formas.includes(f)} onChange={(e) => set(t, "formas", e.target.checked ? [...g.formas, f] : g.formas.filter((x: string) => x !== f))} />{({ pix: "Pix", boleto: "Boleto", cartao: "Cartão" } as any)[f]}</label>)}</div>
            <label className="linha" style={{ gap: 6 }}><input type="radio" name="padrao" checked={g.padrao} onChange={() => set(t, "padrao", true)} style={{ width: "auto" }} /> Gateway padrão</label>
            {salvo && <div className="mini">Endereço de aviso (webhook): <code>{salvo.webhook}</code>{salvo.segredo_webhook && <><br />Token do webhook: <code>{salvo.segredo_webhook}</code></>}</div>}
            <label className="campo">Segredo do webhook (do painel do gateway, opcional)<input type="password" value={g.segredo_webhook_novo ?? ""} onChange={(e) => set(t, "segredo_webhook_novo", e.target.value)} /></label>
            <button className="btn primario" onClick={async () => { const r = await acao(() => api(`/gateways/${t}`, { metodo: "PUT", corpo: { ativo: g.ativo, padrao: g.padrao, ambiente: g.ambiente, formas: g.formas, chave: g.chave || undefined, segredo_webhook: g.segredo_webhook_novo || undefined } }), "Gateway salvo"); if (r) { setForm({ ...form, [t]: undefined }); recarregar(); } }}>Salvar</button>
          </div>); })}
      </div>
      <div className="cartao"><h2>Regras</h2>
        <div className="grade g2" style={{ marginTop: 10 }}>
          <label className="campo">Cobranças acima deste valor pedem aprovação humana (R$)<input type="number" defaultValue={conta.config.limiteCobrancaSemAprovacao} onBlur={async (e) => { await acao(() => api("/conta", { metodo: "PATCH", corpo: { config: { limiteCobrancaSemAprovacao: Number(e.target.value) } } }), "Regra salva"); recConta(); }} /></label>
          <div className="aviso">A IA só cobra valores da tabela de serviços da base de conhecimento. Dados de cartão nunca passam pelo Domma Chat: ficam no ambiente do gateway. "Já paguei" com comprovante não confirma: o sistema confere no gateway.</div>
        </div></div>
    </div>
  );
}
