import { useState } from 'react'
import { Icon } from './icons.jsx'
import { Card, EventTypeBadge } from './common.jsx'

function fmtDateTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
  } catch { return iso }
}

function EventCard({ event, selected, onClick }) {
  const isCustom = event.source === 'operator_scenario'
  const isUnplanned = event.event_type === 'unplanned'
  return (
    <button
      onClick={() => onClick(event)}
      className={`w-full text-left p-3 transition-colors ${
        selected
          ? 'bg-blue-50/70 dark:bg-blue-950/30'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
      }`}
    >
      <div className="flex items-start gap-2 mb-1.5">
        <span className={`w-7 h-7 rounded-md shrink-0 flex items-center justify-center ring-1 ${
          isUnplanned
            ? 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950/40 dark:text-orange-300'
            : 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950/40 dark:text-violet-300'
        }`}>
          {isUnplanned ? <Icon.Alert width={14} height={14} /> : <Icon.Calendar width={14} height={14} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-900 leading-tight truncate dark:text-slate-50">{event.cause}</div>
          <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">{fmtDateTime(event.time)}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <EventTypeBadge type={event.event_type} />
        {event.requires_closure && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium ring-1 bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300">
            <Icon.Flag width={11} height={11} />
            Closure
          </span>
        )}
        {isCustom && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium ring-1 bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300">
            Custom
          </span>
        )}
      </div>
      {event.expected_attendance > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <Icon.People width={11} height={11} className="text-slate-400 dark:text-slate-500" />
          <span>~{Number(event.expected_attendance).toLocaleString()} expected</span>
        </div>
      )}
    </button>
  )
}

const INITIAL_SCENARIO = {
  cause: 'Political Rally', latitude: '12.9716', longitude: '77.5946',
  event_type: 'planned', start_time: '2026-06-22T10:00', expected_attendance: '5000',
  expected_duration_hours: '4', closure_severity: 'full', requires_closure: true,
  roads_affected: 'Major approaches near the event location',
}

