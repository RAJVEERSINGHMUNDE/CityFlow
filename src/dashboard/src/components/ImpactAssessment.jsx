import { Icon } from './icons.jsx'
import { Card, SectionTitle, Hint, SeverityBadge, Spinner } from './common.jsx'

const SEVERITY_LABEL = {
  Green: { title: 'Traffic should keep moving',  body: 'This is a small event. Light monitoring is enough.' },
  Amber: { title: 'Traffic will be affected',    body: 'Drivers will notice delays. Action is recommended.' },
  Red:   { title: 'Traffic is going to break down', body: 'Expect serious jams. Full response is recommended.' },
}

function fmtInt(n) {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString()
}

function duration(min) {
  if (min == null) return '—'
  const m = Math.round(min)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

// Map severity level to card tone + subtle left-border accent.
function toneFor(level) {
  if (level === 'Red')   return 'danger'
  if (level === 'Amber') return 'warning'
  if (level === 'Green') return 'success'
  return 'default'
}

export function ImpactAssessment({ severity, loading }) {
  if (loading) {
    return (
      <Card className="p-5" tone="default">
        <SectionTitle icon={Icon.Sparkle} title="Impact assessment" />
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Spinner size="sm" />
          <span>Calculating…</span>
        </div>
      </Card>
    )
  }
  if (!severity) {
    return (
      <Card className="p-5" tone="default">
        <SectionTitle icon={Icon.Sparkle} title="Impact assessment" />
        <p className="text-xs text-slate-500 dark:text-slate-400">Select an event to see the assessment.</p>
      </Card>
    )
  }

  const level = severity.response_level
  const summary = SEVERITY_LABEL[level] || { title: 'Assessed', body: '' }
  const forecast = severity.impact_forecast || {}
  const clearance = severity.clearance_forecast || {}

  return (
    <Card className="p-5" tone={toneFor(level)}>
      <SectionTitle
        icon={Icon.Sparkle}
        title="Impact assessment"
        action={level && <SeverityBadge level={level} />}
      />

      <p className="text-sm text-slate-900 font-medium leading-relaxed mb-1 dark:text-slate-100">{summary.title}</p>
      <p className="text-xs text-slate-500 leading-relaxed mb-4 dark:text-slate-400">{summary.body}</p>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1 dark:text-slate-400">
            <Icon.Clock width={11} height={11} />
            <span>How long to clear</span>
            <Hint text="Best guess at how long until traffic is back to normal, based on past similar events." />
          </div>
          <div className="text-2xl font-bold text-slate-900 leading-tight dark:text-slate-50">
            {severity.resolution_label || duration(severity.resolution_minutes)}
          </div>
          {clearance.t80_clearance_min && (
            <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
              Worst-case ~{duration(clearance.t80_clearance_min)}
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1 dark:text-slate-400">
            <Icon.People width={11} height={11} />
            <span>People delayed</span>
            <Hint text="Total hours of waiting time added for everyone stuck in traffic during this event." />
          </div>
          <div className="text-2xl font-bold text-slate-900 leading-tight dark:text-slate-50">
            {fmtInt(forecast.person_delay_minutes)}
            <span className="text-sm font-normal text-slate-500 ml-1 dark:text-slate-400">min</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
            ~{fmtInt(forecast.affected_vehicle_count)} vehicles
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1 dark:text-slate-400">
            <Icon.Layers width={11} height={11} />
            <span>Backed-up queue</span>
            <Hint text="How long the traffic jam tail is expected to be, in metres." />
          </div>
          <div className="text-2xl font-bold text-slate-900 leading-tight dark:text-slate-50">
            {fmtInt(forecast.queue_length_m)}
            <span className="text-sm font-normal text-slate-500 ml-1 dark:text-slate-400">m</span>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1 dark:text-slate-400">
            <Icon.Bolt width={11} height={11} />
            <span>Congestion score</span>
            <Hint text="0-1 score. 0 is no problem, 1 is total gridlock. Combines closed roads, spillback and crowd size." />
          </div>
          <div className="text-2xl font-bold text-slate-900 leading-tight dark:text-slate-50">
            {forecast.area_congestion_index != null
              ? Math.round(forecast.area_congestion_index * 100) + '%'
              : '—'}
          </div>
        </div>
      </div>

      {severity.nearby_historical_events > 0 && (
        <div className="rounded-lg bg-slate-50 ring-1 ring-slate-300/80 p-3 dark:bg-slate-800/40 dark:ring-slate-700/60">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Icon.Help width={11} height={11} className="text-slate-500 dark:text-slate-400" />
            <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wider dark:text-slate-400">What history says</span>
          </div>
          <p className="text-xs text-slate-700 leading-relaxed dark:text-slate-300">
            In the last few years, <strong className="text-slate-900 dark:text-slate-50">{severity.nearby_historical_events}</strong> similar events
            happened within 2 km of this location
            {severity.nearby_closure_events > 0 && (
              <>, and <strong className="text-slate-900 dark:text-slate-50">{severity.nearby_closure_events}</strong> of them needed road closures</>
            )}.
          </p>
          {severity.nearby_cause_breakdown && Object.keys(severity.nearby_cause_breakdown).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(severity.nearby_cause_breakdown).slice(0, 3).map(([cause, n]) => (
                <span key={cause} className="text-[10.5px] px-1.5 py-0.5 rounded bg-white text-slate-700 ring-1 ring-slate-300/80 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">
                  {String(cause).replace(/_/g, ' ')} <span className="text-slate-500 dark:text-slate-400">×{n}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
