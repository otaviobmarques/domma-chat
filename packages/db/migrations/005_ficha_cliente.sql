-- Ficha do cliente (SaaS): dados cadastrais, plano, limites e bloqueio.
ALTER TABLE contas
  ADD COLUMN IF NOT EXISTS razao_social text,
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS responsavel_nome text,
  ADD COLUMN IF NOT EXISTS responsavel_email text,
  ADD COLUMN IF NOT EXISTS responsavel_telefone text,
  ADD COLUMN IF NOT EXISTS cidade text,
  ADD COLUMN IF NOT EXISTS uf text,
  ADD COLUMN IF NOT EXISTS observacoes text,
  ADD COLUMN IF NOT EXISTS limite_usuarios int,
  ADD COLUMN IF NOT EXISTS limite_numeros int,
  ADD COLUMN IF NOT EXISTS limite_ia_mensal numeric(10,2),
  ADD COLUMN IF NOT EXISTS inicio_contrato date,
  ADD COLUMN IF NOT EXISTS vencimento date,
  ADD COLUMN IF NOT EXISTS bloqueio_motivo text,
  ADD COLUMN IF NOT EXISTS bloqueado_em timestamptz;
