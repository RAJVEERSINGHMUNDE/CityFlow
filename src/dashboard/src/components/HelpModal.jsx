import { useState } from 'react'
import { Icon } from './icons.jsx'
import { SecondaryButton } from './common.jsx'

// Plain-language glossary accessible from anywhere via the help button.
const GLOSSARY = [
  {
    icon: Icon.Alert,
    title: 'Severity level',
    short: 'How bad the disruption is.',
    body: 'Three levels: Green = no big deal, traffic can cope. Amber = traffic is being affected, action needed. Red = serious gridlock, full response required.',
  },
  {
    icon: Icon.Clock,
    title: 'Expected resolution time',
    short: 'How long this event will keep disrupting traffic.',
    body: 'An estimate (in minutes) of how long until the situation clears on its own. Computed from past similar events in the same area.',
  },
  {
    icon: Icon.Route,
    title: 'Diversion route',
    short: 'A better way to drive around the problem.',
    body: 'A new driving route that avoids the closed roads. CityFlow finds these by computing thousands of possible paths and picking the fastest, most reliable one.',
  },
  {
    icon: Icon.Shield,
    title: 'Barricade',
    short: 'A police checkpoint that blocks traffic from entering the closed area.',
    body: 'Placed at intersections before the closure so vehicles can take the diversion route instead of getting stuck.',
  },
  {
    icon: Icon.People,
    title: 'Officers deployed',
    short: 'How many traffic police are needed to manage the situation.',
    body: 'Calculated from severity, expected crowd size, time of day, and whether roads are closed. This is a recommendation - the actual deployment can be adjusted.',
  },
  {
    icon: Icon.Layers,
    title: 'Affected traffic flows',
    short: 'The main driving routes that get blocked by this event.',
    body: 'CityFlow looks at the area and picks the most important driving routes that pass through the problem. Up to three flows are analysed at a time.',
  },
  {
    icon: Icon.Bolt,
    title: 'Time saved',
    short: 'How much faster traffic moves with the diversion plan.',
    body: 'Compared to doing nothing. If the number is 15 minutes, that means the average trip through this area is 15 minutes quicker thanks to the diversions.',
  },
  {
    icon: Icon.Volume,
    title: 'Affected vehicles',
    short: 'How many vehicles are likely to be caught in this disruption.',
    body: 'An estimate of the number of cars, bikes and trucks that will be affected while the event is happening.',
  },
  {
    icon: Icon.Globe,
    title: 'Person-delay minutes',
    short: 'The total "lost time" for everyone stuck in traffic.',
    body: 'If 1,000 people each wait 10 extra minutes, that is 10,000 person-delay minutes. This number tells you the human cost of the disruption.',
  },
  {
    icon: Icon.Pin,
    title: 'Historical hotspots',
    short: 'Places in the city where events like this have happened before.',
    body: 'A map showing which junctions and areas have had the most traffic problems in the past. Useful for planning where to keep extra resources.',
  },
]

const FAQ = [
  {
    q: 'Where does the prediction come from?',
    a: 'CityFlow uses machine learning trained on thousands of past Bengaluru traffic events. The model learned patterns: what time of day, what location, what type of event leads to what kind of disruption.',
  },
  {
    q: 'How accurate is it?',
    a: 'The severity model gets it right about 60% of the time on its main ranking, and explains roughly 40% of why some events are worse than others. The diversion plan uses real road-network data so the routes are exact - only the impact estimates have uncertainty.',
  },
  {
    q: 'Can I trust the recommendations?',
    a: 'The routes and barricade placements come from real graph algorithms on real road data. The officer count is a starting point, calibrated from past events - it should be adjusted based on local knowledge. After every event, recording what actually happened helps CityFlow learn and improve.',
  },
  {
    q: 'What if the event is a "what-if" I made up?',
    a: 'That works fine. Click "+ Custom" in the left panel to create a hypothetical event with your own location, time, attendance and description. CityFlow treats it like a real event.',
  },
  {
    q: 'What is the "demo" button for?',
    a: 'It loads three pre-made events that showcase different scenarios: a big planned cricket match, a truck breakdown, and a multilingual radio report. Great for seeing the full range of what CityFlow can do in under a minute.',
  },
]

export function HelpModal({ open, onClose }) {
  const [tab, setTab] = useState('glossary')
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-300">
              <Icon.Book width={18} height={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">Help & Glossary</h2>
              <p className="text-xs text-slate-500">Plain-language explanations of every term used here</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100 p-1.5 rounded-md hover:bg-slate-800">
            <Icon.Close width={18} height={18} />
          </button>
        </div>

        <div className="flex border-b border-slate-800 px-6">
          {['glossary', 'faq', 'about'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t ? 'border-blue-400 text-blue-300' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t === 'faq' ? 'FAQ' : t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === 'glossary' && (
            <div className="grid sm:grid-cols-2 gap-3">
              {GLOSSARY.map(g => (
                <div key={g.title} className="p-4 rounded-lg bg-slate-800/40 border border-slate-700/50">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-blue-300">
                      <g.icon width={16} height={16} />
                    </span>
                    <h3 className="text-sm font-semibold text-slate-100">{g.title}</h3>
                  </div>
                  <p className="text-xs text-slate-300 mb-1.5 font-medium">{g.short}</p>
                  <p className="text-xs text-slate-400 leading-relaxed">{g.body}</p>
                </div>
              ))}
            </div>
          )}

          {tab === 'faq' && (
            <div className="space-y-3">
              {FAQ.map(f => (
                <div key={f.q} className="p-4 rounded-lg bg-slate-800/40 border border-slate-700/50">
                  <h3 className="text-sm font-semibold text-slate-100 mb-1.5 flex items-center gap-2">
                    <Icon.Help width={14} height={14} className="text-blue-300" />
                    {f.q}
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{f.a}</p>
                </div>
              ))}
            </div>
          )}

          {tab === 'about' && (
            <div className="prose prose-invert max-w-none text-slate-300 text-sm leading-relaxed space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-100 mb-2">What is CityFlow?</h3>
                <p>
                  CityFlow is a decision-support tool for traffic operations teams. It answers three questions
                  before, during, and after traffic events:
                </p>
                <ol className="list-decimal list-inside space-y-1 mt-2 text-slate-400 text-sm">
                  <li><strong className="text-slate-200">What is going to happen?</strong> &mdash; Predicts how bad the disruption will be.</li>
                  <li><strong className="text-slate-200">What should we do about it?</strong> &mdash; Recommends diversion routes, barricade placements, and police deployment.</li>
                  <li><strong className="text-slate-200">Did it work?</strong> &mdash; Learns from every past event to improve future predictions.</li>
                </ol>
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-100 mb-2">How to use this dashboard</h3>
                <ol className="list-decimal list-inside space-y-1 text-slate-400 text-sm">
                  <li>Pick an event from the list on the left, or click <em>Load Demo</em> to try a sample.</li>
                  <li>CityFlow analyses it and shows a side-by-side map: what happens by itself vs. what happens with the recommended plan.</li>
                  <li>Read the right panel for severity, time estimates, recommended officers and barricades.</li>
                  <li>After the real event, log what actually happened so the next prediction is better.</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-800 flex items-center justify-between">
          <p className="text-[11px] text-slate-500">Tip: hover over any value with a small <Icon.Info width={10} height={10} className="inline -mt-0.5" /> icon to see what it means.</p>
          <SecondaryButton onClick={onClose}>Got it</SecondaryButton>
        </div>
      </div>
    </div>
  )
}
