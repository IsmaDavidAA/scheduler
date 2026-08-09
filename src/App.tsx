import { useEffect, useMemo, useState } from 'react'
import './App.css'
import PublicBoard from './PublicBoard'
import {
  addParticipantToGroup, areas, availableTableNumbers, createSchedule, importRoster, listSchedules, loadSchedule, moveParticipantToGroup, reassignStage, removeParticipant, setTableActive, signIn, signOut, supabase, updateStage,
  type Area, type Schedule, type ScheduleTable, type Stage,
} from './lib/scheduler'

const labels: Record<Area, string> = { medicina: 'Medicina', nutricion: 'Nutrición', fisioterapia: 'Fisioterapia', entrenamiento: 'Entrenamiento' }
const time = (value: string) => new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

function parseRoster(text: string, date: string) {
  return text.split(/\r?\n/).flatMap((line) => {
    const cells = line.split('\t').map((cell) => cell.trim())
    const match = cells[2]?.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i)
    if (!cells[0] || /^grupo$/i.test(cells[0]) || !match) return []
    let hour = Number(match[1])
    if (match[3]?.toUpperCase() === 'AM' && hour === 12) hour = 0
    if (match[3]?.toUpperCase() === 'PM' && hour < 12) hour += 12
    return [{ group_name: cells[0], name: cells[1] ?? '', starts_at: new Date(`${date}T${String(hour).padStart(2, '0')}:${match[2]}:00-04:00`).toISOString() }]
  })
}

