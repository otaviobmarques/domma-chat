-- Login por nome de usuário (além do e-mail).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS login text;
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_login ON usuarios (lower(login)) WHERE login IS NOT NULL;
