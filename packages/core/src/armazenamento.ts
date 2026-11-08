import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { hmacSha256Hex, iguaisSeguro } from "@domma/shared";

const usaS3 = !!process.env.S3_BUCKET;
const dirLocal = path.resolve(process.env.STORAGE_DIR ?? "./armazenamento");
const s3 = usaS3 ? new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION ?? "auto", forcePathStyle: !!process.env.S3_ENDPOINT, credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! } }) : null;

const ext = (mime: string) => ({ "audio/ogg": "ogg", "audio/mpeg": "mp3", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", "video/mp4": "mp4" } as Record<string, string>)[mime.split(";")[0]] ?? "bin";

/** Armazenamento de objetos compatível com S3 (ou disco local em desenvolvimento). Devolve a chave. */
export async function guardarArquivo(contaId: string, dados: Buffer, mime: string): Promise<string> {
  const chave = `${contaId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext(mime)}`;
  if (s3) await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: chave, Body: dados, ContentType: mime }));
  else { await mkdir(path.dirname(path.join(dirLocal, chave)), { recursive: true }); await writeFile(path.join(dirLocal, chave), dados); }
  return chave;
}

export async function lerArquivo(chave: string): Promise<Buffer> {
  if (chave.includes("..")) throw new Error("caminho inválido");
  if (s3) {
    const r = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: chave }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  return readFile(path.join(dirLocal, chave));
}

const segredo = () => process.env.JWT_SECRET ?? "dev-secret";
/** URL assinada (expira) para o painel exibir áudio/imagem sem expor o armazenamento. */
export function urlAssinada(chave: string, validadeS = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + validadeS;
  return `/api/v1/arquivos?k=${encodeURIComponent(chave)}&e=${exp}&s=${hmacSha256Hex(segredo(), `${chave}:${exp}`)}`;
}
export function validarUrl(chave: string, exp: number, assinatura: string): boolean {
  return exp > Date.now() / 1000 && iguaisSeguro(assinatura, hmacSha256Hex(segredo(), `${chave}:${exp}`));
}
