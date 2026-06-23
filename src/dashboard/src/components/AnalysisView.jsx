import { Icon } from './icons.jsx'
import { Card } from './common.jsx'
import { SituationCard } from './SituationCard.jsx'
import { MapComparison } from './MapView.jsx'
import { ImpactAssessment } from './ImpactAssessment.jsx'
import { ResourcePlan, PlanSummary } from './Plan.jsx'
import { FeedbackPanel } from './FeedbackPanel.jsx'
import { useState } from 'react'

export function AnalysisView({
  event, severity, severityLoading,
  simulation, simLoading, simError, onRetrySim,
  onFeedbackSubmitted, feedbackSummary,
}) {
  const [view, setView] = useState('story') // 'story' | 'plan'

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      <div className="px-5 py-3 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center gap-2 shrink-0 dark:border-slate-800 dark:bg-slate-900/80">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Analysis for: <span className="text-blue-700 dark:text-blue-300">{event.cause}</span></h2>
        <span className="text-slate-300 mx-1 dark:text-slate-600">•</span>
        <div className="flex gap-1 ml-auto bg-slate-100 rounded-md p-0.5 dark:bg-slate-800">
          {[
            { id: 'story', label: 'Story view', icon: Icon.Book },
            { id: 'plan',  label: 'Plan view',  icon: Icon.Shield },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded transition-colors ${
                view === t.id ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-50' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              <t.icon width={12} height={12} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
        {view === 'story' ? (
          <div className="max-w-3xl mx-auto space-y-5">
            <StepCard n={1} icon={Icon.Flag}    title="What is happening"
              body="A quick look at the event itself, and CityFlow's first read on how serious it will be.">
              <SituationCard event={event} severity={severity} severityLoading={severityLoading} />
            </StepCard>

            <StepCard n={2} icon={Icon.Sparkle} title="How bad is it?"
              body="A breakdown of the impact: how long it will last, how many people will be delayed, and the congestion it will cause.">
              <ImpactAssessment severity={severity} loading={severityLoading} />
            </StepCard>

            <StepCard n={3} icon={Icon.Map}     title="What does the city look like during this?"
              body="Two maps side by side. The left shows what happens if we do nothing. The right shows CityFlow's recommended routes and barricades.">
              <MapComparison simulation={simulation} loading={simLoading} error={simError} onRetry={onRetrySim} />
            </StepCard>

            <StepCard n={4} icon={Icon.Shield}  title="What does CityFlow recommend?"
              body="A concrete plan: officers, barricades, shift length, and how much faster traffic will flow.">
              <ResourcePlan simulation={simulation} />
              {simulation && (
                <div className="mt-3">
                  <PlanSummary simulation={simulation} />
                </div>
              )}
            </StepCard>

            <StepCard n={5} icon={Icon.Check}   title="After it ends: tell CityFlow what really happened"
              body="Logging the actual outcome is the most important step. It is how the next prediction becomes more accurate than this one.">
              <FeedbackPanel
                event={event}
                severity={severity}
                manpower={simulation?.manpower_plan}
                onSubmitted={onFeedbackSubmitted}
                summary={feedbackSummary}
              />
            </StepCard>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-5">
            <Card className="p-5" tone="default">
              <MapComparison simulation={simulation} loading={simLoading} error={simError} onRetry={onRetrySim} />
            </Card>
            <ResourcePlan simulation={simulation} />
            {simulation && <PlanSummary simulation={simulation} />}
          </div>
        )}
      </div>
    </div>
  )
}

function StepCard({ n, icon: I, title, body, children }) {
  return (
    <div className="relative pl-12">
      <div className="absolute left-0 top-0 w-9 h-9 rounded-full bg-blue-50 ring-2 ring-blue-600/30 text-blue-700 flex items-center justify-center text-sm font-semibold dark:bg-blue-950/40 dark:text-blue-300">
        {n}
      </div>
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <I width={16} height={16} className="text-slate-500 dark:text-slate-400" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">{title}</h3>
        </div>
        <p className="text-sm text-slate-500 leading-relaxed dark:text-slate-400">{body}</p>
      </div>
      {children}
    </div>
  )
}
