import { Icon } from './icons.jsx'

export function Onboarding({ onLoadDemo, onCreateCustom, onExploreHotspots, hotspotsCount, eventsCount, error }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 py-10 overflow-y-auto bg-slate-200 dark:bg-slate-950">
      <div className="max-w-3xl w-full">
        <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 ring-1 ring-blue-700/20 text-blue-700 text-xs font-medium mb-4 dark:bg-blue-950/40 dark:text-blue-300">
            <Icon.Sparkle width={12} height={12} />
            Smart traffic planning for Bengaluru
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-3 dark:text-slate-50">
            Welcome to CityFlow
          </h1>
          <p className="text-base text-slate-600 max-w-xl mx-auto leading-relaxed dark:text-slate-300">
            CityFlow helps traffic teams answer three questions before any event: <strong className="text-slate-900 dark:text-slate-50">how bad will it be?</strong> <strong className="text-slate-900 dark:text-slate-50">where should the police go?</strong> and <strong className="text-slate-900 dark:text-slate-50">which routes should drivers take?</strong>
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mb-8">
          {[
            { n: 1, icon: Icon.Map,        title: 'Pick an event',      body: 'Choose from real Bengaluru traffic events on the left, or try a sample.' },
            { n: 2, icon: Icon.Sparkle,    title: 'See the analysis',   body: 'CityFlow estimates severity, time-to-clear, and traffic impact.' },
            { n: 3, icon: Icon.Shield,     title: 'Get the plan',       body: 'A recommended diversion map, barricade spots, and officer count.' },
          ].map(s => (
            <div key={s.n} className="p-4 rounded-xl bg-white ring-1 ring-slate-300 shadow-sm dark:bg-slate-900 dark:ring-slate-800">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-7 h-7 rounded-full bg-blue-50 ring-1 ring-blue-700/20 text-blue-700 flex items-center justify-center text-xs font-semibold dark:bg-blue-950/40 dark:text-blue-300">{s.n}</span>
                <s.icon width={14} height={14} className="text-slate-500 dark:text-slate-400" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mb-1 dark:text-slate-50">{s.title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed dark:text-slate-400">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-white ring-1 ring-slate-300 shadow-sm p-5 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 mb-1 dark:text-slate-50">Try it now</h2>
          <p className="text-xs text-slate-500 mb-4 dark:text-slate-400">No setup required. Pick where to start.</p>
          <div className="grid sm:grid-cols-3 gap-3">
            <button
              onClick={onLoadDemo}
              className="text-left p-4 rounded-lg bg-emerald-50 ring-1 ring-emerald-600/20 hover:bg-emerald-100 transition-colors group dark:bg-emerald-950/30 dark:ring-emerald-900/40 dark:hover:bg-emerald-950/50"
            >
              <div className="w-8 h-8 rounded-md bg-blue-700 text-white flex items-center justify-center mb-2 shadow-sm">
                <Icon.Sparkle width={16} height={16} />
              </div>
              <div className="text-sm font-semibold text-slate-900 mb-1 dark:text-slate-50">Load demo events</div>
              <div className="text-xs text-slate-600 dark:text-slate-400">Three ready-made events covering planned rallies, breakdowns, and radio reports.</div>
            </button>

            <button
              onClick={onCreateCustom}
              className="text-left p-4 rounded-lg bg-violet-50 ring-1 ring-violet-600/20 hover:bg-violet-100 transition-colors group dark:bg-violet-950/30 dark:ring-violet-900/40 dark:hover:bg-violet-950/50"
            >
              <div className="w-8 h-8 rounded-md bg-blue-700 text-white flex items-center justify-center mb-2 shadow-sm">
                <Icon.Plus width={16} height={16} />
              </div>
              <div className="text-sm font-semibold text-slate-900 mb-1 dark:text-slate-50">Create your own</div>
              <div className="text-xs text-slate-600 dark:text-slate-400">Make a what-if event with your own location, crowd size and time.</div>
            </button>

            <button
              onClick={onExploreHotspots}
              className="text-left p-4 rounded-lg bg-amber-50 ring-1 ring-amber-600/20 hover:bg-amber-100 transition-colors group dark:bg-amber-950/30 dark:ring-amber-900/40 dark:hover:bg-amber-950/50"
            >
              <div className="w-8 h-8 rounded-md bg-blue-700 text-white flex items-center justify-center mb-2 shadow-sm">
                <Icon.Pin width={16} height={16} />
              </div>
              <div className="text-sm font-semibold text-slate-900 mb-1 dark:text-slate-50">See past hotspots</div>
              <div className="text-xs text-slate-600 dark:text-slate-400">A heatmap of where Bengaluru has had the most traffic problems in the past.</div>
            </button>
          </div>

          {error && (
            <p className="mt-4 text-xs text-rose-700 bg-rose-50 ring-1 ring-rose-200 rounded-md px-3 py-2 dark:text-rose-200 dark:bg-rose-950/30 dark:ring-rose-900/40">
              {error}
            </p>
          )}
          {!error && eventsCount > 0 && (
            <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
              <strong className="text-slate-700 dark:text-slate-200">{eventsCount}</strong> events available in the left panel. <strong className="text-slate-700 dark:text-slate-200">{hotspotsCount ?? '…'}</strong> historical events in the database.
            </p>
          )}
        </div>

        <div className="mt-6 text-center text-[11px] text-slate-500 dark:text-slate-400">
          Hover over any value with a <Icon.Info width={10} height={10} className="inline -mt-0.5 mx-0.5" /> icon to see what it means.
        </div>
      </div>
    </div>
  )
}
