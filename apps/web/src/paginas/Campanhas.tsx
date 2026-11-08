export function Campanhas() {
  return (
    <div className="pagina" style={{ maxWidth: 860 }}>
      <span className="rotulo">Fase 2 · Vendas</span><h1>Campanhas e follow-up</h1>
      <p className="sub">Iniciar contato com listas de clientes em quatro etapas. A base de dados (campanhas, envios, follow-ups, opt-out e janela de 24h) já está pronta; a tela entra na próxima entrega.</p>
      <div className="grade g2" style={{ marginTop: 16 }}>
        {[["1. Contatos", "Importação de planilha (XLSX ou CSV), reconhecimento das colunas (nome, telefone, placa, cidade, fonte, campanha), remoção de duplicados e inválidos, e exclusão de quem pediu para não receber."],
          ["2. Mensagem", "API Oficial: modelo aprovado pela Meta. QR Code: texto livre que a IA reescreve com pequenas variações. Campos [nome], [placa], [cidade] e prévia ao vivo."],
          ["3. Respostas", "Quem atende quando o cliente responder (IA, IA sugere ou equipe), o objetivo da campanha que a IA segue e a etiqueta aplicada."],
          ["4. Envio", "Agora ou agendado, janela de horário, ritmo com intervalos aleatórios, lembrete após X horas (máx. 2) e parada imediata com SAIR."]].map(([t, d]) => (
          <div key={t} className="cartao"><h2>{t}</h2><p className="sub" style={{ marginBottom: 0 }}>{d}</p></div>))}
      </div>
      <div className="aviso" style={{ marginTop: 16 }}>Hoje você já pode trazer leads pelo endereço de entrada (Goalfy, Zapier, Make ou n8n) em <b>Conexões</b>: a IA chama cada lead novo em poucos minutos.</div>
    </div>
  );
}
