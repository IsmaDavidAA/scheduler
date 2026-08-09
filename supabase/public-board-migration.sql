-- Ejecutar una vez para habilitar el tablero público sin exponer nombres de participantes.
create or replace view public.public_schedule_stages as
select
  s.id as schedule_id,
  s.name as schedule_name,
  s.operational_date,
  e.id as stage_id,
  e.area,
  e.area_order,
  p.group_name,
  p.name as participant_name,
  e.planned_at,
  e.estimated_start_at,
  e.estimated_end_at,
  e.actual_start_at,
  e.actual_end_at,
  e.table_number,
  e.status
from public.schedules s
join public.schedule_stages e on e.schedule_id = s.id
join public.schedule_participants p on p.id = e.participant_id
where p.name <> '';

create or replace view public.public_schedule_tables as
select schedule_id, area, number, capacity, active
from public.schedule_tables;

grant select on public.public_schedule_stages, public.public_schedule_tables to anon, authenticated;
grant select on public.schedule_stages, public.schedule_tables to anon;
create policy "Public board stage read" on public.schedule_stages for select to anon using (true);
create policy "Public board table read" on public.schedule_tables for select to anon using (true);
