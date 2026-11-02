-- Urgência (regras de negócio §31): semáforo alta / média / baixa nas tarefas e nos projetos; '' = não
-- definida (o que já existe fica sem urgência). Convive com a prioridade, que segue o cadastro.
ALTER TABLE "tasks" ADD COLUMN "urgency" text NOT NULL DEFAULT '';
ALTER TABLE "projects" ADD COLUMN "urgency" text NOT NULL DEFAULT '';
