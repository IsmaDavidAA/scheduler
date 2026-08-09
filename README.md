# Scheduler

Aplicación independiente para coordinar circuitos de evaluación: Medicina, Nutrición, Fisioterapia y Entrenamiento. Cada etapa dura 15 minutos. Entrenamiento inicia con 5 mesas de capacidad 2; las demás áreas, 8 mesas de capacidad 1.

## Preparación

1. Crea un proyecto en Supabase.
2. En SQL Editor, ejecuta `supabase/schema.sql`.
3. Crea los usuarios operadores en **Authentication > Users**.
4. Copia `.env.example` a `.env.local` y agrega la URL y publishable key de Supabase.
5. Ejecuta `npm install` y `npm run dev`.

Las políticas iniciales permiten a cualquier usuario autenticado operar el cronograma. Para separar permisos por evento u organización, endurecer las políticas RLS antes de abrir el sistema a un grupo amplio.

## GitHub Pages

El workflow `.github/workflows/deploy-pages.yml` publica la rama `main`. En el repositorio de GitHub:

1. Habilita **Settings > Pages > GitHub Actions**.
2. Crea los secrets `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Haz push a `main`.

El workflow calcula automáticamente la ruta base desde el nombre del repositorio.

## Notas operativas

- La importación admite datos pegados desde Excel: `Grupo`, `Nombre`, `Horario estimado`, `Fin estimado`.
- Un nombre vacío queda registrado como cupo pendiente.
- Las mesas pueden activarse o desactivarse desde la vista de cada área.
- Cada operación se guarda en Supabase; no depende de Forgex ni de su backend.
