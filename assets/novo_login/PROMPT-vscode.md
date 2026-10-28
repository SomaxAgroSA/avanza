# Prompt para VS Code (Copilot / Claude / Cursor)

Copia la carpeta `avanza-identidad/` en la raíz del proyecto y pega este prompt en el chat del agente:

---

Aplica la nueva identidad visual de **Avanza** (plataforma de gestión de proyectos de SomaxAgro) en este proyecto. El objetivo es reemplazar la paleta violeta/azul actual por la paleta verde de Somax y el logo nuevo, **sin cambiar la lógica, los textos ni la estructura de las pantallas**.

## Archivos de referencia (en `avanza-identidad/`)
- `avanza-tokens.css`: tokens de color para tema claro y oscuro. Úsalo como fuente única de colores.
- `logo/avanza-logo-claro.svg` y `logo/avanza-logo-oscuro.svg`: logo completo (símbolo + AVANZA).
- `logo/avanza-simbolo-claro.svg` y `logo/avanza-simbolo-oscuro.svg`: solo el símbolo (5 líneas de progreso).
- `logo/avanza-app-icon.svg` y `logo/favicon.svg`: ícono de app y favicon.
- `login-portada.html`: pantalla de login completa (portada + formulario) en HTML/CSS listo, con tema claro y oscuro. **Úsala como referencia exacta** para la pantalla de login: copia su estructura y estilos al componente de login del proyecto, adaptados al framework.
- `referencia-montaje.html`: maqueta visual de cómo deben verse el login y el dashboard (ábrela en el navegador, sección "Montaje en la plataforma").

## Pasos
1. **Detecta el stack de estilos** (Tailwind, CSS Modules, variables CSS, MUI, shadcn/ui, etc.) y dónde se definen el color primario y el tema oscuro.
2. **Integra los tokens** de `avanza-tokens.css`:
   - Si hay variables CSS globales, reemplaza los valores del primario/acento por los tokens.
   - Si es Tailwind, mapea `primary`, `accent`, `background`, `foreground`, `muted`, `border` en `tailwind.config` a esas variables.
   - Si es shadcn/ui, actualiza `--primary`, `--ring`, `--accent`, etc. en `globals.css` (convierte a HSL si el proyecto lo usa).
   - El tema oscuro debe usar los valores de `.dark` / `[data-theme="dark"]`. Respeta el mecanismo de tema que ya exista.
3. **Reemplaza el logo actual** (el ícono de cuadritos de colores):
   - Sidebar y header: símbolo `avanza-simbolo-claro.svg` dentro de un cuadro de 34px con borde sutil, más el texto "Avanza". En oscuro, `avanza-simbolo-oscuro.svg`.
   - Login (panel izquierdo): símbolo oscuro en un cuadro de 42px con fondo `rgba(255,255,255,.1)`.
   - Favicon: `favicon.svg`. Ícono PWA o manifest: `avanza-app-icon.svg`.
   - Copia los SVG a la carpeta de assets públicos del proyecto (`public/` o equivalente).
4. **Pantalla de login**:
   - Panel izquierdo: fondo `var(--login-gradient)` en lugar del degradé violeta. Mantén la trama de puntos blancos al 13% de opacidad.
   - Botón "Entrar": `var(--primary)` con texto blanco. Enlace "Olvidé mi contraseña": `var(--primary-text)`.
   - Aviso "Cerró sesión de forma segura": fondo `var(--primary-tint)`, borde `var(--primary-border)`, texto `var(--primary-text)`.
5. **Dashboard y layout**:
   - Ítem activo del menú: fondo `var(--primary-tint)`, texto e ícono `var(--primary-text)`, peso 600.
   - Tarjeta de bienvenida: fondo `var(--hero-gradient)`, etiqueta "Admin" en `var(--primary-text)`. Opcional: símbolo del logo grande (120px) alineado a la derecha.
   - Enlaces "Ver informes" y "Ver todos", íconos de Acceso rápido (fondo `var(--primary-tint)`, ícono `var(--primary-text)`) y avatar del usuario: verde.
   - Gráficos: barras en `var(--brand-primary)` y la barra destacada o actual en `var(--brand-accent)`.
   - Estados: "En curso" en verde, "En riesgo" en `var(--warning)` y errores en `var(--danger)`.
6. **Busca y elimina colores hardcodeados** violetas, índigo o azules (`#4f46e5`, `#6366f1`, `indigo-*`, `violet-*`, `purple-*`, `blue-6xx`, etc.) y reemplázalos por los tokens.
7. **Verifica** que el login y el dashboard se vean bien en tema claro y oscuro, que el contraste de texto sea AA y que el build no tenga errores. Al final, resume los archivos que modificaste.

No modifiques textos, rutas, lógica de autenticación ni llamadas a la API.

---

**Nota:** los verdes de `avanza-tokens.css` son provisorios. Cuando tengas los hex oficiales de Somax, cambia solo `--brand-primary`, `--brand-accent` y `--brand-ink`. En los SVG, reemplaza `#00843D`, `#8DC63F` y `#1E2B24` con buscar y reemplazar.
