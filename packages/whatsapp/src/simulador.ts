import { randomUUID } from "node:crypto";
import type { Canal } from "./tipos.ts";

/**
 * Canal SIMULADOR: não fala com o WhatsApp. As mensagens enviadas ficam só no banco e aparecem
 * na tela "Simulador" do painel, onde você escreve como se fosse o cliente. Para testes e demonstração.
 */
export class CanalSimulador implements Canal {
  async enviarTexto() { return { idExterno: "sim-" + randomUUID() }; }
  async enviarModelo() { return { idExterno: "sim-" + randomUUID() }; }
  async enviarMidia() { return { idExterno: "sim-" + randomUUID() }; }
  async digitando() {}
  async reagir() {}
  async baixarMidia(m: { base64?: string; mime?: string }) {
    return { dados: Buffer.from(m.base64 ?? "", "base64"), mime: m.mime ?? "application/octet-stream" };
  }
}
