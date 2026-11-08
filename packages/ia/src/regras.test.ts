import { test } from "node:test";
import assert from "node:assert/strict";
import { planejarEscrita, quebrarEmPartes } from "./escrita.ts";
import { classificarIntencao, ehDespedidaDaIA } from "./intencao.ts";
import { interpretarRetorno, local, mascararSensiveis, proximaAbertura } from "@domma/shared";

test("motor de escrita: pausas e digitação dentro dos limites do descritivo", () => {
  const passos = planejarEscrita(["Oi, tudo bem?", "Me passa a placa do carro que eu já vejo isso pra você."], "natural");
  assert.equal(passos.length, 4);
  assert.ok(passos[0].atrasoMs >= 700 && passos[0].atrasoMs <= 1200, "pausa de leitura 0,7–1,2 s");
  const dig = passos[1].atrasoMs - passos[0].atrasoMs;
  assert.ok(dig >= 1100 * 0.85 && dig <= 5000 * 1.15, "digitação entre 1,1 e 5 s (±15%)");
  assert.ok(passos[2].atrasoMs - passos[1].atrasoMs >= 450, "pausa entre mensagens");
});

test("quebra respostas longas em mensagens curtas", () => {
  const longa = "Frase um bem comprida para teste. ".repeat(12);
  assert.ok(quebrarEmPartes([longa]).every((p) => p.length <= 220));
});

test("porteiro reconhece intenções", () => {
  assert.equal(classificarIntencao("SAIR"), "opt_out");
  assert.equal(classificarIntencao("apaguem meus dados por favor"), "exclusao_dados");
  assert.equal(classificarIntencao("quero falar com um atendente"), "pedido_humano");
  assert.equal(classificarIntencao("vou no procon"), "agressivo_juridico");
  assert.equal(classificarIntencao("você é um robô?"), "pergunta_robo");
  assert.equal(classificarIntencao("obrigado, tchau"), "despedida");
  assert.equal(classificarIntencao("quanto custa?"), "outro");
  assert.ok(ehDespedidaDaIA("Combinado! Até amanhã 👋"));
});

test("retorno agendado segue a tabela da seção 2.11", () => {
  const quarta10h = new Date("2026-11-11T13:00:00Z"); // 10h em Brasília
  const amanha = interpretarRetorno("me chama amanhã", quarta10h);
  assert.equal(amanha?.tipo, "agendar");
  if (amanha?.tipo === "agendar") { const l = local(amanha.quando); assert.equal(l.dia, 12); assert.equal(l.min, 9 * 60); }
  const tarde = interpretarRetorno("me chama mais tarde", quarta10h);
  if (tarde?.tipo === "agendar") assert.equal(local(tarde.quando).min, 13 * 60);
  assert.equal(interpretarRetorno("me chama outro dia", quarta10h)?.tipo, "perguntar_dia");
  assert.equal(interpretarRetorno("boa noite, até amanhã", quarta10h)?.tipo, "despedida");
  const sexta19h = new Date("2026-11-13T22:00:00Z");
  assert.equal(local(proximaAbertura(sexta19h)).dow, 1, "fora do horário na sexta → segunda");
});

test("mascara cartão e senha antes de gravar", () => {
  const r = mascararSensiveis("meu cartão 4111 1111 1111 1111 e senha: abc123");
  assert.ok(r.mascarou);
  assert.ok(!r.texto.includes("4111 1111 1111 1111") && !r.texto.includes("abc123"));
});
