export * from "./tipos.ts";
export * from "./cloud-api.ts";
export * from "./evolution.ts";
export * from "./simulador.ts";
import { decifrarJson } from "@domma/shared";
import { CanalCloudApi } from "./cloud-api.ts";
import { CanalEvolution } from "./evolution.ts";
import { CanalSimulador } from "./simulador.ts";
import type { Canal } from "./tipos.ts";

export function canalDaConexao(c: { id: string; conta_id: string; tipo: string; credenciais: string | null }): Canal {
  if (c.tipo === "simulador") return new CanalSimulador();
  const cred = decifrarJson<any>(c.credenciais) ?? {};
  if (c.tipo === "oficial") return new CanalCloudApi(cred);
  return new CanalEvolution(nomeInstancia(c), cred.chave_instancia ?? "");
}

export const nomeInstancia = (c: { id: string; conta_id: string }) => `${c.conta_id}-${c.id}`;
