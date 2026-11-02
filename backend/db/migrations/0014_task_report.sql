-- Informe do projeto (regras de negócio §29): a tarefa pode ficar fora do informe da página do projeto.
-- Gravado ao contrário (report_excluded) para que as tarefas que já existem entrem sem preencher nada.
ALTER TABLE "tasks" ADD COLUMN "report_excluded" boolean NOT NULL DEFAULT false;
