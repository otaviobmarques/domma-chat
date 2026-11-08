-- Domma Chat — esquema inicial (seção 5 do descritivo). Todas as tabelas têm conta_id (multiempresa).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE contas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  plano text NOT NULL DEFAULT 'padrao',
  token_leads text NOT NULL UNIQUE,              -- dmc_live_... (entrada do Goalfy/Zapier)
  config jsonb NOT NULL DEFAULT '{}'::jsonb,     -- horário comercial, limites de alerta, regras globais
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE filas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  UNIQUE (conta_id, nome)
);

CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  email text NOT NULL UNIQUE,
  senha_hash text NOT NULL,
  perfil text NOT NULL CHECK (perfil IN ('admin','supervisor','atendente')),
  filas text[] NOT NULL DEFAULT '{}',
  cidades text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online','ausente','offline')),
  google_refresh_token text,                     -- criptografado
  push_inscricoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conexoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('oficial','qr','simulador')),
  nome text NOT NULL,
  numero text,
  status text NOT NULL DEFAULT 'aguardando_qr'
    CHECK (status IN ('aguardando_qr','conectada','caiu','reconectando','precisa_atencao','desconectada')),
  modo_padrao text NOT NULL DEFAULT 'ia' CHECK (modo_padrao IN ('ia','aprova','humano')),
  credenciais text,                              -- JSON criptografado (token, phone_number_id, app_secret, chave da instância...)
  segredo_webhook text NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  qrcode text,
  tentativas_restart int NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  nome text,
  telefone text NOT NULL,
  cidade text,
  extras jsonb NOT NULL DEFAULT '{}'::jsonb,
  opt_out boolean NOT NULL DEFAULT false,
  opt_out_em timestamptz,
  fonte_primeira text,
  fonte_ultima text,
  campanha text,
  utms jsonb,
  id_externo_crm text,
  temperatura text CHECK (temperatura IN ('quente','morno','frio')),
  nota int,
  interesse text,
  motivo_classificacao text,
  dados_extraidos jsonb NOT NULL DEFAULT '{}'::jsonb,
  entrou_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conta_id, telefone)
);

CREATE TABLE conversas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  contato_id uuid NOT NULL REFERENCES contatos(id) ON DELETE CASCADE,
  conexao_id uuid NOT NULL REFERENCES conexoes(id) ON DELETE CASCADE,
  modo text NOT NULL DEFAULT 'ia' CHECK (modo IN ('ia','aprova','humano')),
  fila text,
  responsavel_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  etiquetas text[] NOT NULL DEFAULT '{}',
  resumo_ia text,
  sentimento text,
  motivo_transferencia text,
  esperando_humano_desde timestamptz,
  janela_24h_ate timestamptz,
  estado text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta','encerrada')),
  nao_lidas int NOT NULL DEFAULT 0,
  ultima_mensagem_em timestamptz NOT NULL DEFAULT now(),
  ultima_mensagem_texto text,
  referral jsonb,
  anti_loop jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversas_conta_ultima ON conversas (conta_id, ultima_mensagem_em DESC);
CREATE UNIQUE INDEX conversas_aberta_unica ON conversas (contato_id, conexao_id) WHERE estado = 'aberta';

CREATE TABLE mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  conversa_id uuid NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  autor text NOT NULL CHECK (autor IN ('cliente','ia','humano','sistema','nota')),
  autor_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo text NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto','audio','imagem','documento','video','figurinha','localizacao','botao','reacao','evento')),
  conteudo text,
  midia_url text,
  midia_mime text,
  leitura text,                                  -- transcrição do áudio / o que a IA leu na imagem
  status text NOT NULL DEFAULT 'recebida' CHECK (status IN ('recebida','pendente','enviada','entregue','lida','falhou','cancelada')),
  erro text,
  id_externo text,
  citada_id_externo text,
  fala_id text,
  fontes_usadas jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mensagens_conversa ON mensagens (conversa_id, criado_em);
CREATE UNIQUE INDEX mensagens_id_externo ON mensagens (conta_id, id_externo) WHERE id_externo IS NOT NULL;

CREATE TABLE sugestoes_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  conversa_id uuid NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  partes text[] NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovada','editada','descartada')),
  aprovado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE instrucoes_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  conversa_id uuid NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  autor_id uuid REFERENCES usuarios(id),
  texto text NOT NULL,
  resposta_ia text,
  decisao text CHECK (decisao IN ('executada','sugerida','recusada','pendente')),
  acao_tomada jsonb,
  alternativa jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE retornos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  conversa_id uuid NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  quando timestamptz NOT NULL,
  rotulo text,
  origem text NOT NULL CHECK (origem IN ('cliente','equipe')),
  executor text NOT NULL CHECK (executor IN ('ia','lembrete')),
  status text NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','executado','cancelado')),
  job_id text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retornos_agendados ON retornos (conta_id, quando) WHERE status = 'agendado';

