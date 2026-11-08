import { hmacSha256Hex, iguaisSeguro } from "@domma/shared";

export interface DadosCobranca { valor: number; descricao: string; forma: "pix" | "boleto" | "cartao"; cliente: { nome: string; telefone: string; cpfCnpj?: string }; referencia: string }
export interface CobrancaCriada { idExterno: string; link?: string; pixCopiaCola?: string }
export interface ConfirmacaoPagamento { idExterno: string; referencia?: string; pago: boolean }

/** Interface única da seção 6.5, com um adaptador por gateway. */
export interface PaymentGateway {
  criarCobranca(d: DadosCobranca): Promise<CobrancaCriada>;
  consultar(idExterno: string): Promise<{ pago: boolean }>;
  cancelar(idExterno: string): Promise<void>;
  /** Valida e interpreta o webhook do gateway. Devolve null se não for um evento de pagamento confirmado. */
  validarWebhook(cabecalhos: Record<string, string | undefined>, corpoBruto: Buffer, segredo: string): ConfirmacaoPagamento | null;
}

async function json(r: Response) {
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`gateway ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

export class Asaas implements PaymentGateway {
  private base: string;
  constructor(private chave: string, ambiente: "teste" | "producao") {
    this.base = ambiente === "producao" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
  }
  private h() { return { access_token: this.chave, "Content-Type": "application/json", "User-Agent": "domma-chat" }; }
  async criarCobranca(d: DadosCobranca) {
    const busca = await json(await fetch(`${this.base}/customers?mobilePhone=${d.cliente.telefone}`, { headers: this.h() }));
    const cliente = busca.data?.[0] ?? await json(await fetch(`${this.base}/customers`, { method: "POST", headers: this.h(), body: JSON.stringify({ name: d.cliente.nome, mobilePhone: d.cliente.telefone, cpfCnpj: d.cliente.cpfCnpj }) }));
    const billingType = { pix: "PIX", boleto: "BOLETO", cartao: "CREDIT_CARD" }[d.forma];
    const venc = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const p = await json(await fetch(`${this.base}/payments`, { method: "POST", headers: this.h(), body: JSON.stringify({ customer: cliente.id, billingType, value: d.valor, dueDate: venc, description: d.descricao, externalReference: d.referencia }) }));
    let pixCopiaCola: string | undefined;
    if (d.forma === "pix") pixCopiaCola = (await json(await fetch(`${this.base}/payments/${p.id}/pixQrCode`, { headers: this.h() }))).payload;
    return { idExterno: p.id, link: p.invoiceUrl, pixCopiaCola };
  }
  async consultar(id: string) { const p = await json(await fetch(`${this.base}/payments/${id}`, { headers: this.h() })); return { pago: ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(p.status) }; }
  async cancelar(id: string) { await json(await fetch(`${this.base}/payments/${id}`, { method: "DELETE", headers: this.h() })); }
  validarWebhook(cab: Record<string, string | undefined>, corpo: Buffer, segredo: string) {
    if (!cab["asaas-access-token"] || !iguaisSeguro(cab["asaas-access-token"], segredo)) throw new Error("token do webhook Asaas inválido");
    const j = JSON.parse(corpo.toString());
    if (!["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(j.event)) return null;
    return { idExterno: j.payment.id, referencia: j.payment.externalReference, pago: true };
  }
}

export class MercadoPago implements PaymentGateway {
  constructor(private chave: string) {}
  private h(idem?: string) { return { Authorization: `Bearer ${this.chave}`, "Content-Type": "application/json", ...(idem ? { "X-Idempotency-Key": idem } : {}) }; }
  async criarCobranca(d: DadosCobranca) {
    if (d.forma === "pix") {
      const p = await json(await fetch("https://api.mercadopago.com/v1/payments", { method: "POST", headers: this.h(d.referencia), body: JSON.stringify({ transaction_amount: d.valor, description: d.descricao, payment_method_id: "pix", external_reference: d.referencia, payer: { email: `${d.cliente.telefone}@cliente.dommachat`, first_name: d.cliente.nome } }) }));
      return { idExterno: String(p.id), pixCopiaCola: p.point_of_interaction?.transaction_data?.qr_code, link: p.point_of_interaction?.transaction_data?.ticket_url };
    }
    const pref = await json(await fetch("https://api.mercadopago.com/checkout/preferences", { method: "POST", headers: this.h(), body: JSON.stringify({ items: [{ title: d.descricao, quantity: 1, unit_price: d.valor, currency_id: "BRL" }], external_reference: d.referencia }) }));
    return { idExterno: pref.id, link: pref.init_point };
  }
  async consultar(id: string) { const p = await json(await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: this.h() })); return { pago: p.status === "approved" }; }
  async cancelar(id: string) { await json(await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { method: "PUT", headers: this.h(), body: JSON.stringify({ status: "cancelled" }) })); }
  validarWebhook(cab: Record<string, string | undefined>, corpo: Buffer, segredo: string) {
    // x-signature: ts=...,v1=... ; manifesto: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
    const j = JSON.parse(corpo.toString());
    const partes = Object.fromEntries((cab["x-signature"] ?? "").split(",").map((p) => p.trim().split("=")));
    const manifesto = `id:${j.data?.id};request-id:${cab["x-request-id"] ?? ""};ts:${partes.ts};`;
    if (!partes.v1 || !iguaisSeguro(partes.v1, hmacSha256Hex(segredo, manifesto))) throw new Error("assinatura Mercado Pago inválida");
    if (j.type !== "payment") return null;
    return { idExterno: String(j.data.id), pago: false }; // status confirmado por consulta (consultar)
  }
}

export class Stripe implements PaymentGateway {
  constructor(private chave: string) {}
  private h() { return { Authorization: `Bearer ${this.chave}`, "Content-Type": "application/x-www-form-urlencoded" }; }
  async criarCobranca(d: DadosCobranca) {
    const corpo = new URLSearchParams({ mode: "payment", success_url: process.env.APP_URL ?? "https://example.com", "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "brl", "line_items[0][price_data][unit_amount]": String(Math.round(d.valor * 100)), "line_items[0][price_data][product_data][name]": d.descricao, client_reference_id: d.referencia });
    const s = await json(await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: this.h(), body: corpo }));
    return { idExterno: s.id, link: s.url };
  }
  async consultar(id: string) { const s = await json(await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, { headers: this.h() })); return { pago: s.payment_status === "paid" }; }
  async cancelar(id: string) { await json(await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}/expire`, { method: "POST", headers: this.h() })); }
  validarWebhook(cab: Record<string, string | undefined>, corpo: Buffer, segredo: string) {
    const partes = (cab["stripe-signature"] ?? "").split(",").map((p) => p.split("="));
    const t = partes.find((p) => p[0] === "t")?.[1];
    const v1 = partes.filter((p) => p[0] === "v1").map((p) => p[1]);
    const esperado = hmacSha256Hex(segredo, `${t}.${corpo.toString()}`);
    if (!t || !v1.some((s) => iguaisSeguro(s, esperado))) throw new Error("assinatura Stripe inválida");
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new Error("webhook Stripe expirado");
    const j = JSON.parse(corpo.toString());
    if (j.type !== "checkout.session.completed") return null;
    return { idExterno: j.data.object.id, referencia: j.data.object.client_reference_id, pago: j.data.object.payment_status === "paid" };
  }
}

export function criarGateway(tipo: string, chave: string, ambiente: "teste" | "producao"): PaymentGateway {
  if (tipo === "asaas") return new Asaas(chave, ambiente);
  if (tipo === "mercadopago") return new MercadoPago(chave);
  if (tipo === "stripe") return new Stripe(chave);
  throw new Error(`gateway desconhecido: ${tipo}`);
}
