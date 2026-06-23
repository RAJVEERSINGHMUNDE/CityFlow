import { Icon } from './icons.jsx'
import { Card, SectionTitle, Hint, Spinner } from './common.jsx'

function fmtNum(n, decimals = 1) {
  if (n === null || n === undefined) return '—'
  return typeof n === 'number' ? n.toFixed(decimals) : n
}

function PlanSkeleton() {
  return (
    <Card className="p-5" tone="default">
      <SectionTitle icon={Icon.Shield} title="Recommended plan" />
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Spinner size="sm" />
        <span>Putting the plan together…</span>
      </div>
    </Card>
  )
}

export function ResourcePlan({ simulation }) {
  if (!simulation) return <PlanSkeleton />
  const mp = simulation.manpower_plan
  const mt = simulation.metrics
  if (!mp || !mt) return <PlanSkeleton />

  const validFlows = (simulation.flow_analysis ?? []).filter(f => f.valid_intervention)
  const validBarricades = (simulation.barricade_validation ?? []).filter(b => b.valid)

  return (
    <Card className="p-5" tone="accent">
      <SectionTitle
        icon={Icon.Shield}
        title="Recommended plan"
        hint="A starting point - adjust to local knowledge"
      />

      {/* The "big number" headline */}
      <div className="rounded-lg bg-slate-950/40 border border-slate-800 p-4 mb-4">
        <p className="text-xs text-slate-400 mb-1">With this plan, the average trip through the area is</p>
        <p className="text-3xl font-bold text-emerald-300 leading-tight">
          {fmtNum(mt.total_time_saved_minutes)} min faster
        </p>
        <p className="text-xs text-slate-500 mt-1">
          That's about <strong className="text-slate-300">{fmtNum(mt.average_delay_reduction_pct)}%</strong> less delay per trip
          {validFlows.length > 0 && (
            <> across <strong className="text-slate-300">{validFlows.length}</strong> main traffic route{validFlows.length !== 1 ? 's' : ''}</>
          )}.
        </p>
      </div>

      {/* Resource allocation */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-800">
          <div className="flex items-center gap-1 text-[11px] text-slate-400 mb-1">
            <Icon.People width={11} height={11} />
            <span>Officers</span>
            <Hint text="Number of traffic police to deploy. Calculated from severity, crowd, time of day and whether roads are closed." />
          </div>
          <div className="text-xl font-bold text-slate-100">{mp.total_officers || 0}</div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">{mp.officers_per_barricade || 0} per barricade</div>
        </div>
        <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-800">
          <div className="flex items-center gap-1 text-[11px] text-slate-400 mb-1">
            <Icon.Shield width={11} height={11} />
            <span>Barricades</span>
            <Hint text="Police checkpoints placed before the closed roads. Each one has a safe exit so vehicles can be redirected." />
          </div>
          <div className="text-xl font-bold text-slate-100">{mp.num_barricades || 0}</div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">{validBarricades.length} validated</div>
        </div>
        <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-800">
          <div className="flex items-center gap-1 text-[11px] text-slate-400 mb-1">
            <Icon.Clock width={11} height={11} />
            <span>Shift</span>
            <Hint text="How long the deployment is needed. Clamped between 2 and 8 hours, based on the worst-case clearance estimate." />
          </div>
          <div className="text-xl font-bold text-slate-100">{mp.shift_duration_hours || 0}<span className="text-sm font-normal text-slate-500">h</span></div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">{mp.officer_hours_total || 0} officer-hrs</div>
        </div>
      </div>

      {/* Per-flow breakdown */}
      {(simulation.flow_analysis ?? []).length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider mb-2">Routes protected</div>
          <div className="space-y-1.5">
            {simulation.flow_analysis.map(flow => (
              <div key={flow.flow_id} className="flex items-center gap-2 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${flow.valid_intervention ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <span className="text-slate-300 flex-1">{flow.flow_id}</span>
                {flow.valid_intervention ? (
                  <span className="font-mono text-emerald-300">−{fmtNum(flow.time_saved_minutes)} min</span>
                ) : (
                  <span className="text-slate-500">no better route</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-barricade breakdown */}
      {validBarricades.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider mb-2">Barricade locations</div>
          <div className="space-y-1.5">
            {validBarricades.map((b, i) => (
              <div key={b.node_id} className="flex items-start gap-2 text-xs p-2 rounded-md bg-slate-950/30 border border-slate-800/60">
                <span className="w-5 h-5 rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/30 flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-slate-200 font-mono">
                    {b.lat?.toFixed(4)}, {b.lon?.toFixed(4)}
                  </div>
                  <div className="text-[10.5px] text-slate-500 mt-0.5">{b.reason}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deployment context */}
      {mp.urgency_note && (
        <div className="rounded-lg bg-slate-950/40 border border-slate-800 p-3 flex items-start gap-2">
          <Icon.Lightbulb width={14} height={14} className="text-amber-300 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-300 leading-relaxed">{mp.urgency_note}</p>
        </div>
      )}
    </Card>
  )
}

export function PlanSummary({ simulation }) {
  if (!simulation) return null
  const mt = simulation.metrics
  if (!mt) return null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
        <div className="text-[10.5px] text-slate-500 uppercase tracking-wider mb-1">Roads blocked</div>
        <div className="text-lg font-bold text-slate-100">{mt.closed_edges}</div>
      </div>
      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
        <div className="text-[10.5px] text-slate-500 uppercase tracking-wider mb-1">Spillover zone</div>
        <div className="text-lg font-bold text-slate-100">
          {mt.spillover_radius_m ? `${(mt.spillover_radius_m / 1000).toFixed(1)} km` : '—'}
        </div>
      </div>
      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
        <div className="text-[10.5px] text-slate-500 uppercase tracking-wider mb-1">Diversions set up</div>
        <div className="text-lg font-bold text-slate-100">
          {mt.valid_diversions}<span className="text-slate-500">/{mt.affected_flows}</span>
        </div>
      </div>
      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Time of day</div>
        <div className="text-lg font-bold text-slate-100">{mt.time_of_day_label || '—'}</div>
      </div>
    </div>
  )
}
