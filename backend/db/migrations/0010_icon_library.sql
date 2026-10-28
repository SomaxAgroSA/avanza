-- Biblioteca de ícones da plataforma (regras de negócio §25): ícones da galeria Lucide importados em
-- Configurações → Ícones, oferecidos nos seletores de projeto, tipo de tarefa e espaço da Documentação além
-- dos ícones padrão de cada lugar. O nome é o do Lucide ("tractor", "file-spreadsheet").
CREATE TABLE "icon_library" (
  "name" text PRIMARY KEY,
  "created_by" text REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE "icon_library" ENABLE ROW LEVEL SECURITY;
