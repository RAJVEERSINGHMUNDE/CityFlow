import { Icon } from './icons.jsx'
import { Card, Hint, SeverityBadge, EventTypeBadge, Spinner } from './common.jsx'

function fmtDateTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
  } catch { return iso }
}

const SEVERITY_VERB = {
  Green: 'is expected to be minor',
  Amber: 'will cause moderate disruption',
  Red:   'will cause serious disruption',
}

function highlightNLP(text, flagged) {
  if (!text) return null
  if (!flagged || !flagged.length) return text
  const re = new RegExp(`(${flagged.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = text.split(re)
  return parts.map((part, i) =>
    flagged.some(f => f.toLowerCase() === part.toLowerCase())
      ? <mark key={i} className="bg-red-500/20 text-red-200 px-0.5 rounded">{part}</mark>
      : <span key={i}>{part}</span>
  )
}

export function SituationCard({ event, severity, severityLoading }) {
  if (!event) return null

  const level = severity?.response_level
  const headline = level
    ? `This event ${SEVERITY_VERB[level] || 'has been assessed'}.`
    : 'CityFlow is calculating how bad this event will be…'
  const confidence = severity?.confidence
  const isLowConfidence = confidence !== undefined && confidence < 0.6

  return (
    <Card className="p-5" tone="default">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-300 shrink-0">
          <Icon.Flag width={20} height={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h2 className="text-lg font-semibold text-slate-100">{event.cause}</h2>
            <EventTypeBadge type={event.event_type} />
            {event.requires_closure && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium border bg-red-500/10 text-red-300 border-red-500/30">
                <Icon.Flag width={11} height={11} />
                Road closure
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400">
            <Icon.Calendar width={11} height={11} className="inline -mt-0.5 mr-1" />
            {fmtDateTime(event.time)}
            {event.expected_attendance > 0 && (
              <>
                <span className="mx-2 text-slate-700">•</span>
                <Icon.People width={11} height={11} className="inline -mt-0.5 mr-1" />
                ~{Number(event.expected_attendance).toLocaleString()} expected
              </>
            )}
            {event.roads_affected && (
              <>
                <span className="mx-2 text-slate-700">•</span>
                <Icon.Pin width={11} height={11} className="inline -mt-0.5 mr-1" />
                {event.roads_affected}
              </>
            )}
          </div>
        </div>
        {level && <SeverityBadge level={level} large />}
      </div>

      <div className="rounded-lg bg-slate-950/40 border border-slate-800 p-3">
        {severityLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Spinner size="sm" />
            <span>Assessing impact…</span>
          </div>
        ) : level ? (
          <>
            <p className="text-sm text-slate-200 leading-relaxed">
              <strong className="text-slate-100">{headline}</strong>{' '}
              {severity.resolution_label && (
                <span className="text-slate-400">
                  Expected to take about <strong className="text-slate-200">{severity.resolution_label}</strong> to clear.
                </span>
              )}
            </p>
            {isLowConfidence && (
              <p className="text-[11px] text-amber-300/80 mt-2 flex items-start gap-1.5">
                <Icon.Info width={12} height={12} className="shrink-0 mt-0.5" />
                <span>Model confidence is moderate ({Math.round(confidence * 100)}%) - using a conservative estimate based on similar past events.</span>
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">No assessment available yet.</p>
        )}
      </div>

      {event.description && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Radio / log report</span>
            <Hint text="CityFlow reads the description in any language (including Kannada) and flags words that signal serious disruption - like 'heavy traffic', 'ನಿಧಾನ', 'jam'." />
          </div>
          <p className="text-sm text-slate-200 p-3 rounded-lg bg-slate-950/50 border border-slate-800 leading-relaxed">
            {highlightNLP(event.description, severity?.nlp_flagged_words)}
          </p>
          {severity?.nlp_disruption_prob !== undefined && (
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <span className="text-slate-500">AI read of this report:</span>
              <span className={`font-semibold ${severity.nlp_disruption_prob > 0.5 ? 'text-red-300' : 'text-emerald-300'}`}>
                {Math.round(severity.nlp_disruption_prob * 100)}% likely to disrupt traffic
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
