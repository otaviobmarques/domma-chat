import { test } from "node:test";
import assert from "node:assert/strict";
import { ProvedorSimulado } from "./provedores/simulado.ts";
import { ESQUEMA_RESPOSTA, SaidaResposta, extrairJson } from "./saida.ts";
import { montarSistema } from "./prompt.ts";

test("IA pode enviar material quando o lead de franquia pede a apresentação", async () => {
  const sistema = montarSistema({ personalidade: "consultora", nome: "Duda", emojis: "poucos", tratamento: "voce", instrucoes: "", nomeEmpresa: "Teste", regras: {} },
    { trechos: [], materiais: [{ id: "abc12345", titulo: "Apresentação da Franquia", quando: "quando pedir apresentação de franquia", jaEnviado: false }] });
  const r = await new ProvedorSimulado(0).gerar({ sistema, historico: [{ papel: "cliente", texto: "Quero abrir uma franquia, me manda a apresentação?" }], tempoLimiteMs: 1000, esquema: ESQUEMA_RESPOSTA });
  const s = SaidaResposta.parse(extrairJson(r.texto));
  assert.deepEqual(s.enviar_materiais, ["abc12345"]);
});

test("não reenvia material já enviado", async () => {
  const sistema = montarSistema({ personalidade: "consultora", nome: "Duda", emojis: "poucos", tratamento: "voce", instrucoes: "", nomeEmpresa: "Teste", regras: {} },
    { trechos: [], materiais: [{ id: "abc12345", titulo: "Apresentação da Franquia", quando: "quando pedir apresentação", jaEnviado: true }] });
  const r = await new ProvedorSimulado(0).gerar({ sistema, historico: [{ papel: "cliente", texto: "me manda a apresentação" }], tempoLimiteMs: 1000, esquema: ESQUEMA_RESPOSTA });
  assert.deepEqual(SaidaResposta.parse(extrairJson(r.texto)).enviar_materiais, []);
});
