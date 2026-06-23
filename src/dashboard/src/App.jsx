import { useState, useEffect, useRef } from 'react'
import { Icon } from './components/icons.jsx'
import { EventList } from './components/EventList.jsx'
import { Onboarding } from './components/Onboarding.jsx'
import { AnalysisView } from './components/AnalysisView.jsx'
import { HelpModal } from './components/HelpModal.jsx'
import { ThemeToggle } from './components/ThemeToggle.jsx'

const API = ''
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS  = 90_000
const MAX_POLL_ATTEMPTS = Math.ceil(POLL_TIMEOUT_MS / POLL_INTERVAL_MS)

export default function App() {
  // ── State ─────────────────────────────────────────────────────────────
  const [events,          setEvents]          = useState([])
  const [eventsError,     setEventsError]     = useState('')
  const [eventsLoading,   setEventsLoading]   = useState(true)
  const [selectedEvent,   setSelectedEvent]   = useState(null)
  const [severity,        setSeverity]        = useState(null)
  const [severityLoading, setSeverityLoading] = useState(false)
  const [simulation,      setSimulation]      = useState(null)
  const [simLoading,      setSimLoading]      = useState(false)
  const [simError,        setSimError]        = useState('')
  const [hotspots,        setHotspots]        = useState(null)
  const [showForm,        setShowForm]        = useState(false)
  const [formError,       setFormError]       = useState('')
  const [helpOpen,        setHelpOpen]        = useState(false)
  const [feedbackSummary, setFeedbackSummary] = useState(null)
  const [view,            setView]            = useState('home') // 'home' | 'analysis'

  const pollRef = useRef(null)

  // ── Data fetch on mount ───────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/events`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(d => setEvents([...(d.scenarios ?? []), ...(d.events ?? [])]))
      .catch(() => setEventsError('Could not load events. Is the API running on port 8000?'))
      .finally(() => setEventsLoading(false))

    fetch(`${API}/api/hotspots`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && d.heatmap_url && setHotspots(d))
      .catch(() => {})

    fetch(`${API}/api/feedback/summary`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setFeedbackSummary(d))
      .catch(() => {})
  }, [])

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleEventClick = async (event) => {
    stopPolling()
    setSelectedEvent(event)
    setView('analysis')
    setSeverity(null)
    setSimulation(null)
    setSimError('')
    setSimLoading(true)
    setSeverityLoading(true)

    // Severity (non-blocking)
    fetch(`${API}/api/severity/${event.id}`)
      .then(r => r.json())
      .then(data => setSeverity(data))
      .catch(() => {})
      .finally(() => setSeverityLoading(false))

    // Simulation
    try {
      const r = await fetch(`${API}/api/simulate/${event.id}`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok || data.error) {
        setSimError(data.error ?? 'Failed to start simulation')
        setSimLoading(false)
        return
      }
      const taskId = data.task_id
      let attempts = 0
      pollRef.current = setInterval(async () => {
        attempts += 1
        if (attempts > MAX_POLL_ATTEMPTS) {
          stopPolling()
          setSimError('Simulation timed out after 90 seconds.')
          setSimLoading(false)
          return
        }
        try {
          const sr = await fetch(`${API}/api/status/${taskId}?_t=${Date.now()}`, { cache: 'no-store' })
          const sdata = await sr.json()
          if (sdata.status === 'success') {
            stopPolling(); setSimulation(sdata); setSimLoading(false)
          } else if (sdata.status === 'error') {
            stopPolling(); setSimError(sdata.error ?? 'Simulation failed'); setSimLoading(false)
          }
        } catch {
          stopPolling(); setSimError('Network error during simulation.'); setSimLoading(false)
        }
      }, POLL_INTERVAL_MS)
    } catch {
      setSimError('Network error starting simulation.')
      setSimLoading(false)
    }
  }

  const loadDemo = async () => {
    try {
      const r = await fetch(`${API}/api/scenarios/demo`, { method: 'POST' })
      const data = await r.json()
      if (r.ok) {
        setEvents(current => [...(data.scenarios || []), ...current])
        if (data.scenarios?.length) handleEventClick(data.scenarios[0])
      }
    } catch { /* ignore */ }
  }

  const createScenario = async (payload) => {
    setFormError('')
    try {
      const response = await fetch(`${API}/api/scenarios`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Could not create scenario')
      setEvents(current => [data.scenario, ...current])
      setShowForm(false)
      handleEventClick(data.scenario)
    } catch (error) {
      setFormError(error.message)
    }
  }

  const goHome = () => {
    stopPolling()
    setView('home')
    setSelectedEvent(null)
    setSeverity(null)
    setSimulation(null)
    setSimError('')
  }

  const onFeedbackSubmitted = (summary) => {
    if (summary) setFeedbackSummary(summary)
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="h-screen w-full flex flex-col bg-slate-200 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Header */}
      <header className="bg-white/80 border-b border-slate-300 px-5 py-3 flex items-center gap-4 shrink-0 backdrop-blur-md dark:bg-slate-900/80 dark:border-slate-800">
        <button onClick={goHome} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white shadow-sm dark:bg-blue-700">
            <Icon.Route width={18} height={18} />
          </div>
          <div className="text-left">
            <h1 className="text-base font-bold text-slate-900 leading-tight tracking-tight dark:text-slate-50">CityFlow</h1>
            <p className="text-[10.5px] text-slate-500 leading-tight dark:text-slate-400">Event-driven traffic planning • Bengaluru</p>
          </div>
        </button>

        <div className="hidden md:flex items-center gap-2 ml-4 text-[11px] text-slate-500 dark:text-slate-400">
          {selectedEvent && view === 'analysis' && (
            <button onClick={goHome} className="text-slate-500 hover:text-slate-900 flex items-center gap-1 dark:text-slate-400 dark:hover:text-slate-100">
              <Icon.ChevronRight width={12} height={12} className="rotate-180" />
              All events
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {hotspots?.summary_stats?.total_events != null && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-500 border border-slate-200 rounded-md px-2 py-1 dark:text-slate-400 dark:border-slate-700">
              <Icon.Layers width={11} height={11} />
              {hotspots.summary_stats.total_events.toLocaleString()} historical events
            </span>
          )}
          {feedbackSummary?.total_outcomes > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-500 border border-slate-200 rounded-md px-2 py-1 dark:text-slate-400 dark:border-slate-700">
              <Icon.Check width={11} height={11} className="text-emerald-600" />
              {feedbackSummary.total_outcomes} outcome{feedbackSummary.total_outcomes === 1 ? '' : 's'} learned
            </span>
          )}
          <button
            onClick={() => setHelpOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 text-xs font-medium transition-colors dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-800"
            aria-label="Open help and glossary"
          >
            <Icon.Help width={14} height={14} />
            <span className="hidden sm:inline">Help</span>
          </button>
          <a
            href="/presentation"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 text-xs font-medium transition-colors dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-800"
            title="Open the recorded presentation in a new tab"
          >
            <Icon.Play width={14} height={14} />
            <span className="hidden sm:inline">Presentation</span>
          </a>
          <ThemeToggle />
        </div>
      </header>

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (event list) — glassmorphism so the map bleeds through slightly */}
        <aside className="w-80 shrink-0 sidebar-glass flex flex-col overflow-hidden">
          <EventList
            events={events}
            error={eventsError}
            loading={eventsLoading}
            selectedId={selectedEvent?.id}
            onSelect={handleEventClick}
            onLoadDemo={loadDemo}
            onCreateCustom={() => setShowForm(v => !v)}
            showForm={showForm}
            onCloseForm={() => { setShowForm(false); setFormError('') }}
            onSubmitForm={createScenario}
            formError={formError}
          />
        </aside>

        {/* Main content area */}
        <main className="flex-1 overflow-hidden">
          {view === 'home' || !selectedEvent ? (
            <Onboarding
              onLoadDemo={loadDemo}
              onCreateCustom={() => { setShowForm(true); setView('home') }}
              onExploreHotspots={() => {
                if (hotspots?.heatmap_url) window.open(hotspots.heatmap_url, '_blank')
              }}
              hotspotsCount={hotspots?.summary_stats?.total_events}
              eventsCount={events.length}
              error={eventsError}
            />
          ) : (
            <AnalysisView
              event={selectedEvent}
              severity={severity}
              severityLoading={severityLoading}
              simulation={simulation}
              simLoading={simLoading}
              simError={simError}
              onRetrySim={() => handleEventClick(selectedEvent)}
              onFeedbackSubmitted={onFeedbackSubmitted}
              feedbackSummary={feedbackSummary}
            />
          )}
        </main>
      </div>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
