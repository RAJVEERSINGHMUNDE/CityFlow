import { useState, useEffect, useRef } from 'react'

const API              = ''
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS  = 90_000

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
    Amber: 'bg-amber-500/20  text-amber-300  border-amber-500/40',
    Red:   'bg-red-500/20    text-red-300    border-red-500/40',
  }
  const icons = { Green: '🟢', Amber: '🟡', Red: '🔴' }
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-bold uppercase tracking-wide ${styles[level] ?? styles.Amber}`}>
      {icons[level]} {level}
    </span>
  )
}

function SeverityBar({ score }) {
  // score 0–10 → coloured fill
  const pct   = Math.min(100, (score / 10) * 100)
  const color = score >= 7 ? '#ef4444' : score >= 4 ? '#f59e0b' : '#22c55e'
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>Severity Score</span>
        <span className="font-bold text-slate-200">{fmtNum(score, 1)} / 10</span>
      </div>
      <div className="h-3 rounded-full bg-slate-700 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  )
}

function MetricCard({ label, value, unit, color = 'text-slate-200', sub }) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
      <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>
        {value}
        {unit && <span className="text-xs font-normal text-slate-400 ml-1">{unit}</span>}
      </div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
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

  const pollRef = useRef(null)

  // ── Load events ────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/events`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(d => setEvents(d.events ?? []))
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
      const startedAt = Date.now()

      pollRef.current = setInterval(async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
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
      <header className="glass-panel px-5 py-3 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 via-cyan-300 to-teal-300 bg-clip-text text-transparent">
            CityFlow Digital Twin
          </h1>
          <p className="text-xs text-slate-400">PS2 — Event-Driven Congestion Simulator · Bengaluru</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-full text-xs font-semibold">
            ● Live
          </span>
          <span className="px-3 py-1 bg-slate-700/50 text-slate-400 border border-slate-600/30 rounded-full text-xs">
            {events.length} Events Loaded
          </span>
          {hotspots && (
            <span className="px-3 py-1 bg-purple-500/15 text-purple-300 border border-purple-500/30 rounded-full text-xs font-semibold">
              🔥 Hotspot AI Ready
            </span>
          )}
        </div>
      </header>

      {/* ── Main 3-column layout ──────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden gap-3">

        {/* ── LEFT: Event Feed ─────────────────────────────────────────────── */}
        <div className="w-64 shrink-0 glass-panel flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/50">
            <h2 className="font-semibold text-slate-200 text-sm">High Priority Events</h2>
            <p className="text-[10px] text-slate-500 mt-0.5">Click to run AI simulation</p>
          </div>
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
                  <span className="text-xs font-medium text-blue-100 leading-tight">{ev.cause}</span>
                  <div className="flex gap-1 shrink-0">
                    {ev.requires_closure && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded">
                        CLOSURE
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-[10px] text-slate-400">🕐 {fmtDateTime(ev.time)}</div>
                <div className="flex justify-between mt-1">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                    ev.event_type === 'planned'
                      ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  }`}>
                    {ev.event_type?.toUpperCase()}
                  </span>
                  <span className="text-[9px] text-slate-600 font-mono">
                    {ev.latitude?.toFixed(3)}, {ev.longitude?.toFixed(3)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CENTER: Map Viewer with Tabs ──────────────────────────────────── */}
        <div className="flex-1 glass-panel flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center px-3 pt-2 gap-1 border-b border-slate-700/50 shrink-0">
            <TabBtn id="tab-simulation" active={activeTab === 'simulation'} onClick={() => setActiveTab('simulation')}>
              🗺 Simulation Map
            </TabBtn>
            <TabBtn id="tab-hotspot" active={activeTab === 'hotspot'} onClick={() => setActiveTab('hotspot')}>
              🔥 Hotspot Map
            </TabBtn>
          </div>

          {/* Map area */}
          <div className="relative flex-1 overflow-hidden">

            {/* ── Simulation tab ─────────────────────────────────────────── */}
            <div className={`absolute inset-0 ${activeTab === 'simulation' ? 'flex flex-col' : 'hidden'}`}>
              {simLoading ? (
                <div className="flex flex-col items-center justify-center h-full bg-slate-900/60 backdrop-blur-sm">
                  <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <p className="mt-4 text-blue-300 font-mono text-sm animate-pulse">Running Graph Simulation…</p>
                  <p className="mt-1 text-slate-500 text-xs">Extracting subgraph · Shockwave propagation · Dijkstra diversion</p>
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
                  <div className="text-4xl mb-3 animate-pulse">🔥</div>
                  <p className="text-sm">Hotspot heatmap is being generated…</p>
                  <p className="text-xs text-slate-600 mt-1">Mining 8,173 historical events</p>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── RIGHT: Intelligence Panel ─────────────────────────────────────── */}
        <div className="w-72 shrink-0 glass-panel flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/50 shrink-0">
            <h2 className="font-semibold text-slate-200 text-sm">AI Intelligence Panel</h2>
            {selectedEvent && (
              <p className="text-[10px] text-slate-400 mt-0.5 truncate">⚡ {selectedEvent.cause}</p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">

            {/* ── Default state ─────────────────────────────────────────────── */}
            {!selectedEvent && (
              <p className="text-xs text-slate-500 italic pt-2">Select an event to see AI predictions.</p>
            )}

            {/* ── Section 1: Severity Prediction (shows immediately) ────────── */}
            {selectedEvent && (
              <div className="rounded-lg border border-slate-700/50 overflow-hidden">
                <div className="px-3 py-2 bg-slate-800/60 border-b border-slate-700/50 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">ML Severity Prediction</span>
                  {severity?.model_r2 && (
                    <span className="text-[9px] text-slate-500">R²={severity.model_r2}</span>
                  )}
                </div>
                <div className="p-3 space-y-2">
                  {severityLoading ? (
                    <div className="text-xs text-slate-500 animate-pulse">Running model…</div>
                  ) : severity ? (
                    <>
                      <div className="flex items-center justify-between">
                        <LevelBadge level={severity.response_level} />
                        <span className="text-[10px] text-slate-400">
                          Confidence: {Math.round((severity.confidence ?? 0) * 100)}%
                        </span>
                      </div>
                      <SeverityBar score={severity.severity_score} />
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="bg-slate-900/50 rounded p-2 text-center">
                          <div className="text-[9px] text-slate-500 uppercase">Est. Resolution</div>
                          <div className="text-sm font-bold text-cyan-300">{severity.resolution_label}</div>
                        </div>
                        <div className="bg-slate-900/50 rounded p-2 text-center">
                          <div className="text-[9px] text-slate-500 uppercase">Nearby Events</div>
                          <div className="text-sm font-bold text-purple-300">{severity.nearby_historical_events ?? '…'}</div>
                        </div>
                      </div>
                      {severity.nearby_cause_breakdown && Object.keys(severity.nearby_cause_breakdown).length > 0 && (
                        <div className="mt-1">
                          <div className="text-[9px] text-slate-500 uppercase mb-1">Historical Cause Breakdown (2km)</div>
                          {Object.entries(severity.nearby_cause_breakdown).slice(0, 3).map(([cause, cnt]) => (
                            <div key={cause} className="flex justify-between text-[10px] text-slate-400">
                              <span className="capitalize">{cause.replace('_', ' ')}</span>
                              <span className="text-slate-300">{cnt}</span>
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
              <div className="rounded-lg border border-slate-700/50 overflow-hidden">
                <div className="px-3 py-2 bg-slate-800/60 border-b border-slate-700/50">
                  <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Simulation Results</span>
                </div>
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${
                      mt.time_of_day_label === 'Rush Hour'
                        ? 'bg-red-500/20 text-red-300 border-red-500/30'
                        : mt.time_of_day_label === 'Night'
                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                        : 'bg-green-500/20 text-green-300 border-green-500/30'
                    } font-semibold uppercase`}>
                      {mt.time_of_day_label} ×{mt.time_multiplier}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <MetricCard
                      label="Added Delay"
                      value={mt.delay_added_minutes > 0 ? `+${fmtNum(mt.delay_added_minutes)}` : fmtNum(mt.delay_added_minutes)}
                      unit="min"
                      color={mt.delay_added_minutes > 5 ? 'text-red-400' : 'text-amber-400'}
                    />
                    <MetricCard
                      label="Diversion Dist."
                      value={fmtNum(mt.diversion_distance_km)}
                      unit="km"
                      color="text-cyan-400"
                    />
                    <MetricCard
                      label="Segments Closed"
                      value={mt.closed_edges}
                      color="text-red-400"
                    />
                    <MetricCard
                      label="Barricades"
                      value={mt.barricades_needed}
                      color="text-orange-400"
                    />
                  </div>
                  <div className="bg-slate-900/50 rounded p-2">
                    <div className="text-[9px] text-slate-500 uppercase mb-1">Route Comparison</div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-400">Normal</span>
                      <span className="text-slate-300">{fmtNum(mt.normal_distance_km)} km</span>
                    </div>
                    <div className="flex justify-between text-[10px] mt-0.5">
                      <span className="text-slate-400">Diversion</span>
                      <span className="text-cyan-400">{fmtNum(mt.diversion_distance_km)} km</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Section 3: Manpower Plan (shows after simulation) ─────────── */}
            {mp && mp.total_officers >= 0 && (
              <div className="rounded-lg border border-slate-700/50 overflow-hidden">
                <div className="px-3 py-2 bg-slate-800/60 border-b border-slate-700/50 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Manpower Plan</span>
                  <LevelBadge level={mp.response_level} />
                </div>
                <div className="p-3 space-y-2">
                  {mp.total_officers === 0 ? (
                    <p className="text-xs text-emerald-400">✅ {mp.note}</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <MetricCard
                          label="Total Officers"
                          value={mp.total_officers}
                          color="text-blue-300"
                        />
                        <MetricCard
                          label="Shift Duration"
                          value={mp.shift_duration_hours}
                          unit="hrs"
                          color="text-slate-200"
                        />
                      </div>
                      <div className="bg-slate-900/50 rounded p-2">
                        <div className="text-[9px] text-slate-500 uppercase mb-1">Deployment Breakdown</div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-slate-400">Per Barricade</span>
                          <span className="text-blue-300 font-bold">{mp.officers_per_barricade} officers</span>
                        </div>
                        <div className="flex justify-between text-[10px] mt-0.5">
                          <span className="text-slate-400">Barricade Positions</span>
                          <span className="text-slate-300">{mp.num_barricades}</span>
                        </div>
                        <div className="flex justify-between text-[10px] mt-0.5">
                          <span className="text-slate-400">Total Officer-Hours</span>
                          <span className="text-amber-300 font-bold">{mp.officer_hours_total}</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500 italic">{mp.urgency_note}</p>
                    </>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  )
}
