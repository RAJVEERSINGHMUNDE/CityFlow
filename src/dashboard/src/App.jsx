import { useState, useEffect, useRef } from 'react'

const API              = ''
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS  = 90_000
const MAX_POLL_ATTEMPTS = Math.ceil(POLL_TIMEOUT_MS / POLL_INTERVAL_MS)
const INITIAL_SCENARIO = {
  cause: 'Political Rally', latitude: '12.9716', longitude: '77.5946',
  event_type: 'planned', start_time: '2026-06-22T10:00', expected_attendance: '5000',
  expected_duration_hours: '4', closure_severity: 'full', requires_closure: true,
  roads_affected: 'Major approaches near the event location',
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
  } catch { return iso }
}

function fmtNum(n, decimals = 1) {
  if (n === null || n === undefined) return '—'
  return typeof n === 'number' ? n.toFixed(decimals) : n
}

function LevelBadge({ level }) {
  const styles = {
    Green: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    Red:   'bg-red-500/20    text-red-300    border-red-500/40',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${styles[level] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40'}`}>
      {level}
    </span>
  )
}

function SeverityBar({ score }) {
  const pct   = Math.min(100, (score / 10) * 100)
  const color = score >= 7 ? '#ef4444' : score >= 4 ? '#94a3b8' : '#22c55e'
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>Severity Score</span>
        <span className="font-mono text-slate-200">{fmtNum(score, 1)} / 10</span>
      </div>
      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  )
}

