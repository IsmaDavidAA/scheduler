import { useEffect, useMemo, useState } from 'react'
import { areas, loadPublicBoard, supabase, type Area, type PublicStage, type PublicTable } from './lib/scheduler'

const labels: Record<Area, string> = { medicina: 'Medicina', nutricion: 'Nutrición', fisioterapia: 'Fisioterapia', entrenamiento: 'Entrenamiento' }
const time = (value: string) => new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
const delay = (stage: PublicStage) => Math.max(0, Math.round((+new Date(stage.actual_start_at ?? stage.estimated_start_at) - +new Date(stage.planned_at)) / 60_000))
const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

export default function PublicBoard() {
  const [stages, setStages] = useState<PublicStage[]>([])
  const [tables, setTables] = useState<PublicTable[]>([])
  const [scheduleId, setScheduleId] = useState('')
  const [area, setArea] = useState<Area>('medicina')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')
  const refresh = async () => {
    try {
      const data = await loadPublicBoard()
      setStages(data.stages); setTables(data.tables)
      if (!scheduleId && data.stages[0]) setScheduleId(data.stages[0].schedule_id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'El tablero no está disponible.') }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const channel = client.channel('public-schedule-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_stages' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_tables' }, () => void refresh())
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [scheduleId])
  const schedules = useMemo(() => [...new Map(stages.map((stage) => [stage.schedule_id, { id: stage.schedule_id, name: stage.schedule_name, date: stage.operational_date }])).values()], [stages])
  const visible = useMemo(() => {
    const query = normalize(search)
    return stages.filter((stage) => stage.schedule_id === scheduleId && stage.area === area && (!query || normalize(`${stage.group_name} ${stage.participant_name}`).includes(query)))
  }, [stages, scheduleId, area, search])
  const pageCount = Math.max(1, Math.ceil(visible.length / 20))
  const pagedVisible = visible.slice(page * 20, page * 20 + 20)
  const areaTables = tables.filter((table) => table.schedule_id === scheduleId && table.area === area)
  const inProgress = visible.filter((stage) => stage.status === 'en_curso')
  const waiting = visible.filter((stage) => stage.status === 'planeada' && +new Date(stage.estimated_start_at) <= Date.now())
  const delayed = visible.filter((stage) => delay(stage) > 0)
  const freeTables = areaTables.filter((table) => table.active && inProgress.filter((stage) => stage.table_number === table.number).length < table.capacity)
  if (!supabase) return <main className="public-board"><h1>Horario en vivo</h1><p>El tablero público aún no está configurado.</p></main>
  return <main className="public-board">
    <header><div><p className="eyebrow">HORARIO EN VIVO</p><h1>Tu circuito de evaluación</h1><p className="public-note">Busca por nombre o código de grupo.</p></div><a href="#">Acceso coordinadores</a></header>
    {error && <p className="error">{error}</p>}
    <section className="public-controls"><select value={scheduleId} onChange={(event) => { setScheduleId(event.target.value); setPage(0) }}>{schedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.name} · {schedule.date}</option>)}</select><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} placeholder="Buscar nombre o grupo, ej. Vanessa / G4-2" /></section>
    <div className="area-tabs">{areas.map((item) => <button key={item} className={area === item ? 'selected' : 'secondary'} onClick={() => { setArea(item); setPage(0) }}>{labels[item]}</button>)}</div>
    <section className="public-summary"><div><strong>{inProgress.length}</strong><span>en atención</span></div><div><strong>{waiting.length}</strong><span>esperando</span></div><div><strong>{delayed.length}</strong><span>con retraso</span></div><div><strong>{freeTables.length}</strong><span>mesas libres</span></div></section>
    <section className="public-list"><h2>{labels[area]}</h2>{pagedVisible.map((stage) => <article key={stage.stage_id} className={stage.status === 'en_curso' ? 'current' : delay(stage) ? 'late' : ''}><time>{time(stage.actual_start_at ?? stage.estimated_start_at)}</time><div><strong>{stage.participant_name}</strong><span>{stage.group_name} · Mesa {stage.table_number}{delay(stage) ? ` · +${delay(stage)} min` : ''}</span></div><em>{stage.status === 'en_curso' ? 'En atención' : delay(stage) ? 'Con retraso' : +new Date(stage.estimated_start_at) <= Date.now() ? 'Esperando' : 'Próximo'}</em></article>)}{!visible.length && <p>No hay turnos para mostrar.</p>}<div className="pagination"><button className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page + 1} de {pageCount} · {visible.length} registros</span><button disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>Siguiente</button></div></section>
  </main>
}
