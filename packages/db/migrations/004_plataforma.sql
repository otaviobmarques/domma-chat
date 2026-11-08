-- SaaS: administrador da plataforma Domma (vê a infraestrutura e todos os clientes).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS admin_plataforma boolean NOT NULL DEFAULT false;
ALTER TABLE contas ADD COLUMN IF NOT EXISTS ativa boolean NOT NULL DEFAULT true;
