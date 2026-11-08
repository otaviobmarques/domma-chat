import { q, q1, tx } from "@domma/db";
import { enfileirarProcessamento, filas, inserirMensagem, obterConversa, publicar, resolverAlerta, criarAlerta, trocarModo, cancelarFalas, emitirConversa, configConta } from "@domma/core";
import { mascararSensiveis } from "@domma/shared";
import type { EventoCanal, MensagemEntrada } from "@domma/whatsapp";

const TIPO_DB: Record<string, string> = { texto: "texto", audio: "audio", imagem: "imagem", documento: "documento", video: "video", figurinha: "figurinha", localizacao: "localizacao", botao: "botao", reacao: "reacao" };

/**
 * Recebe eventos já normalizados de qualquer canal. Só grava e enfileira (seção 4.1):
 * nunca chama a IA aqui dentro.
 */
export async function receberEventos(conexao: any, eventos: EventoCanal[]) {
  for (const ev of eventos) {
    if (ev.tipo === "mensagem") await receberMensagem(conexao, ev.msg);
    else if (ev.tipo === "status") await receberStatus(conexao, ev.st);
    else if (ev.tipo === "qrcode") {
      await q("UPDATE conexoes SET qrcode = $2, status = 'aguardando_qr' WHERE id = $1", [conexao.id, ev.base64]);
      await publicar(conexao.conta_id, "qrcode.atualizado", { id: conexao.id, qrcode: ev.base64 });
    } else if (ev.tipo === "conexao") {
      const status = ev.estado;
      await q("UPDATE conexoes SET status = $2, numero = COALESCE($3, numero), qrcode = CASE WHEN $2 = 'conectada' THEN NULL ELSE qrcode END, tentativas_restart = CASE WHEN $2 = 'conectada' THEN 0 ELSE tentativas_restart END, atualizado_em = now() WHERE id = $1",
        [conexao.id, status === "desconectada" ? "aguardando_qr" : status, ev.numero ?? null]);
      if (status === "conectada") await resolverAlerta(conexao.conta_id, `conexao:${conexao.id}`);
      else await criarAlerta(conexao.conta_id, { nivel: "urgente", tipo: "conexao", titulo: "Número do QR Code desconectado", detalhe: `${conexao.nome} ${conexao.numero ?? ""} · caiu às ${new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`, chave: `conexao:${conexao.id}`, alvo: { conexaoId: conexao.id }, push: true });
      await publicar(conexao.conta_id, "conexao.estado", { id: conexao.id, status });
    } else if (ev.tipo === "ligacao") {
      const { conversa } = await obterConversa(conexao.conta_id, conexao, ev.telefone);
      await inserirMensagem({ contaId: conexao.conta_id, conversaId: conversa.id, autor: "sistema", tipo: "evento", conteudo: "Cliente tentou ligar. A ligação foi recusada." });
      await filas.envio.add("texto", { contaId: conexao.conta_id, conversaId: conversa.id, tipo: "texto", autor: "ia", texto: "Oi! Por aqui não consigo atender ligação 😊 Pode me escrever ou mandar um áudio que eu te respondo rapidinho." });
    }
  }
}

