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

// ── Utility helpers ───────────────────────────────────────────────────────────

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

// ── Sub-components ────────────────────────────────────────────────────────────

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
  // score 0–10 → coloured fill
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

// ── Main App ─────────────────────────────────────────────────────────────────

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

  const pollRef = useRef(null)

  // ── Load events ────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/events`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(d => setEvents([...(d.scenarios ?? []), ...(d.events ?? [])]))
      .catch(() => setEventsError('Could not load events. Is the Flask API running?'))
  }, [])

  // ── Load hotspot data ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/hotspots`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && d.heatmap_url && setHotspots(d))
      .catch(() => {})
  }, [])

  // ── Polling control ───────────────────────────────────────────────────────
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
    setFeedbackStatus('Saving outcome...')
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
      setFeedbackStatus(`Saved. ${data.summary.total_outcomes} outcome(s) now inform evaluation.`)
      e.currentTarget.reset()
    } catch (error) {
      setFeedbackStatus(error.message)
    }
  }

  // ── Event click → fetch severity immediately, then kick simulation ────────
  const handleEventClick = async (event) => {
    stopPolling()
    setSelectedEvent(event)
    setSeverity(null)
    setSimulation(null)
    setSimError('')
    setSimLoading(true)
    setSeverityLoading(true)

    // 1️⃣  Severity prediction (fast — returns even before model is trained)
    try {
      const r    = await fetch(`${API}/api/severity/${event.id}`)
      const data = await r.json()
      setSeverity(data)
    } catch {
      // non-fatal — simulation can still run
    } finally {
      setSeverityLoading(false)
    }

    // 2️⃣  Start simulation asynchronously
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

  // ── Derived ───────────────────────────────────────────────────────────────
  const mp = simulation?.manpower_plan
  const mt = simulation?.metrics

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen w-full flex flex-col p-3 gap-3 font-sans bg-slate-950">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-slate-900 border-b border-slate-800 px-5 py-3 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-100">
            CityFlow
          </h1>
          <p className="text-sm text-slate-400">Event-Driven Congestion Simulator</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-slate-800 text-slate-300 border border-slate-700 rounded text-xs">
            {events.length} Events Loaded
          </span>
          {hotspots && (
            <span className="px-3 py-1 bg-slate-800 text-slate-300 border border-slate-700 rounded text-xs font-medium">
              Hotspot Model Active
            </span>
          )}
        </div>
      </header>

      {/* ── Main 3-column layout ──────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden gap-3">

        {/* ── LEFT: Event Feed ─────────────────────────────────────────────── */}
        <div className="w-64 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold text-slate-200 text-sm">Event Scenarios</h2>
                <p className="text-xs text-slate-500 mt-0.5">Historical & operators</p>
              </div>
              <button onClick={() => setShowScenario(value => !value)}
                className="px-2 py-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 text-[10px]">
                {showScenario ? 'Cancel' : '+ New'}
              </button>
            </div>
          </div>
          {showScenario && (
            <form onSubmit={createScenario} className="p-2 border-b border-slate-700/50 space-y-1.5 bg-slate-900/70">
              <input required value={scenarioForm.cause} aria-label="Event cause"
                onChange={e => setScenarioForm({...scenarioForm, cause: e.target.value})}
                className="form-control" placeholder="Event cause" />
              <div className="grid grid-cols-2 gap-1">
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
              <div className="grid grid-cols-2 gap-1">
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
              <div className="grid grid-cols-2 gap-1">
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
              <label className="flex gap-2 items-center text-[10px] text-slate-400">
                <input type="checkbox" checked={scenarioForm.requires_closure}
                  onChange={e => setScenarioForm({...scenarioForm, requires_closure: e.target.checked})} />
                Requires road closure
              </label>
              {scenarioError && <p className="text-[10px] text-red-400">{scenarioError}</p>}
              <button className="w-full py-1.5 rounded bg-blue-600 text-white text-xs font-semibold">
                Create and simulate
              </button>
            </form>
          )}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
            {eventsError ? (
              <div className="p-3 text-center text-red-400 text-xs">⚠️ {eventsError}</div>
            ) : events.length === 0 ? (
              <div className="p-3 text-center text-slate-500 text-xs animate-pulse">Loading events…</div>
            ) : events.map(ev => (
              <div
                key={ev.id}
                onClick={() => handleEventClick(ev)}
                className={`p-2.5 rounded-lg cursor-pointer transition-all duration-150 border ${
                  selectedEvent?.id === ev.id
                    ? 'bg-blue-600/20 border-blue-500/50 shadow-lg shadow-blue-900/20'
                    : 'bg-slate-800/30 border-transparent hover:bg-slate-700/40 hover:border-slate-600/40'
                }`}
              >
                <div className="flex justify-between items-start gap-1 mb-1">
                  <span className="text-sm font-medium text-slate-200 leading-tight">{ev.cause}</span>
                  <div className="flex gap-1 shrink-0">
                    {ev.requires_closure && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded">
                        CLOSURE
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs font-mono text-slate-400">{fmtDateTime(ev.time)}</div>
                <div className="flex justify-between mt-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border bg-slate-800 text-slate-300 border-slate-700`}>
                    {ev.event_type}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {ev.latitude?.toFixed(3)}, {ev.longitude?.toFixed(3)}
                  </span>
                </div>
                {ev.source === 'operator_scenario' && (
                  <div className="text-xs text-slate-400 mt-1">Operator Scenario</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── CENTER: Map Viewer with Tabs ──────────────────────────────────── */}
        <div className="flex-1 bg-slate-950 flex flex-col overflow-hidden border border-slate-800 rounded">
          {/* Tab bar */}
          <div className="flex items-center px-3 pt-2 gap-1 border-b border-slate-800 shrink-0 bg-slate-900">
            <TabBtn id="tab-simulation" active={activeTab === 'simulation'} onClick={() => setActiveTab('simulation')}>
              Simulation Map
            </TabBtn>
            <TabBtn id="tab-hotspot" active={activeTab === 'hotspot'} onClick={() => setActiveTab('hotspot')}>
              Hotspot Map
            </TabBtn>
          </div>

          {/* Map area */}
          <div className="relative flex-1 overflow-hidden">

            {/* ── Simulation tab ─────────────────────────────────────────── */}
            <div className={`absolute inset-0 ${activeTab === 'simulation' ? 'flex flex-col' : 'hidden'}`}>
              {simLoading ? (
                <div className="flex flex-col items-center justify-center h-full bg-slate-900/60 backdrop-blur-sm">
                  <div className="w-8 h-8 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                  <p className="mt-4 text-slate-300 font-mono text-sm">Computing diversion routes…</p>
                </div>
              ) : simError ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                  <div className="text-4xl mb-3">🚨</div>
                  <p className="text-red-400 text-sm mb-4">{simError}</p>
                  <button
                    onClick={() => selectedEvent && handleEventClick(selectedEvent)}
                    className="px-4 py-2 bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/50 text-blue-300 rounded-lg text-sm transition-colors"
                  >
                    ↩ Retry
                  </button>
                </div>
              ) : simulation?.map_url ? (
                <iframe src={`${API}${simulation.map_url}`} className="w-full h-full border-0" title="Diversion Map" />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-500">
                  <svg className="w-14 h-14 mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                      d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  <p className="text-sm">Select an event to run the Digital Twin simulation</p>
                  <p className="text-xs text-slate-600 mt-1">Graph AI will compute diversion + barricade plan</p>
                </div>
              )}
            </div>

            {/* ── Hotspot tab ─────────────────────────────────────────────── */}
            <div className={`absolute inset-0 ${activeTab === 'hotspot' ? 'flex flex-col' : 'hidden'}`}>
              {hotspots?.heatmap_url ? (
                <iframe src={`${API}${hotspots.heatmap_url}`} className="w-full h-full border-0" title="Hotspot Heatmap" />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-500">
                  <div className="w-8 h-8 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                  <p className="mt-4 text-slate-300 font-mono text-sm">Generating hotspot heatmap…</p>
                  <p className="text-xs text-slate-500 mt-1">Processing historical events</p>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── RIGHT: Intelligence Panel ─────────────────────────────────────── */}
        <div className="w-72 shrink-0 bg-slate-900 border-l border-slate-800 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 shrink-0">
            <h2 className="font-semibold text-slate-200 text-sm">Operations Panel</h2>
            {selectedEvent && (
              <p className="text-xs text-slate-400 mt-0.5 truncate">{selectedEvent.cause}</p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">

            {/* ── Default state ─────────────────────────────────────────────── */}
            {!selectedEvent && (
              <p className="text-xs text-slate-500 italic pt-2">Select an event to see AI predictions.</p>
            )}

            {/* ── Section 1: Severity Prediction (shows immediately) ────────── */}
            {selectedEvent && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-200">Severity Forecast</h3>
                  {severity?.model_r2 && (
                    <span className="text-xs font-mono text-slate-500">R²={severity.model_r2}</span>
                  )}
                </div>
                <div className="p-3 space-y-2">
                  {severityLoading ? (
                    <div className="text-xs text-slate-500 animate-pulse">Running model…</div>
                  ) : severity ? (
                    <>
                      <div className="flex items-center justify-between">
                        <LevelBadge level={severity.response_level} />
                        <span className="text-xs text-slate-400">
                          Confidence: {Math.round((severity.confidence ?? 0) * 100)}%
                        </span>
                      </div>
                      <SeverityBar score={severity.severity_score} />
                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div>
                          <div className="text-xs text-slate-400">Est. Resolution</div>
                          <div className="text-lg font-mono text-slate-100">{severity.resolution_label}</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-400">Nearby Events</div>
                          <div className="text-lg font-mono text-slate-100">{severity.nearby_historical_events ?? '—'}</div>
                        </div>
                      </div>
                      {severity.nearby_cause_breakdown && Object.keys(severity.nearby_cause_breakdown).length > 0 && (
                        <div className="mt-4">
                          <div className="text-xs text-slate-400 mb-1 border-b border-slate-800 pb-1">Historical Cause Breakdown (2km)</div>
                          {Object.entries(severity.nearby_cause_breakdown).slice(0, 3).map(([cause, cnt]) => (
                            <div key={cause} className="flex justify-between text-sm text-slate-300 mt-1">
                              <span className="capitalize">{cause.replace('_', ' ')}</span>
                              <span className="font-mono">{cnt}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-xs text-slate-500">No prediction available.</div>
                  )}
                </div>
              </div>
            )}

            {/* ── Section 2: Simulation Metrics (shows after simulation) ─────── */}
            {simulation && mt && (
              <div className="mb-4 pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-200">Simulation Results</h3>
                  <span className="text-xs text-slate-400">
                    {mt.time_of_day_label}
                  </span>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <MetricCard
                      label="Time Saved"
                      value={fmtNum(mt.total_time_saved_minutes)}
                      unit="min"
                      color="text-emerald-400"
                    />
                    <MetricCard
                      label="Delay Reduction"
                      value={fmtNum(mt.average_delay_reduction_pct)}
                      unit="%"
                      color="text-cyan-400"
                    />
                    <MetricCard
                      label="Valid Diversions"
                      value={`${mt.valid_diversions}/${mt.affected_flows}`}
                      color="text-blue-300"
                    />
                    <MetricCard
                      label="Barricades Needed"
                      value={mt.barricades_needed}
                    />
                  </div>
                  <div className="space-y-2 mt-4">
                    <div className="text-xs text-slate-400 mb-1 border-b border-slate-800 pb-1">Affected Flows</div>
                    {(simulation.flow_analysis ?? []).map(flow => (
                      <div key={flow.flow_id} className="flex flex-col mb-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-300">{flow.flow_id}</span>
                          <span className={flow.valid_intervention ? 'text-emerald-400 font-mono' : 'text-slate-500'}>
                            {flow.valid_intervention ? `Save ${fmtNum(flow.time_saved_minutes)}m` : 'No Benefit'}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs text-slate-500">
                          <span className="font-mono">Normal: {fmtNum(flow.without_intervention_minutes)}m</span>
                          <span className="font-mono">Diverted: {fmtNum(flow.with_intervention_minutes)}m</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Section 3: Manpower Plan (shows after simulation) ─────────── */}
            {mp && mp.total_officers >= 0 && (
              <div className="mb-4 pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-200">Manpower Plan</h3>
                  <LevelBadge level={mp.response_level} />
                </div>
                <div className="space-y-4">
                  {mp.total_officers === 0 ? (
                    <p className="text-sm text-slate-400">{mp.note}</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <MetricCard
                          label="Total Officers"
                          value={mp.total_officers}
                        />
                        <MetricCard
                          label="Shift Duration"
                          value={mp.shift_duration_hours}
                          unit="hrs"
                        />
                      </div>
                      <div className="mt-2 text-sm">
                        <div className="text-xs text-slate-400 mb-1 border-b border-slate-800 pb-1">Deployment Breakdown</div>
                        <div className="flex justify-between mt-1">
                          <span className="text-slate-400">Officers / Barricade</span>
                          <span className="text-slate-100 font-mono">{mp.officers_per_barricade}</span>
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-slate-400">Total Barricades</span>
                          <span className="text-slate-100 font-mono">{mp.num_barricades}</span>
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-slate-400">Total Officer-Hours</span>
                          <span className="text-slate-100 font-mono">{mp.officer_hours_total}</span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">{mp.urgency_note}</p>
                    </>
                  )}
                </div>
              </div>
            )}

            {simulation && selectedEvent && (
              <form onSubmit={submitFeedback} className="pt-4 border-t border-slate-800">
                <h3 className="text-sm font-semibold text-slate-200 mb-2">Post-Event Review</h3>
                <div className="space-y-2">
                  <p className="text-xs text-slate-500 mb-2">Record actual operations.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input required name="resolution" min="1" type="number" className="form-control" placeholder="Actual mins" />
                    <select required name="severity" className="form-control" defaultValue="Amber">
                      <option>Green</option><option>Amber</option><option>Red</option>
                    </select>
                    <input required name="officers" min="0" type="number" className="form-control" placeholder="Officers used" />
                    <input required name="barricades" min="0" type="number" className="form-control" placeholder="Barricades used" />
                  </div>
                  <select required name="effective" className="form-control mt-2" defaultValue="yes">
                    <option value="yes">Diversion effective</option>
                    <option value="no">Diversion ineffective</option>
                  </select>
                  <input name="notes" className="form-control mt-2" placeholder="Operational notes" />
                  <button className="w-full py-2 mt-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-sm font-medium">
                    Save Record
                  </button>
                  {feedbackStatus && <p className="text-xs text-slate-400">{feedbackStatus}</p>}
                </div>
              </form>
            )}

          </div>
        </div>

      </div>
    </div>
  )
}
