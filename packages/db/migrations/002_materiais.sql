-- Materiais que a IA pode enviar (apresentações, catálogos, tabelas). Pedido do cliente além do descritivo v1.2.
CREATE TABLE materiais_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  quando_enviar text NOT NULL,          -- instrução para a IA: em que momento mandar
  interesses text[] NOT NULL DEFAULT '{}', -- vazio = qualquer interesse
  arquivo text NOT NULL,                -- chave no armazenamento
  mime text NOT NULL,
  nome_arquivo text NOT NULL,
  legenda text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mensagens ADD COLUMN material_id uuid REFERENCES materiais_ia(id) ON DELETE SET NULL;