export async function receberMensagem(conexao: any, m: MensagemEntrada) {
  if (m.grupo || m.status) return; // grupos e status: não chama a IA
  const { conversa, nova } = await obterConversa(conexao.conta_id, conexao, m.telefone, m.nome);

  // Edição: usa a versão editada. Exclusão: ignora a apagada.
  if (m.editadaDe) {
    await q("UPDATE mensagens SET conteudo = $3 WHERE conta_id = $1 AND id_externo = $2", [conexao.conta_id, m.editadaDe, m.texto ?? null]);
    if (!m.deMim) await enfileirarProcessamento(conversa.id);
    return;
  }
  if (m.apagada) return;

  // Mensagem enviada pelo celular do atendente (QR Code): grava como humano e pausa a IA.
  if (m.deMim) {
    const existe = await q1("SELECT 1 FROM mensagens WHERE conta_id = $1 AND id_externo = $2", [conexao.conta_id, m.idExterno]);
    if (existe) return; // eco de mensagem que o próprio sistema enviou
    await inserirMensagem({ contaId: conexao.conta_id, conversaId: conversa.id, autor: "humano", tipo: TIPO_DB[m.tipo], conteudo: m.texto, idExterno: m.idExterno, leitura: "enviada pelo celular" });
    if (conversa.modo !== "humano") { await cancelarFalas(conversa.id); await trocarModo(conversa.id, "humano", { motivo: "atendente respondeu pelo celular", ator: "sistema" }); }
    return;
  }

  // Cartão ou senha: mascara antes de gravar.
  const { texto, mascarou } = mascararSensiveis(m.texto ?? "");
  const citada = m.citadaId ? await q1<{ conteudo: string }>("SELECT conteudo FROM mensagens WHERE conta_id = $1 AND id_externo = $2", [conexao.conta_id, m.citadaId]) : null;
  const msg = await inserirMensagem({
    contaId: conexao.conta_id, conversaId: conversa.id, autor: "cliente", tipo: TIPO_DB[m.tipo] ?? "texto",
    conteudo: (citada ? `↪ "${(citada.conteudo ?? "").slice(0, 80)}" ` : "") + texto || null,
    idExterno: m.idExterno, midiaMime: m.midia?.mime ?? null, citada: m.citadaId,
  });
  if (!msg) return; // duplicada: idempotência pelo id externo (wamid)

  const updates: string[] = ["estado = 'aberta'"];
  if (conexao.tipo === "oficial") updates.push("janela_24h_ate = now() + interval '24 hours'");
  await q(`UPDATE conversas SET ${updates.join(", ")} WHERE id = $1`, [conversa.id]);
  if (m.referral) {
    await q("UPDATE conversas SET referral = $2 WHERE id = $1", [conversa.id, JSON.stringify(m.referral)]);
    await q("UPDATE contatos SET fonte_ultima = 'meta_ads', fonte_primeira = CASE WHEN fonte_primeira = 'organico' THEN 'meta_ads' ELSE fonte_primeira END, campanha = COALESCE($2, campanha) WHERE id = $1", [conversa.contato_id, m.referral.headline ?? null]);
  }
  await q("UPDATE campanha_envios SET respondeu_em = COALESCE(respondeu_em, now()), status = 'respondeu' WHERE contato_id = $1 AND respondeu_em IS NULL", [conversa.contato_id]);
  if (mascarou) await filas.envio.add("texto", { contaId: conexao.conta_id, conversaId: conversa.id, tipo: "texto", autor: "ia", texto: "Por segurança, não envie dados de cartão ou senhas pelo WhatsApp. Já ocultei essa informação por aqui. 🔒" });

  if (m.midia && ["audio", "imagem", "documento"].includes(m.tipo)) {
    await filas.midia.add("midia", { mensagemId: msg.id, midia: m.midia }, { jobId: `midia-${msg.id}` });
  } else {
    // Cliente escreveu enquanto a IA digitava: cancela e refaz considerando a nova mensagem.
    if (conversa.modo === "ia") await cancelarFalas(conversa.id);
    const cfg = await configConta(conexao.conta_id);
    await enfileirarProcessamento(conversa.id, "mensagem", cfg.antiLoop.agruparMs);
  }
  if (nova) await emitirConversa(conversa.id);
}

async function receberStatus(conexao: any, st: { idExterno: string; status: string; erroCodigo?: number; erro?: string }) {
  const m = await q1<any>(
    `UPDATE mensagens SET status = CASE WHEN status = 'lida' THEN status ELSE $3 END, erro = COALESCE($4, erro)
      WHERE conta_id = $1 AND id_externo = $2 RETURNING *`, [conexao.conta_id, st.idExterno, st.status, st.erro ? `${st.erroCodigo}: ${st.erro}` : null]);
  if (!m) return;
  await publicar(conexao.conta_id, "mensagem.status", m);
  if (st.status === "lida") await q("UPDATE campanha_envios e SET lido_em = COALESCE(lido_em, now()) FROM conversas c WHERE c.id = $1 AND e.contato_id = c.contato_id", [m.conversa_id]);
  if (st.status === "falhou") {
    if (st.erroCodigo === 131047) await q("UPDATE conversas SET janela_24h_ate = NULL WHERE id = $1", [m.conversa_id]);
    await criarAlerta(conexao.conta_id, { nivel: "atencao", tipo: "envio_falhou", titulo: "Mensagem não entregue", detalhe: `${st.erroCodigo ?? ""} ${st.erro ?? ""}`.trim(), chave: `falha:${m.conversa_id}`, alvo: { conversaId: m.conversa_id } });
  }
}

export { tx };
