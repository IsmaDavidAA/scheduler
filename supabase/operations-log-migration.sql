-- Ejecutar una vez en proyectos Scheduler ya creados.
create table if not exists public.schedule_operation_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  participant_id uuid references public.schedule_participants(id) on delete set null,
  stage_id uuid references public.schedule_stages(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists schedule_operation_logs_schedule_idx
  on public.schedule_operation_logs (schedule_id, created_at desc);

alter table public.schedule_operation_logs enable row level security;
grant select, insert on public.schedule_operation_logs to authenticated;
create policy "Authenticated scheduler access" on public.schedule_operation_logs
  for all to authenticated using (true) with check (true);

alter publication supabase_realtime add table public.schedule_operation_logs;
