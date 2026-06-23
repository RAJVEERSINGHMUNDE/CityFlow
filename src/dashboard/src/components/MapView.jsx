import { useState } from 'react'
import { Icon } from './icons.jsx'
import { Card, SectionTitle, Spinner } from './common.jsx'

const LEGEND = [
  { color: 'bg-red-500',    label: 'Original route (will get stuck)' },
  { color: 'bg-cyan-400',   label: 'AI diversion route' },
  { color: 'bg-orange-500', label: 'Barricade (police checkpoint)' },
  { color: 'bg-red-600',    label: 'Event location' },
]

function MapFrame({ src, label, sublabel, tone }) {
  return (
    <div className="relative flex-1 bg-slate-950 overflow-hidden">
      <div className={`absolute top-3 left-3 z-[400] px-3 py-1.5 rounded-md text-xs font-semibold border shadow-lg ${
        tone === 'red'
          ? 'bg-red-950/90 text-red-200 border-red-800'
          : 'bg-emerald-950/90 text-emerald-200 border-emerald-800'
      }`}>
        {label}
        {sublabel && <div className="text-[10px] font-normal opacity-80 mt-0.5">{sublabel}</div>}
      </div>
      {src ? (
        <iframe src={src} className="w-full h-full border-0" title={label} />
      ) : (
        <div className="flex items-center justify-center h-full text-slate-600 text-xs">Map not available</div>
      )}
    </div>
  )
}

export function MapComparison({ simulation, loading, error, onRetry }) {
  const [tab, setTab] = useState('plan')
  if (loading) {
    return (
      <Card className="flex-1 flex items-center justify-center" tone="default">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="mt-4 text-sm text-slate-300 font-medium">Working out the best routes…</p>
          <p className="mt-1 text-xs text-slate-500">This usually takes 5-15 seconds</p>
        </div>
      </Card>
    )
  }
  if (error) {
    return (
      <Card className="flex-1 flex items-center justify-center" tone="danger">
        <div className="text-center max-w-sm">
          <div className="w-10 h-10 rounded-full bg-red-500/15 text-red-300 flex items-center justify-center mx-auto mb-3">
            <Icon.Alert width={20} height={20} />
          </div>
          <p className="text-sm text-red-200 mb-1 font-medium">Could not calculate the plan</p>
          <p className="text-xs text-slate-400 mb-3">{error}</p>
          {onRetry && (
            <button onClick={onRetry} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-md text-xs">
              Try again
            </button>
          )}
        </div>
      </Card>
    )
  }
  if (!simulation) {
    return (
      <Card className="flex-1 flex items-center justify-center" tone="default">
        <div className="text-center max-w-sm px-6">
          <div className="w-10 h-10 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center mx-auto mb-3">
            <Icon.Map width={20} height={20} />
          </div>
          <p className="text-sm text-slate-300 font-medium">Map will appear here</p>
          <p className="text-xs text-slate-500 mt-1">Pick an event from the left to see the diversion plan.</p>
        </div>
      </Card>
    )
  }

  return (
    <Card className="flex-1 flex flex-col" tone="default">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-3 flex-wrap">
        <SectionTitle
          icon={Icon.Map}
          title="What the plan looks like"
          hint="Two maps side by side. Left: nothing is done. Right: CityFlow's recommended routes and barricades."
        />
        <div className="ml-auto flex gap-1 bg-slate-800/60 rounded-md p-0.5">
          {[
            { id: 'plan',    label: 'Side-by-side' },
            { id: 'active',  label: 'Plan only' },
            { id: 'history', label: 'Past hotspots' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                tab === t.id ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'plan' && (
        <div className="flex-1 flex relative min-h-[400px]">
          <MapFrame
            src={simulation.maps?.baseline_url}
            label="Without action"
            sublabel="What happens if we do nothing"
            tone="red"
          />
          <div className="w-px bg-slate-800 shrink-0" />
          <MapFrame
            src={simulation.maps?.active_url || simulation.map_url}
            label="With CityFlow's plan"
            sublabel="Diversions + barricades"
            tone="green"
          />
        </div>
      )}

      {tab === 'active' && (
        <div className="flex-1 relative min-h-[400px]">
          <MapFrame
            src={simulation.maps?.active_url || simulation.map_url}
            label="Recommended plan"
            tone="green"
          />
        </div>
      )}

      {tab === 'history' && (
        <div className="flex-1 relative min-h-[400px]">
          <iframe src="/maps/hotspot_heatmap.html" className="w-full h-full border-0" title="Historical hotspots" />
        </div>
      )}

      <div className="px-4 py-2.5 border-t border-slate-800 flex items-center gap-4 flex-wrap text-[11px]">
        {LEGEND.map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-sm ${l.color}`} />
            <span className="text-slate-300">{l.label}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