function MetricCard({ label, value, unit, sub }) {
  return (
    <div className="flex flex-col">
      <div className="text-xs text-slate-400 mb-0.5">{label}</div>
      <div className="text-xl font-mono text-slate-100">
        {value}
        {unit && <span className="text-sm font-sans text-slate-500 ml-1">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function TabBtn({ id, active, onClick, children }) {
  return (
    <button
      id={id}
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
        active
          ? 'border-blue-400 text-blue-300 bg-slate-800/60'
          : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
      }`}
    >
      {children}
    </button>
  )
}

function WelcomeBanner({ onDismiss }) {
  return (
    <div className="bg-blue-900/20 border border-blue-800/30 rounded-lg px-5 py-4 mb-3">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-blue-300">
            How this works
          </p>
          <ul className="text-xs text-blue-200/70 space-y-1 list-disc list-inside">
            <li>Pick an event from the list on the left — these are real planned and unplanned events from Bengaluru traffic records.</li>
            <li>The center panel shows a map of affected roads with recommended diversion routes.</li>
            <li>The right panel breaks down the predicted impact and what resources would be needed.</li>
          </ul>
        </div>
        <button onClick={onDismiss} className="text-blue-400/50 hover:text-blue-300 text-xs shrink-0 ml-4">Dismiss</button>
      </div>
    </div>
  )
}

export default function App() {
  const [events,          setEvents]          = useState([])
  const [eventsError,     setEventsError]     = useState('')
  const [selectedEvent,   setSelectedEvent]   = useState(null)
  const [severity,        setSeverity]        = useState(null)
  const [severityLoading, setSeverityLoading] = useState(false)
  const [simulation,      setSimulation]      = useState(null)
  const [simLoading,      setSimLoading]      = useState(false)
  const [simError,        setSimError]        = useState('')
  const [activeTab,       setActiveTab]       = useState('simulation')
  const [hotspots,        setHotspots]        = useState(null)
  const [showScenario,    setShowScenario]    = useState(false)
  const [scenarioForm,    setScenarioForm]    = useState(INITIAL_SCENARIO)
  const [scenarioError,   setScenarioError]   = useState('')
  const [feedbackStatus,  setFeedbackStatus]  = useState('')
  const [showWelcome,     setShowWelcome]     = useState(true)

  const pollRef = useRef(null)

  useEffect(() => {
    fetch(`${API}/api/events`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(d => setEvents([...(d.scenarios ?? []), ...(d.events ?? [])]))
      .catch(() => setEventsError('Could not load events. Is the Flask API running?'))
  }, [])

  useEffect(() => {
    fetch(`${API}/api/hotspots`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && d.heatmap_url && setHotspots(d))
      .catch(() => {})
  }, [])

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const createScenario = async (e) => {
    e.preventDefault()
    setScenarioError('')
    try {
      const response = await fetch(`${API}/api/scenarios`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...scenarioForm,
          latitude: Number(scenarioForm.latitude),
          longitude: Number(scenarioForm.longitude),
          expected_attendance: Number(scenarioForm.expected_attendance),
          expected_duration_hours: Number(scenarioForm.expected_duration_hours),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Could not create scenario')
      setEvents(current => [data.scenario, ...current])
      setShowScenario(false)
      await handleEventClick(data.scenario)
    } catch (error) {
      setScenarioError(error.message)
    }
  }

  const submitFeedback = async (e) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setFeedbackStatus('Saving...')
    try {
      const response = await fetch(`${API}/api/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: selectedEvent.id,
          actual_resolution_minutes: Number(form.get('resolution')),
          predicted_resolution_minutes: severity?.resolution_minutes,
          actual_officers: Number(form.get('officers')),
          recommended_officers: mp?.total_officers,
          actual_barricades: Number(form.get('barricades')),
          recommended_barricades: mp?.num_barricades,
          observed_severity: form.get('severity'),
          diversion_effective: form.get('effective') === 'yes',
          notes: form.get('notes'),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Could not save outcome')
      setFeedbackStatus(`Saved. ${data.summary.total_outcomes} total records.`)
      e.currentTarget.reset()
    } catch (error) {
      setFeedbackStatus(error.message)
    }
  }

  const handleEventClick = async (event) => {
    stopPolling()
    setSelectedEvent(event)
    setSeverity(null)
    setSimulation(null)
    setSimError('')
    setSimLoading(true)
    setSeverityLoading(true)

    try {
      const r    = await fetch(`${API}/api/severity/${event.id}`)
      const data = await r.json()
      setSeverity(data)
    } catch {
      /* non-fatal — simulation still proceeds */
    } finally {
      setSeverityLoading(false)
    }

    try {
      const r    = await fetch(`${API}/api/simulate/${event.id}`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok || data.error) {
        setSimError(data.error ?? 'Failed to start simulation')
        setSimLoading(false)
        return
      }

      const taskId   = data.task_id
      let pollAttempts = 0

      pollRef.current = setInterval(async () => {
        pollAttempts += 1
        if (pollAttempts > MAX_POLL_ATTEMPTS) {
          stopPolling()
          setSimError('Simulation timed out after 90 seconds.')
          setSimLoading(false)
          return
        }
        try {
          const sr   = await fetch(`${API}/api/status/${taskId}`)
          const sdata = await sr.json()
          if (sdata.status === 'success') {
            stopPolling(); setSimulation(sdata); setSimLoading(false)
          } else if (sdata.status === 'error') {
            stopPolling(); setSimError(sdata.error ?? 'Simulation failed'); setSimLoading(false)
          }
        } catch {
          stopPolling(); setSimError('Network error during polling.'); setSimLoading(false)
        }
      }, POLL_INTERVAL_MS)
    } catch {
      setSimError('Network error starting simulation.')
      setSimLoading(false)
    }
  }

  const mp = simulation?.manpower_plan
  const mt = simulation?.metrics

  return (
    <div className="h-screen w-full flex flex-col bg-slate-950">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-slate-100 tracking-tight">CityFlow</h1>
          <span className="text-slate-600 text-sm hidden sm:inline">Traffic event impact analysis &mdash; Bengaluru</span>
        </div>
        <div className="flex items-center gap-2">
          {hotspots && (
            <span className="text-[11px] text-slate-500 border border-slate-700 rounded px-2 py-0.5">
              {hotspots.summary_stats?.total_events?.toLocaleString() ?? '—'} historical events
            </span>
          )}
          <span className="text-[11px] text-slate-600">
            {events.length} events loaded
          </span>
        </div>
      </header>

      {/* ── Main 3-column layout ──────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden gap-px bg-slate-800">

        {/* ── LEFT: Event Feed ─────────────────────────────────────────────── */}
        <div className="w-64 shrink-0 bg-slate-900 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 shrink-0">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-medium text-slate-200">Events</h2>
              <button onClick={() => setShowScenario(v => !v)}
                className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 text-[11px] hover:bg-slate-700">
                {showScenario ? 'Cancel' : '+ Custom'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">Select an event to analyze its traffic impact.</p>
          </div>

          {showScenario && (
            <form onSubmit={createScenario} className="p-3 border-b border-slate-800 bg-slate-950/50 space-y-2">
              <input required value={scenarioForm.cause} aria-label="Event cause"
                onChange={e => setScenarioForm({...scenarioForm, cause: e.target.value})}
                className="form-control" placeholder="Event cause" />
              <div className="grid grid-cols-2 gap-1.5">
                <input required type="number" step="any" value={scenarioForm.latitude} aria-label="Latitude"
                  onChange={e => setScenarioForm({...scenarioForm, latitude: e.target.value})}
                  className="form-control" placeholder="Latitude" />
                <input required type="number" step="any" value={scenarioForm.longitude} aria-label="Longitude"
                  onChange={e => setScenarioForm({...scenarioForm, longitude: e.target.value})}
                  className="form-control" placeholder="Longitude" />
              </div>
              <input required type="datetime-local" value={scenarioForm.start_time} aria-label="Start time"
                onChange={e => setScenarioForm({...scenarioForm, start_time: e.target.value})}
                className="form-control" />
              <div className="grid grid-cols-2 gap-1.5">
                <select value={scenarioForm.event_type} aria-label="Event type"
                  onChange={e => setScenarioForm({...scenarioForm, event_type: e.target.value})}
                  className="form-control">
                  <option value="planned">Planned</option><option value="unplanned">Unplanned</option>
                </select>
                <select value={scenarioForm.closure_severity} aria-label="Closure severity"
                  onChange={e => setScenarioForm({...scenarioForm, closure_severity: e.target.value})}
                  className="form-control">
                  <option value="full">Full closure</option><option value="partial">Partial closure</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <input required min="0" type="number" value={scenarioForm.expected_attendance} aria-label="Expected attendance"
                  onChange={e => setScenarioForm({...scenarioForm, expected_attendance: e.target.value})}
                  className="form-control" placeholder="Attendance" />
                <input required min="0.5" step="0.5" type="number" value={scenarioForm.expected_duration_hours} aria-label="Expected duration"
                  onChange={e => setScenarioForm({...scenarioForm, expected_duration_hours: e.target.value})}
                  className="form-control" placeholder="Duration hrs" />
              </div>
              <input value={scenarioForm.roads_affected} aria-label="Roads affected"
                onChange={e => setScenarioForm({...scenarioForm, roads_affected: e.target.value})}
                className="form-control" placeholder="Roads affected" />
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                <input type="checkbox" checked={scenarioForm.requires_closure}
                  onChange={e => setScenarioForm({...scenarioForm, requires_closure: e.target.checked})} />
                Requires road closure
              </label>
              {scenarioError && <p className="text-[11px] text-red-400">{scenarioError}</p>}
              <button className="w-full py-1.5 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-500">
                Create and simulate
              </button>
            </form>
          )}

          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {eventsError ? (
              <div className="p-4 text-center text-red-400 text-xs">{eventsError}</div>
            ) : events.length === 0 ? (
              <div className="p-4 text-center text-slate-600 text-xs">Loading events...</div>
            ) : events.map(ev => (
              <div
                key={ev.id}
                onClick={() => handleEventClick(ev)}
                className={`p-2.5 rounded cursor-pointer transition-colors border ${
                  selectedEvent?.id === ev.id
                    ? 'bg-blue-900/20 border-blue-800/50'
                    : 'border-transparent hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-start justify-between gap-1 mb-0.5">
                  <span className="text-sm text-slate-200 leading-tight">{ev.cause}</span>
                  {ev.requires_closure && (
                    <span className="text-[10px] px-1 py-0.5 bg-red-900/30 text-red-400 border border-red-800/40 rounded shrink-0">
                      CLOSURE
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">{fmtDateTime(ev.time)}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-slate-800 text-slate-400 border-slate-700">
                    {ev.event_type}
                  </span>
                  {ev.source === 'operator_scenario' && (
                    <span className="text-[10px] text-slate-600">Custom</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CENTER: Map Viewer ─────────────────────────────────────────────── */}
        <div className="flex-1 bg-slate-950 flex flex-col overflow-hidden">
          <div className="flex items-center px-4 gap-1 border-b border-slate-800 shrink-0 bg-slate-900">
            <TabBtn id="tab-simulation" active={activeTab === 'simulation'} onClick={() => setActiveTab('simulation')}>
              Diversion map
            </TabBtn>
            <TabBtn id="tab-hotspot" active={activeTab === 'hotspot'} onClick={() => setActiveTab('hotspot')}>
              Historical hotspots
            </TabBtn>
          </div>

          <div className="relative flex-1 overflow-hidden">

            <div className={`absolute inset-0 ${activeTab === 'simulation' ? 'flex flex-col' : 'hidden'}`}>
              {simLoading ? (
                <div className="flex items-center justify-center h-full bg-slate-950">
                  <div className="text-center">
                    <div className="w-6 h-6 border-2 border-slate-600 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="mt-3 text-slate-500 text-xs">Calculating diversion routes...</p>
                  </div>
                </div>
              ) : simError ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                  <p className="text-red-400 text-sm mb-3">{simError}</p>
                  <button onClick={() => selectedEvent && handleEventClick(selectedEvent)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded text-xs">
                    Retry
                  </button>
                </div>
              ) : simulation?.map_url ? (
                <iframe src={`${API}${simulation.map_url}`} className="w-full h-full border-0" title="Diversion Map" />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-600 max-w-xs mx-auto text-center px-4">
                  <svg className="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                      d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  <p className="text-sm text-slate-400 font-medium mb-1">No event selected</p>
                  <p className="text-xs text-slate-600">Select an event from the left panel. The map will show affected roads and recommended traffic diversions.</p>
                </div>
              )}
            </div>

            <div className={`absolute inset-0 ${activeTab === 'hotspot' ? 'flex flex-col' : 'hidden'}`}>
              {hotspots?.heatmap_url ? (
                <iframe src={`${API}${hotspots.heatmap_url}`} className="w-full h-full border-0" title="Hotspot Heatmap" />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="w-6 h-6 border-2 border-slate-600 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="mt-3 text-slate-500 text-xs">Loading hotspot data...</p>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── RIGHT: Intelligence Panel ─────────────────────────────────────── */}
        <div className="w-72 shrink-0 bg-slate-900 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 shrink-0">
            <h2 className="text-sm font-medium text-slate-200">Analysis</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {selectedEvent ? selectedEvent.cause : 'No event selected'}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 custom-scrollbar">

            {!selectedEvent && (
              <div className="text-center py-8">
                <p className="text-xs text-slate-600">Select an event to see the predicted impact, diversion plan, and resource requirements.</p>
              </div>
            )}

            {showWelcome && selectedEvent && (
              <WelcomeBanner onDismiss={() => setShowWelcome(false)} />
            )}

            {selectedEvent && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Impact assessment</h3>
                  {severity?.model_r2 && (
                    <span className="text-[10px] text-slate-600">R&sup2;={severity.model_r2}</span>
                  )}
                </div>
                <div className="space-y-2">
                  {severityLoading ? (
                    <p className="text-xs text-slate-600">Running assessment...</p>
                  ) : severity ? (
                    <>
                      <div className="flex items-center justify-between">
                        <LevelBadge level={severity.response_level} />
                        <span className="text-[11px] text-slate-500">
                          {Math.round((severity.confidence ?? 0) * 100)}% confidence
                        </span>
                      </div>
                      <SeverityBar score={severity.severity_score} />
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <MetricCard
                          label="Expected resolution"
                          value={severity.resolution_label}
                        />
                        <MetricCard
                          label="Nearby historical events"
                          value={severity.nearby_historical_events ?? '—'}
                        />
                      </div>
                      {severity.nearby_cause_breakdown && Object.keys(severity.nearby_cause_breakdown).length > 0 && (
                        <div className="pt-2">
                          <p className="text-[11px] text-slate-500 mb-1 border-b border-slate-800 pb-1">Nearby causes (2 km radius)</p>
                          {Object.entries(severity.nearby_cause_breakdown).slice(0, 3).map(([cause, cnt]) => (
                            <div key={cause} className="flex justify-between text-xs text-slate-400 mt-1">
                              <span className="capitalize">{cause.replace(/_/g, ' ')}</span>
                              <span className="font-mono text-slate-300">{cnt}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-600">Assessment pending.</p>
                  )}
                </div>
              </section>
            )}

            {simulation && mt && (
              <section className="pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Diversion plan</h3>
                  <span className="text-[10px] text-slate-600 border border-slate-700 rounded px-1.5 py-0.5">
                    {mt.time_of_day_label}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard
                    label="Time saved"
                    value={fmtNum(mt.total_time_saved_minutes)}
                    unit="min"
                  />
                  <MetricCard
                    label="Delay reduction"
                    value={fmtNum(mt.average_delay_reduction_pct)}
                    unit="%"
                  />
                  <MetricCard
                    label="Routes diverted"
                    value={`${mt.valid_diversions}/${mt.affected_flows}`}
                  />
                  <MetricCard
                    label="Barricades needed"
                    value={mt.barricades_needed}
                  />
                </div>
                {(simulation.flow_analysis ?? []).length > 0 && (
                  <div className="mt-3">
                    <p className="text-[11px] text-slate-500 mb-1 border-b border-slate-800 pb-1">Affected traffic flows</p>
                    {simulation.flow_analysis.map(flow => (
                      <div key={flow.flow_id} className="flex justify-between items-center py-1 text-xs">
                        <span className="text-slate-400">{flow.flow_id}</span>
                        <span className={`font-mono ${flow.valid_intervention ? 'text-emerald-400' : 'text-slate-600'}`}>
                          {flow.valid_intervention
                            ? `Save ${fmtNum(flow.time_saved_minutes)}m`
                            : 'No benefit'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {mp && mp.total_officers >= 0 && (
              <section className="pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Resource allocation</h3>
                  <LevelBadge level={mp.response_level} />
                </div>
                {mp.total_officers === 0 ? (
                  <p className="text-xs text-slate-500">{mp.note}</p>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <MetricCard label="Total officers" value={mp.total_officers} />
                      <MetricCard label="Shift duration" value={mp.shift_duration_hours} unit="hrs" />
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500 mb-1 border-b border-slate-800 pb-1">Breakdown</p>
                      <div className="space-y-1 mt-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">Officers per barricade</span>
                          <span className="text-slate-300 font-mono">{mp.officers_per_barricade}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">Total barricades</span>
                          <span className="text-slate-300 font-mono">{mp.num_barricades}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">Total officer-hours</span>
                          <span className="text-slate-300 font-mono">{mp.officer_hours_total}</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-600 italic">{mp.urgency_note}</p>
                  </div>
                )}
              </section>
            )}

            {simulation && selectedEvent && (
              <section className="pt-3 border-t border-slate-800">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Record actual outcome</h3>
                <p className="text-[11px] text-slate-500 mb-3">After the event, log what happened so future predictions improve.</p>
                <form onSubmit={submitFeedback} className="space-y-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    <input required name="resolution" min="1" type="number" className="form-control" placeholder="Resolution (min)" />
                    <select required name="severity" className="form-control" defaultValue="Amber">
                      <option>Green</option><option>Amber</option><option>Red</option>
                    </select>
                    <input required name="officers" min="0" type="number" className="form-control" placeholder="Officers used" />
                    <input required name="barricades" min="0" type="number" className="form-control" placeholder="Barricades used" />
                  </div>
                  <select required name="effective" className="form-control" defaultValue="yes">
                    <option value="yes">Diversion worked</option>
                    <option value="no">Diversion did not work</option>
                  </select>
                  <input name="notes" className="form-control" placeholder="Notes (optional)" />
                  <button className="w-full py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium">
                    Save record
                  </button>
                  {feedbackStatus && <p className="text-[11px] text-slate-500">{feedbackStatus}</p>}
                </form>
              </section>
            )}

          </div>
        </div>

      </div>
    </div>
  )
}
