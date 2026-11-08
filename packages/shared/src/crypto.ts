import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

function chave(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) {
    if (process.env.NODE_ENV === "production") throw new Error("ENCRYPTION_KEY obrigatória em produção");
    return createHash("sha256").update("domma-dev-key-nao-usar-em-producao").digest();
  }
  return createHash("sha256").update(k).digest();
}

/** AES-256-GCM. Formato: v1:<iv>:<tag>:<dados> em base64. */
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), dados.toString("base64")].join(":");
}

export function decifrar(valor: string): string {
  const [v, iv, tag, dados] = valor.split(":");
  if (v !== "v1") throw new Error("formato de segredo desconhecido");
  const d = createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(dados, "base64")), d.final()]).toString("utf8");
}

export function cifrarJson(obj: unknown): string { return cifrar(JSON.stringify(obj)); }
export function decifrarJson<T = any>(valor: string | null | undefined): T | null {
  return valor ? (JSON.parse(decifrar(valor)) as T) : null;
}

export function iguaisSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function hmacSha256Hex(segredo: string, corpo: Buffer | string): string {
  return createHmac("sha256", segredo).update(corpo).digest("hex");
}

export function tokenAleatorio(prefixo = "", bytes = 24): string {
  return prefixo + randomBytes(bytes).toString("base64url");
}

/** Mostra só o fim de uma chave (para a tela, nunca a chave inteira). */
export function mascararChave(c: string | null | undefined): string | null {
  if (!c) return null;
  return "••••••••" + c.slice(-4);
}
