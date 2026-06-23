import { useState } from 'react'
import { Icon } from './icons.jsx'
import { Card, SectionTitle } from './common.jsx'

export function FeedbackPanel({ event, severity, manpower, onSubmitted, summary }) {
  const [status, setStatus] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    resolution: '',
    officers: '',
    barricades: '',
    severity: severity?.response_level || 'Amber',
    effective: 'yes',
    notes: '',
  })

  if (!event) return null

  const submit = async (e) => {
    e.preventDefault()
    setStatus('')
    setSubmitting(true)
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: event.id,
          actual_resolution_minutes: Number(form.resolution),
          predicted_resolution_minutes: severity?.resolution_minutes,
          actual_officers: Number(form.officers),
          recommended_officers: manpower?.total_officers,
          actual_barricades: Number(form.barricades),
          recommended_barricades: manpower?.num_barricades,
          observed_severity: form.severity,
          diversion_effective: form.effective === 'yes',
          notes: form.notes,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Could not save outcome')
      const total = data.summary?.total_outcomes
      setStatus(`Saved. ${total ?? ''} total outcome${total === 1 ? '' : 's'} recorded so far.`)
      onSubmitted?.(data.summary)
      setForm(f => ({ ...f, resolution: '', officers: '', barricades: '', notes: '' }))
    } catch (error) {
      setStatus(`Could not save: ${error.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-5" tone="quiet">
      <SectionTitle
        icon={Icon.Check}
        title="After the event: log what happened"
        hint="This helps CityFlow learn and improve future recommendations"
      />
      <p className="text-xs text-slate-400 leading-relaxed mb-4">
        Once the event is over and you know the actual numbers, fill this in. The system compares your answer to its prediction and
        adjusts future plans.
      </p>

      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">How long did it actually take? (min)</label>
            <input
              required type="number" min="1" value={form.resolution}
              onChange={e => setForm({ ...form, resolution: e.target.value })}
              className="form-control"
              placeholder={severity?.resolution_minutes ? `Predicted: ${severity.resolution_minutes}` : '120'}
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">How serious was it really?</label>
            <select
              value={form.severity}
              onChange={e => setForm({ ...form, severity: e.target.value })}
              className="form-control"
            >
              <option value="Green">Green - no big deal</option>
              <option value="Amber">Amber - some disruption</option>
              <option value="Red">Red - serious</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Officers actually used</label>
            <input
              required type="number" min="0" value={form.officers}
              onChange={e => setForm({ ...form, officers: e.target.value })}
              className="form-control"
              placeholder={manpower?.total_officers ? `Recommended: ${manpower.total_officers}` : '20'}
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Barricades actually used</label>
            <input
              required type="number" min="0" value={form.barricades}
              onChange={e => setForm({ ...form, barricades: e.target.value })}
              className="form-control"
              placeholder={manpower?.num_barricades ? `Recommended: ${manpower.num_barricades}` : '5'}
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Did the diversion plan work?</label>
          <div className="grid grid-cols-2 gap-2">
            <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
              form.effective === 'yes' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200' : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}>
              <input type="radio" name="effective" value="yes" checked={form.effective === 'yes'} onChange={e => setForm({ ...form, effective: e.target.value })} />
              <span className="text-sm">Yes, traffic flowed well</span>
            </label>
            <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
              form.effective === 'no' ? 'bg-red-500/10 border-red-500/40 text-red-200' : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}>
              <input type="radio" name="effective" value="no" checked={form.effective === 'no'} onChange={e => setForm({ ...form, effective: e.target.value })} />
              <span className="text-sm">No, it caused more jams</span>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Anything else worth remembering? <span className="text-slate-600">(optional)</span></label>
          <input
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            className="form-control"
            placeholder="e.g. VIP convoy arrived late, local cops were already there"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium"
          >
            <Icon.Check width={14} height={14} />
            {submitting ? 'Saving…' : 'Save outcome'}
          </button>
          {summary?.total_outcomes > 0 && (
            <span className="text-[11px] text-slate-500">
              {summary.total_outcomes} outcome{summary.total_outcomes === 1 ? '' : 's'} on file
              {summary.diversion_success_rate != null && (
                <> • {summary.diversion_success_rate}% diversion success</>
              )}
            </span>
          )}
        </div>

        {status && (
          <p className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-900/50 rounded-md px-3 py-2">
            {status}
          </p>
        )}
      </form>
    </Card>
  )
}
