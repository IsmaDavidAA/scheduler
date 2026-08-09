create type public.schedule_area as enum ('medicina', 'nutricion', 'fisioterapia', 'entrenamiento');
create type public.schedule_stage_status as enum ('planeada', 'en_curso', 'completada');

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  operational_date date not null,
  created_at timestamptz not null default now()
);

create table public.schedule_tables (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  area public.schedule_area not null,
  number integer not null check (number > 0),
  capacity integer not null default 1 check (capacity > 0),
  active boolean not null default true,
  unique (schedule_id, area, number)
);

create table public.schedule_participants (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  group_name text not null,
  name text not null default '',
  starts_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.schedule_stages (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  participant_id uuid not null references public.schedule_participants(id) on delete cascade,
  area public.schedule_area not null,
  area_order smallint not null check (area_order between 1 and 4),
  planned_at timestamptz not null,
  estimated_start_at timestamptz not null,
  estimated_end_at timestamptz not null,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  table_number integer not null check (table_number > 0),
  status public.schedule_stage_status not null default 'planeada',
  reassignment_reason text,
  unique (participant_id, area)
);

create index schedule_stages_assignment_idx on public.schedule_stages (schedule_id, area, table_number);

alter table public.schedules enable row level security;
alter table public.schedule_tables enable row level security;
alter table public.schedule_participants enable row level security;
alter table public.schedule_stages enable row level security;

create policy "Authenticated scheduler access" on public.schedules for all to authenticated using (true) with check (true);
create policy "Authenticated scheduler access" on public.schedule_tables for all to authenticated using (true) with check (true);
create policy "Authenticated scheduler access" on public.schedule_participants for all to authenticated using (true) with check (true);
create policy "Authenticated scheduler access" on public.schedule_stages for all to authenticated using (true) with check (true);

alter publication supabase_realtime add table public.schedules, public.schedule_tables, public.schedule_participants, public.schedule_stages;
