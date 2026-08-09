import { createClient } from '@supabase/supabase-js'

export const areas = ['medicina', 'nutricion', 'fisioterapia', 'entrenamiento'] as const
export type Area = (typeof areas)[number]
export type StageStatus = 'planeada' | 'en_curso' | 'completada'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
export const supabase = url && key ? createClient(url, key) : null

export type Schedule = { id: string; name: string; operational_date: string; created_at: string }
export type ScheduleTable = { id: string; schedule_id: string; area: Area; number: number; capacity: number; active: boolean }
export type Participant = { id: string; schedule_id: string; group_name: string; name: string; starts_at: string }
export type Stage = {
  id: string; schedule_id: string; participant_id: string; area: Area; area_order: number;
  planned_at: string; estimated_start_at: string; estimated_end_at: string; actual_start_at: string | null;
  actual_end_at: string | null; table_number: number; status: StageStatus; reassignment_reason: string | null;
  participant?: Participant
}

const assertClient = () => {
  if (!supabase) throw new Error('Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en .env.local.')
  return supabase
}
const iso = (date: Date) => date.toISOString()
const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000)

export async function listSchedules() {
  const { data, error } = await assertClient().from('schedules').select('*').order('operational_date', { ascending: false })
  if (error) throw error
  return data as Schedule[]
}

export async function loadSchedule(id: string) {
  const client = assertClient()
  const [tables, participants, stages] = await Promise.all([
    client.from('schedule_tables').select('*').eq('schedule_id', id).order('area').order('number'),
    client.from('schedule_participants').select('*').eq('schedule_id', id).order('starts_at'),
    client.from('schedule_stages').select('*, participant:schedule_participants(*)').eq('schedule_id', id).order('estimated_start_at'),
  ])
  for (const response of [tables, participants, stages]) if (response.error) throw response.error
  return { tables: tables.data as ScheduleTable[], participants: participants.data as Participant[], stages: stages.data as Stage[] }
}

export async function createSchedule(name: string, operationalDate: string) {
  const client = assertClient()
  const { data, error } = await client.from('schedules').insert({ name, operational_date: operationalDate }).select().single()
  if (error) throw error
  const defaultTables = areas.flatMap((area) => Array.from(
    { length: area === 'entrenamiento' ? 5 : 8 },
    (_, index) => ({ schedule_id: data.id, area, number: index + 1, capacity: area === 'entrenamiento' ? 2 : 1 }),
  ))
  const tables = await client.from('schedule_tables').insert(defaultTables)
  if (tables.error) throw tables.error
  return data as Schedule
}

export type RosterEntry = { group_name: string; name: string; starts_at: string }

function selectTable(area: Area, desired: Date, tables: ScheduleTable[], stages: Stage[], preferred?: number) {
  const candidates = tables.filter((table) => table.area === area && table.active).map((table) => {
    const end = addMinutes(desired, 15)
    const overlapping = stages.filter((stage) =>
      stage.area === area && stage.table_number === table.number && stage.status !== 'completada' &&
      new Date(stage.estimated_start_at) < end && new Date(stage.estimated_end_at) > desired,
    )
    const free = overlapping.length < table.capacity
    const ready = free ? desired : new Date(Math.min(...overlapping.map((stage) => +new Date(stage.estimated_end_at))))
    return { table, free, ready, load: stages.filter((stage) => stage.area === area && stage.table_number === table.number).length }
  })
  const preferredCandidate = candidates.find((candidate) => candidate.table.number === preferred && candidate.free)
  const selected = preferredCandidate ?? candidates.sort((a, b) => +a.ready - +b.ready || a.load - b.load || a.table.number - b.table.number)[0]
  if (!selected) throw new Error(`No hay mesas activas para ${area}.`)
  return { number: selected.table.number, start: selected.free ? desired : selected.ready }
}

export async function importRoster(scheduleId: string, entries: RosterEntry | RosterEntry[], tables: ScheduleTable[], existingStages: Stage[]) {
  const client = assertClient()
  const rows = Array.isArray(entries) ? entries : [entries]
  const { data: participants, error } = await client.from('schedule_participants').insert(rows.map((row) => ({ ...row, schedule_id: scheduleId }))).select()
  if (error) throw error
  const planned: Omit<Stage, 'id' | 'participant'>[] = []
  for (const participant of participants as Participant[]) {
    let start = new Date(participant.starts_at)
    let preferred: number | undefined
    for (const [index, area] of areas.entries()) {
      const selected = selectTable(area, start, tables, [...existingStages, ...planned] as Stage[], preferred)
      const end = addMinutes(selected.start, 15)
      planned.push({
        schedule_id: scheduleId, participant_id: participant.id, area, area_order: index + 1,
        planned_at: iso(start), estimated_start_at: iso(selected.start), estimated_end_at: iso(end),
        actual_start_at: null, actual_end_at: null, table_number: selected.number, status: 'planeada',
        reassignment_reason: preferred && preferred !== selected.number ? 'Mesa previa sin capacidad disponible' : null,
      })
      start = end
      preferred = selected.number
    }
  }
  const stages = await client.from('schedule_stages').insert(planned)
  if (stages.error) throw stages.error
}

export async function updateStage(stage: Stage, status: StageStatus) {
  const now = iso(new Date())
  const changes = status === 'en_curso'
    ? { status, actual_start_at: stage.actual_start_at ?? now }
    : { status, actual_start_at: stage.actual_start_at ?? now, actual_end_at: now }
  const { error } = await assertClient().from('schedule_stages').update(changes).eq('id', stage.id)
  if (error) throw error
}

export async function setTableActive(table: ScheduleTable) {
  const { error } = await assertClient().from('schedule_tables').update({ active: !table.active }).eq('id', table.id)
  if (error) throw error
}

export async function signIn(email: string, password: string) {
  const { error } = await assertClient().auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut() { await assertClient().auth.signOut() }