export function ScenarioForm({ onSubmit, onCancel, error }) {
  const [form, setForm] = useState(INITIAL_SCENARIO)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = (e) => {
    e.preventDefault()
    onSubmit({
      ...form,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      expected_attendance: Number(form.expected_attendance),
      expected_duration_hours: Number(form.expected_duration_hours),
    })
  }

  return (
    <form onSubmit={submit} className="p-4 border-b border-slate-300 bg-white space-y-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Create a what-if event</h3>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          <Icon.Close width={14} height={14} />
        </button>
      </div>
      <p className="text-[11px] text-slate-500 -mt-1 mb-1 dark:text-slate-400">Test how CityFlow would plan for an event that has not happened yet.</p>

      <div>
        <label className="block text-[11px] text-slate-600 mb-1 dark:text-slate-400">What is happening? <span className="text-slate-400 dark:text-slate-500">(name)</span></label>
        <input
          required value={form.cause}
          onChange={e => set('cause', e.target.value)}
          className="form-control" placeholder="e.g. Marathon, protest, concert"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-slate-600 mb-1 dark:text-slate-400">Latitude</label>
          <input required type="number" step="any" value={form.latitude}
            onChange={e => set('latitude', e.target.value)}
            className="form-control" placeholder="12.97" />
        </div>
        <div>
          <label className="block text-[11px] text-slate-600 mb-1 dark:text-slate-400">Longitude</label>
          <input required type="number" step="any" value={form.longitude}
            onChange={e => set('longitude', e.target.value)}
            className="form-control" placeholder="77.59" />
        </div>
      </div>

      <div>
        <label className="block text-[11px] text-slate-600 mb-1 dark:text-slate-400">When does it start?</label>
        <input required type="datetime-local" value={form.start_time}
          onChange={e => set('start_time', e.target.value)} className="form-control" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-slate-600 mb-1 dark:text-slate-400">Event type</label>
          <select value={form.event_type} onChange={e => set('event_type', e.target.value)} className="form-control">
            <option value="planned">Planned (announced)</option>
            <option value="unplanned">Unplanned (sudden)</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-slate-600 mb-1 dark:text-slate-400">Road impact</label>
          <select value={form.closure_severity} onChange={e => set('closure_severity', e.target.value)} className="form-control">
            <option value="partial">Partial closure</option>
            <option value="full">Full closure</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-slate-600 mb-1 dark:text-slate-400">Expected crowd</label>
          <input required min="0" type="number" value={form.expected_attendance}
            onChange={e => set('expected_attendance', e.target.value)}
            className="form-control" placeholder="5000" />
        </div>
        <div>
          <label className="block text-[11px] text-slate-600 mb-1 dark:text-slate-400">Duration (hours)</label>
          <input required min="0.5" step="0.5" type="number" value={form.expected_duration_hours}
            onChange={e => set('expected_duration_hours', e.target.value)}
            className="form-control" placeholder="4" />
        </div>
      </div>

      <div>
        <label className="block text-[11px] text-slate-600 mb-1 dark:text-slate-400">Roads affected <span className="text-slate-400 dark:text-slate-500">(optional)</span></label>
        <input value={form.roads_affected}
          onChange={e => set('roads_affected', e.target.value)}
          className="form-control" placeholder="e.g. MG Road, Cubbon Park" />
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={form.requires_closure}
          onChange={e => set('requires_closure', e.target.checked)} className="rounded" />
        Roads will need to be closed
      </label>

      {error && <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1.5 dark:text-rose-300 dark:bg-rose-950/30 dark:border-rose-900/60">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium shadow-sm">
          <Icon.Sparkle width={14} height={14} />
          Create &amp; plan
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-sm border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700">
          Cancel
        </button>
      </div>
    </form>
  )
}

export function EventList({
  events, error, loading, selectedId, onSelect,
  onLoadDemo, onCreateCustom, showForm, onCloseForm, onSubmitForm, formError,
}) {
  return (
    <Card className="flex flex-col h-full rounded-none border-y-0 border-l-0 border-r border-slate-200/0 shadow-none dark:border-slate-800/0" tone="quiet">
      <div className="px-4 py-3 border-b border-slate-200 shrink-0 dark:border-slate-800">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Events</h2>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">{events.length} total</span>
        </div>
        <p className="text-[11px] text-slate-500 mb-3 dark:text-slate-400">Pick an event to plan for. Each card is a real Bengaluru traffic event.</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onLoadDemo}
            className="px-2.5 py-1.5 rounded-md bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 inline-flex items-center justify-center gap-1.5 shadow-sm"
          >
            <Icon.Sparkle width={12} height={12} />
            Load demo
          </button>
          <button
            onClick={onCreateCustom}
            className="px-2.5 py-1.5 rounded-md bg-white text-slate-700 border border-slate-300 text-[11px] font-medium hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700"
          >
            <Icon.Plus width={12} height={12} />
            {showForm ? 'Cancel' : 'New event'}
          </button>
        </div>
      </div>

      {showForm && (
        <ScenarioForm onSubmit={onSubmitForm} onCancel={onCloseForm} error={formError} />
      )}

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 custom-scrollbar dark:divide-slate-800">
        {error ? (
          <div className="p-3 text-center text-rose-700 text-xs bg-rose-50 border-b border-rose-200 dark:text-rose-300 dark:bg-rose-950/30 dark:border-rose-900/60">
            {error}
            <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">Is the API running on port 8000?</div>
          </div>
        ) : loading ? (
          <div className="p-3 text-center text-slate-500 text-xs dark:text-slate-400">Loading events…</div>
        ) : events.length === 0 ? (
          <div className="p-3 text-center text-slate-500 text-xs dark:text-slate-400">No events yet. Try "Load demo" or create one.</div>
        ) : events.map(ev => (
          <EventCard key={ev.id} event={ev} selected={selectedId === ev.id} onClick={onSelect} />
        ))}
      </div>
    </Card>
  )
}