CREATE TABLE oportunidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  contato_id uuid NOT NULL REFERENCES contatos(id) ON DELETE CASCADE,
  interesse text,
  etapa text NOT NULL DEFAULT 'Novo contato',
  valor numeric(12,2),
  responsavel_id uuid REFERENCES usuarios(id),
  origem text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entradas_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  conector text NOT NULL,
  payload jsonb NOT NULL,
  id_externo text,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  contato_id uuid REFERENCES contatos(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX entradas_leads_externo ON entradas_leads (conta_id, id_externo) WHERE id_externo IS NOT NULL;

CREATE TABLE agentes_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL UNIQUE REFERENCES contas(id) ON DELETE CASCADE,
  personalidade text NOT NULL DEFAULT 'consultora',
  nome text NOT NULL DEFAULT 'Duda',
  emojis text NOT NULL DEFAULT 'poucos',
  tratamento text NOT NULL DEFAULT 'voce',
  instrucoes text NOT NULL DEFAULT '',
  regras jsonb NOT NULL DEFAULT '{}'::jsonb,
  capacidades jsonb NOT NULL DEFAULT '{}'::jsonb,
  modo_padrao text NOT NULL DEFAULT 'ia' CHECK (modo_padrao IN ('ia','aprova')),
  velocidade_escrita text NOT NULL DEFAULT 'natural' CHECK (velocidade_escrita IN ('rapida','natural','calma')),
  classificacao jsonb NOT NULL DEFAULT '{}'::jsonb,
  anti_loop jsonb NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provedores_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  provedor text NOT NULL CHECK (provedor IN ('anthropic','openai','gemini','compativel','simulado')),
  rotulo text,
  modelo text NOT NULL,
  endereco_api text,
  chave text,                                    -- criptografada
  ordem int NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  tarefas text[] NOT NULL DEFAULT '{conversa,transcricao,imagem}',
  limite_mensal numeric(10,2),
  gasto_mes numeric(10,4) NOT NULL DEFAULT 0,
  mes_referencia text,
  degradado_ate timestamptz,
  ultimo_tempo_ms int,
  ultimo_erro text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE uso_ia (
  id bigserial PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  provedor_id uuid REFERENCES provedores_ia(id) ON DELETE SET NULL,
  conversa_id uuid,
  tarefa text NOT NULL,
  sucesso boolean NOT NULL,
  tempo_ms int,
  tokens_entrada int,
  tokens_saida int,
  custo numeric(10,6) NOT NULL DEFAULT 0,
  erro text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE base_conhecimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('arquivo','site','texto')),
  titulo text NOT NULL,
  origem text,
  conteudo text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE base_trechos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  documento_id uuid NOT NULL REFERENCES base_conhecimento(id) ON DELETE CASCADE,
  texto text NOT NULL,
  busca tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', texto)) STORED
);
CREATE INDEX base_trechos_busca ON base_trechos USING gin (busca);

CREATE TABLE campanhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  conexao_id uuid REFERENCES conexoes(id),
  modelo text,
  mensagem text,
  objetivo text,
  quem_responde text NOT NULL DEFAULT 'ia',
  etiqueta text,
  agenda jsonb NOT NULL DEFAULT '{}'::jsonb,
  ritmo jsonb NOT NULL DEFAULT '{}'::jsonb,
  regras_follow_up jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','agendada','enviando','pausada','concluida')),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE campanha_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL REFERENCES campanhas(id) ON DELETE CASCADE,
  contato_id uuid NOT NULL REFERENCES contatos(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pendente',
  enviado_em timestamptz, lido_em timestamptz, respondeu_em timestamptz,
  follow_ups int NOT NULL DEFAULT 0,
  UNIQUE (campanha_id, contato_id)
);

CREATE TABLE reunioes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  conversa_id uuid NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  vendedor_id uuid REFERENCES usuarios(id),
  inicio timestamptz NOT NULL, fim timestamptz NOT NULL,
  formato text NOT NULL DEFAULT 'meet',
  id_evento_google text,
  resumo text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gateways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('asaas','mercadopago','stripe')),
  ativo boolean NOT NULL DEFAULT false,
  padrao boolean NOT NULL DEFAULT false,
  ambiente text NOT NULL DEFAULT 'teste',
  formas text[] NOT NULL DEFAULT '{pix}',
  chave text,
  segredo_webhook text NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  UNIQUE (conta_id, tipo)
);
CREATE TABLE cobrancas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  conversa_id uuid NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  gateway_id uuid REFERENCES gateways(id),
  descricao text,
  valor numeric(12,2) NOT NULL,
  forma text NOT NULL DEFAULT 'pix',
  link text,
  pix_copia_cola text,
  id_externo text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('aguardando_aprovacao','pendente','paga','cancelada','falhou')),
  pago_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  nivel text NOT NULL CHECK (nivel IN ('urgente','atencao','info')),
  tipo text NOT NULL,
  titulo text NOT NULL,
  detalhe text,
  alvo jsonb,
  chave text,                                     -- evita alertas duplicados abertos
  resolvido_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX alertas_abertos ON alertas (conta_id, chave) WHERE resolvido_em IS NULL AND chave IS NOT NULL;

CREATE TABLE eventos_auditoria (
  id bigserial PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  usuario_id uuid,
  ator text NOT NULL,                             -- 'usuario' | 'ia' | 'sistema'
  acao text NOT NULL,
  alvo text,
  dados jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feriados (
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  dia date NOT NULL,
  PRIMARY KEY (conta_id, dia)
);
