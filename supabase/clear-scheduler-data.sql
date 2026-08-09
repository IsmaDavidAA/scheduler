-- DESTRUCTIVO: borra jornadas, participantes, mesas, etapas y logs del Scheduler.
-- NO elimina usuarios ni credenciales de Supabase Auth (auth.users).
truncate table public.schedules cascade;
