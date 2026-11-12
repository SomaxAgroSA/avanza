-- Enlace de acceso a la plataforma desarrollada (regras §24): aparece arriba del proyecto como
-- "Abrir plataforma". Opcional; los proyectos que ya existen quedan sin enlace.
ALTER TABLE "projects" ADD COLUMN "platform_url" text NOT NULL DEFAULT '';
