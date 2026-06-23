import { Icon } from './icons.jsx'

export function Onboarding({ onLoadDemo, onCreateCustom, onExploreHotspots, hotspotsCount, eventsCount, error }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 py-10 overflow-y-auto">
      <div className="max-w-3xl w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-medium mb-4">
            <Icon.Sparkle width={12} height={12} />
            Smart traffic planning for Bengaluru
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-100 tracking-tight mb-3">
            Welcome to CityFlow
          </h1>
          <p className="text-base text-slate-400 max-w-xl mx-auto leading-relaxed">
            CityFlow helps traffic teams answer three questions before any event: <strong className="text-slate-200">how bad will it be?</strong> <strong className="text-slate-200">where should the police go?</strong> and <strong className="text-slate-200">which routes should drivers take?</strong>
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mb-8">
          {[
            { n: 1, icon: Icon.Map,        title: 'Pick an event',      body: 'Choose from real Bengaluru traffic events on the left, or try a sample.' },
            { n: 2, icon: Icon.Sparkle,    title: 'See the analysis',   body: 'CityFlow estimates severity, time-to-clear, and traffic impact.' },
            { n: 3, icon: Icon.Shield,     title: 'Get the plan',       body: 'A recommended diversion map, barricade spots, and officer count.' },
          ].map(s => (
            <div key={s.n} className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-7 h-7 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 flex items-center justify-center text-xs font-semibold">{s.n}</span>
                <s.icon width={14} height={14} className="text-slate-400" />
              </div>
              <h3 className="text-sm font-semibold text-slate-100 mb-1">{s.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-1">Try it now</h2>
          <p className="text-xs text-slate-500 mb-4">No setup required. Pick where to start.</p>
          <div className="grid sm:grid-cols-3 gap-3">
            <button
              onClick={onLoadDemo}
              className="text-left p-4 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-blue-500/50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-md bg-emerald-500/15 text-emerald-300 flex items-center justify-center mb-2">
                <Icon.Sparkle width={16} height={16} />
              </div>
              <div className="text-sm font-semibold text-slate-100 mb-1">Load demo events</div>
              <div className="text-xs text-slate-400">Three ready-made events covering planned rallies, breakdowns, and radio reports.</div>
            </button>

            <button
              onClick={onCreateCustom}
              className="text-left p-4 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-blue-500/50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-md bg-violet-500/15 text-violet-300 flex items-center justify-center mb-2">
                <Icon.Plus width={16} height={16} />
              </div>
              <div className="text-sm font-semibold text-slate-100 mb-1">Create your own</div>
              <div className="text-xs text-slate-400">Make a what-if event with your own location, crowd size and time.</div>
            </button>

            <button
              onClick={onExploreHotspots}
              className="text-left p-4 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-blue-500/50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-md bg-amber-500/15 text-amber-300 flex items-center justify-center mb-2">
                <Icon.Pin width={16} height={16} />
              </div>
              <div className="text-sm font-semibold text-slate-100 mb-1">See past hotspots</div>
              <div className="text-xs text-slate-400">A heatmap of where Bengaluru has had the most traffic problems in the past.</div>
            </button>
          </div>

          {error && (
            <p className="mt-4 text-xs text-red-300 bg-red-950/40 border border-red-900/50 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          {!error && eventsCount > 0 && (
            <p className="mt-4 text-[11px] text-slate-500">
              <strong className="text-slate-400">{eventsCount}</strong> events available in the left panel. <strong className="text-slate-400">{hotspotsCount ?? '…'}</strong> historical events in the database.
            </p>
          )}
        </div>

        <div className="mt-6 text-center text-[11px] text-slate-500">
          Hover over any value with a <Icon.Info width={10} height={10} className="inline -mt-0.5 mx-0.5" /> icon to see what it means.
        </div>
      </div>
    </div>
  )
}
