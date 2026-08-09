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

function selectTable(area: Area, desired: Date, tables: ScheduleTable[], stages: Stage[], preferred?: number, excludedStageId?: string) {
  const candidates = tables.filter((table) => table.area === area && table.active).map((table) => {
    const end = addMinutes(desired, 15)
    const overlapping = stages.filter((stage) =>
      stage.id !== excludedStageId && stage.area === area && stage.table_number === table.number && stage.status !== 'completada' &&
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

export function availableTableNumbers(stage: Stage, tables: ScheduleTable[], stages: Stage[]) {
  const start = new Date(stage.estimated_start_at)
  const end = new Date(stage.estimated_end_at)
  return tables
    .filter((table) => table.area === stage.area && table.active)
    .filter((table) => stages.filter((item) =>
      item.id !== stage.id && item.area === stage.area && item.table_number === table.number &&
      item.status === 'en_curso' && new Date(item.estimated_start_at) < end && new Date(item.estimated_end_at) > start,
    ).length < table.capacity)
    .map((table) => table.number)
}

export async function reassignStage(stage: Stage, tableNumber: number, tables: ScheduleTable[], stages: Stage[]) {
  if (!availableTableNumbers(stage, tables, stages).includes(tableNumber)) {
    throw new Error('La mesa elegida ya no tiene capacidad para este horario.')
  }
  const client = assertClient()
  const downstream = areas
    .slice(stage.area_order)
    .map((area) => stages.find((item) => item.participant_id === stage.participant_id && item.area === area))
    .filter((item): item is Stage => Boolean(item))
  const reassigned = new Map<string, Partial<Stage>>()
  reassigned.set(stage.id, { table_number: tableNumber, reassignment_reason: 'Reasignación operativa manual' })
  let preferred = tableNumber
  let nextStart = new Date(stage.estimated_end_at)
  const fixedStages = stages.filter((item) => !downstream.some((next) => next.id === item.id))
  for (const next of downstream) {
    const selection = selectTable(next.area, nextStart, tables, [...fixedStages, ...Array.from(reassigned.entries()).flatMap(([id, values]) => {
      const original = stages.find((item) => item.id === id)
      return original ? [{ ...original, ...values } as Stage] : []
    })], preferred, next.id)
    const end = addMinutes(selection.start, 15)
    reassigned.set(next.id, {
      table_number: selection.number,
      estimated_start_at: iso(selection.start),
      estimated_end_at: iso(end),
      reassignment_reason: preferred !== selection.number ? 'Mesa preferida sin capacidad disponible' : 'Continuidad tras reasignación operativa',
    })
    preferred = selection.number
    nextStart = end
  }
  await Promise.all(Array.from(reassigned.entries()).map(async ([id, values]) => {
    const { error } = await client.from('schedule_stages').update(values).eq('id', id)
    if (error) throw error
  }))
}

export async function moveParticipantToGroup(
  medicineStage: Stage,
  targetGroup: string,
  targetStart: string,
  tables: ScheduleTable[],
  stages: Stage[],
) {
  const client = assertClient()
  if (medicineStage.status !== 'planeada') {
    throw new Error('Solo se puede cambiar de grupo antes de iniciar la atención de Medicina.')
  }
  const targetVacancy = stages.find((stage) =>
    stage.area === 'medicina' &&
    stage.planned_at === targetStart &&
    stage.participant?.group_name.split('-')[0] === targetGroup &&
    !stage.participant?.name.trim(),
  )
  if (targetVacancy?.participant && medicineStage.participant) {
    const { error: fillError } = await client
      .from('schedule_participants')
      .update({ name: medicineStage.participant.name })
      .eq('id', targetVacancy.participant_id)
    if (fillError) throw fillError
    const { error: removeError } = await client
      .from('schedule_participants')
      .delete()
      .eq('id', medicineStage.participant_id)
    if (removeError) throw removeError
    return
  }
  const participantStages = stages.filter((stage) => stage.participant_id === medicineStage.participant_id)
  const otherStages = stages.filter((stage) =>
    stage.participant_id !== medicineStage.participant_id && Boolean(stage.participant?.name.trim()),
  )
  const start = new Date(targetStart)
  const medicine = selectTable('medicina', start, tables, otherStages)
  if (+medicine.start !== +start) throw new Error('Ese grupo ya no tiene una mesa disponible en Medicina.')

  const updated = new Map<string, Partial<Stage>>()
  const medicineEnd = addMinutes(start, 15)
  updated.set(medicineStage.id, {
    planned_at: iso(start),
    estimated_start_at: iso(start),
    estimated_end_at: iso(medicineEnd),
    table_number: medicine.number,
    reassignment_reason: `Traslado al grupo ${targetGroup}`,
  })
  let nextStart = medicineEnd
  let preferred = medicine.number
  for (const area of areas.slice(1)) {
    const stage = participantStages.find((item) => item.area === area)
    if (!stage) continue
    const selection = selectTable(area, nextStart, tables, [...otherStages, ...Array.from(updated.entries()).flatMap(([id, values]) => {
      const original = participantStages.find((item) => item.id === id)
      return original ? [{ ...original, ...values } as Stage] : []
    })], preferred, stage.id)
    const end = addMinutes(selection.start, 15)
    updated.set(stage.id, {
      planned_at: iso(nextStart),
      estimated_start_at: iso(selection.start),
      estimated_end_at: iso(end),
      table_number: selection.number,
      reassignment_reason: preferred === selection.number ? `Continuidad desde ${targetGroup}` : 'Mesa preferida sin capacidad disponible',
    })
    nextStart = end
    preferred = selection.number
  }
  const suffix = medicineStage.participant?.group_name?.match(/-(.+)$/)?.[1] ?? String(medicine.number)
  const { error: participantError } = await client
    .from('schedule_participants')
    .update({ group_name: `${targetGroup}-${suffix}`, starts_at: iso(start) })
    .eq('id', medicineStage.participant_id)
  if (participantError) throw participantError
  await Promise.all(Array.from(updated.entries()).map(async ([id, values]) => {
    const { error } = await client.from('schedule_stages').update(values).eq('id', id)
    if (error) throw error
  }))
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