function App() {
  const [session, setSession] = useState(false)
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [controllers, setControllers] = useState<string[]>([])
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [schedules, setSchedules] = useState<Schedule[]>([]); const [current, setCurrent] = useState<Schedule | null>(null)
  const [tables, setTables] = useState<ScheduleTable[]>([]); const [stages, setStages] = useState<Stage[]>([])
  const [activeArea, setActiveArea] = useState<Area>('medicina')
  const [name, setName] = useState('Jornada de evaluaciones'); const [date, setDate] = useState(''); const [roster, setRoster] = useState('')
  const [newPatientName, setNewPatientName] = useState(''); const [newPatientGroup, setNewPatientGroup] = useState('')
  const [participantSearch, setParticipantSearch] = useState('')
  const [page, setPage] = useState(0)
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const refreshSchedules = async () => setSchedules(await listSchedules())
  const selectSchedule = async (schedule: Schedule) => { setCurrent(schedule); const detail = await loadSchedule(schedule.id); setTables(detail.tables); setStages(detail.stages) }
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Operación no disponible') } finally { setBusy(false) } }
  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => {
      setSession(Boolean(data.session))
      setUser(data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(Boolean(next))
      setUser(next?.user ? { id: next.user.id, email: next.user.email } : null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])
  useEffect(() => { if (session) void refreshSchedules() }, [session])
  useEffect(() => {
    if (!supabase || !current || !user) return
    const client = supabase
    const channel = client
      .channel(`schedule:${current.id}`, { config: { presence: { key: user.id } } })
      .on('presence', { event: 'sync' }, () => {
        const present = Object.values(channel.presenceState())
          .flat()
          .map((presence) => String((presence as { email?: string }).email ?? 'Operador'))
        setControllers([...new Set(present)])
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_tables', filter: `schedule_id=eq.${current.id}` }, () => void selectSchedule(current))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_participants', filter: `schedule_id=eq.${current.id}` }, () => void selectSchedule(current))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_stages', filter: `schedule_id=eq.${current.id}` }, () => void selectSchedule(current))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void channel.track({ email: user.email ?? 'Operador' })
      })
    return () => {
      setControllers([])
      void client.removeChannel(channel)
    }
  }, [current?.id, user?.id])
  const byArea = useMemo(() => Object.fromEntries(areas.map((area) => [area, stages.filter((stage) => stage.area === area).sort((a, b) => +new Date(a.estimated_start_at) - +new Date(b.estimated_start_at))])) as Record<Area, Stage[]>, [stages])
  const groupBlocks = useMemo(() => {
    const blocks = new Map<string, { group: string; start: string }>()
    stages.filter((stage) => stage.area === 'medicina' && stage.participant).forEach((stage) => {
      const group = stage.participant!.group_name.split('-')[0]
      blocks.set(`${group}|${stage.planned_at}`, { group, start: stage.planned_at })
    })
    return [...blocks.values()]
  }, [stages])
  const availableGroupBlocks = (stage: Stage) => {
    const capacity = tables.filter((table) => table.area === 'medicina' && table.active).reduce((total, table) => total + table.capacity, 0)
    return groupBlocks.flatMap((block) => {
      if (block.start === stage.planned_at) return []
      const assigned = stages.filter((item) => item.id !== stage.id && item.area === 'medicina' && item.planned_at === block.start && item.status !== 'completada' && Boolean(item.participant?.name.trim())).length
      const slots = capacity - assigned
      return slots > 0 ? [{ ...block, slots }] : []
    })
  }
  const availableNewPatientGroups = useMemo(() => {
    const capacity = tables.filter((table) => table.area === 'medicina' && table.active).reduce((total, table) => total + table.capacity, 0)
    return groupBlocks.flatMap((block) => {
      const assigned = stages.filter((item) => item.area === 'medicina' && item.planned_at === block.start && item.status !== 'completada' && Boolean(item.participant?.name.trim())).length
      const slots = capacity - assigned
      return slots > 0 ? [{ ...block, slots }] : []
    })
  }, [groupBlocks, stages, tables])
  const tableState = (table: ScheduleTable) => {
    if (!table.active) return { label: 'bloqueada', className: 'table blocked' }
    const attending = stages.filter((stage) => stage.area === table.area && stage.table_number === table.number && stage.status === 'en_curso')
    if (attending.length) {
      const delay = Math.max(...attending.map((stage) => Math.max(0, Math.round((+new Date(stage.actual_start_at ?? stage.estimated_start_at) - +new Date(stage.planned_at)) / 60_000))))
      return { label: `ocupada ${attending.length}/${table.capacity}${delay ? ` · +${delay}` : ''}`, className: 'table occupied' }
    }
    return { label: 'libre', className: 'table free' }
  }
  const delayMinutes = (stage: Stage) => Math.max(0, Math.round((+new Date(stage.actual_start_at ?? stage.estimated_start_at) - +new Date(stage.planned_at)) / 60_000))
  const areaStages = byArea[activeArea].filter((stage) => {
    const query = normalize(participantSearch)
    return !query || normalize(`${stage.participant?.name ?? ''} ${stage.participant?.group_name ?? ''}`).includes(query)
  })
  const pageCount = Math.max(1, Math.ceil(areaStages.length / 20))
  const pagedAreaStages = areaStages.slice(page * 20, page * 20 + 20)

  if (window.location.hash === '#public') return <PublicBoard />
  if (!supabase) return <main className="setup"><h1>Scheduler</h1><p>Falta Supabase.</p><code>Copia .env.example a .env.local y completa las variables.</code></main>
  if (!session) return <main className="login"><h1>Scheduler</h1><p>Ingresa con un usuario autorizado de Supabase.</p><input placeholder="Correo" value={email} onChange={(event) => setEmail(event.target.value)} /><input placeholder="Contraseña" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /><button disabled={busy} onClick={() => void run(() => signIn(email, password))}>Ingresar</button><a href="#public">Ver horario público</a>{error && <p className="error">{error}</p>}</main>
  return <main>
    <header><div><p className="eyebrow">OPERACIÓN EN VIVO</p><h1>Scheduler</h1></div><button className="secondary" onClick={() => void signOut()}>Salir</button></header>
    {error && <p className="error">{error}</p>}
    <section className="intro"><strong>Circuito de 60 minutos</strong><span>Medicina → Nutrición → Fisioterapia → Entrenamiento · 15 min por área · Entrenamiento: 5 mesas × 2 pacientes.</span></section>
    <section className="new-schedule"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre de la jornada" /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /><button disabled={busy || !date || !name.trim()} onClick={() => void run(async () => { const next = await createSchedule(name, date); await refreshSchedules(); await selectSchedule(next) })}>Crear jornada</button></section>
    <nav>{schedules.map((schedule) => <button key={schedule.id} className={current?.id === schedule.id ? 'selected' : 'secondary'} onClick={() => void run(() => selectSchedule(schedule))}>{schedule.name} · {schedule.operational_date}</button>)}</nav>
    {current && <><section className="controllers"><strong>Controladores conectados: {controllers.length}</strong><span>{controllers.length ? controllers.join(' · ') : 'Conectando…'}</span><p>Los cambios de mesas, importaciones y etapas se actualizan automáticamente para todos los operadores de esta jornada.</p></section><section className="import"><h2>Importar lista</h2><p>Pega: Grupo, Nombre, Horario estimado, Fin estimado. Se aceptan cupos sin nombre.</p><textarea value={roster} onChange={(event) => setRoster(event.target.value)} placeholder={'G1-1\tNombre Apellido\t09:00 AM\t10:00 AM'} /><button disabled={busy} onClick={() => void run(async () => { const entries = parseRoster(roster, current.operational_date); if (!entries.length) throw new Error('No se encontraron filas válidas.'); await importRoster(current.id, entries, tables, stages); setRoster(''); await selectSchedule(current) })}>Importar {parseRoster(roster, current.operational_date).length || ''} participantes</button></section>
      <section className="add-patient"><h2>Agregar paciente</h2><input value={newPatientName} onChange={(event) => setNewPatientName(event.target.value)} placeholder="Nombre completo" /><select value={newPatientGroup} onChange={(event) => setNewPatientGroup(event.target.value)}><option value="">Elegir grupo con cupo…</option>{availableNewPatientGroups.map((block) => <option key={`${block.group}|${block.start}`} value={`${block.group}|${block.start}`}>{block.group} · {time(block.start)} · {block.slots} cupo{block.slots === 1 ? '' : 's'}</option>)}</select><button disabled={busy || !newPatientName.trim() || !newPatientGroup} onClick={() => void run(async () => { const block = availableNewPatientGroups.find((item) => `${item.group}|${item.start}` === newPatientGroup); if (!block) throw new Error('El grupo elegido ya no tiene cupo.'); await addParticipantToGroup(current.id, newPatientName.trim(), block.group, block.start, tables, stages); setNewPatientName(''); setNewPatientGroup(''); await selectSchedule(current) })}>Agregar</button></section>
      <div className="area-tabs">{areas.map((area) => <button key={area} className={activeArea === area ? 'selected' : 'secondary'} onClick={() => { setActiveArea(area); setPage(0) }}>{labels[area]}</button>)}</div>
      <section className="area"><div className="area-head"><div><h2>{labels[activeArea]}</h2><p>{tables.filter((table) => table.area === activeArea).length} mesas · capacidad {tables.filter((table) => table.area === activeArea && table.active).reduce((sum, table) => sum + table.capacity, 0)}</p></div><div className="tables">{tables.filter((table) => table.area === activeArea).map((table) => { const state = tableState(table); return <button className={state.className} key={table.id} onClick={() => void run(async () => { await setTableActive(table); await selectSchedule(current) })}>M{table.number} · {state.label}</button> })}</div></div><input className="participant-search" value={participantSearch} onChange={(event) => { setParticipantSearch(event.target.value); setPage(0) }} placeholder="Buscar por nombre o grupo…" /><div className="stage-list">{pagedAreaStages.map((stage) => <article key={stage.id}><time>{time(stage.estimated_start_at)}–{time(stage.estimated_end_at)}</time><div><strong>{stage.participant?.group_name}</strong><span>{stage.participant?.name || 'Cupo pendiente'} · Mesa {stage.table_number}{delayMinutes(stage) ? ` · +${delayMinutes(stage)} min` : ' · En hora'}</span></div><em>{stage.status.replace('_', ' ')}</em><select aria-label={`Mesa para ${stage.participant?.group_name ?? stage.id}`} value={stage.table_number} onChange={(event) => void run(async () => { await reassignStage(stage, Number(event.target.value), tables, stages); await selectSchedule(current) })}>{availableTableNumbers(stage, tables, stages).map((number) => <option key={number} value={number}>Mesa {number}</option>)}</select>{activeArea === 'medicina' && <select aria-label={`Mover ${stage.participant?.name ?? 'participante'} a grupo`} value="" disabled={!stage.participant?.name.trim() || stage.status !== 'planeada'} onChange={(event) => { const block = availableGroupBlocks(stage).find((item) => `${item.group}|${item.start}` === event.target.value); if (block) void run(async () => { await moveParticipantToGroup(stage, block.group, block.start, tables, stages); await selectSchedule(current) }) }}><option value="">Mover a grupo…</option>{availableGroupBlocks(stage).map((block) => <option key={`${block.group}|${block.start}`} value={`${block.group}|${block.start}`}>{block.group} · {time(block.start)} · {block.slots} cupo{block.slots === 1 ? '' : 's'}</option>)}</select>}{activeArea === 'medicina' && stage.participant?.name.trim() && stage.status === 'planeada' && <button className="remove" onClick={() => void run(async () => { await removeParticipant(stage, stages); await selectSchedule(current) })}>Quitar</button>}{stage.status === 'planeada' && <button onClick={() => void run(async () => { await updateStage(stage, 'en_curso', tables, stages); await selectSchedule(current) })}>Iniciar</button>}{stage.status === 'en_curso' && <button onClick={() => void run(async () => { await updateStage(stage, 'completada', tables, stages); await selectSchedule(current) })}>Completar</button>}</article>)}</div><div className="pagination"><button className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page + 1} de {pageCount} · {areaStages.length} registros</span><button disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>Siguiente</button></div></section></>}
  </main>
}

export default App
