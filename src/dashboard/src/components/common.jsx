import { useState } from 'react'
import { Icon } from './icons.jsx'

// ── Reusable, self-explanatory UI primitives ──────────────────────────────────

export function Card({ children, className = '', tone = 'default', ...rest }) {
  const tones = {
    default: 'bg-slate-900/70 border-slate-800',
    quiet:   'bg-slate-900/40 border-slate-800/60',
    soft:    'bg-slate-800/40 border-slate-700/50',
    accent:  'bg-blue-950/40 border-blue-900/60',
    success: 'bg-emerald-950/30 border-emerald-900/50',
    warning: 'bg-amber-950/30 border-amber-900/50',
    danger:  'bg-red-950/30 border-red-900/50',
  }
  return (
    <div className={`rounded-xl border ${tones[tone] || tones.default} ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function SectionTitle({ icon: I, title, hint, action }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {I && (
        <span className="text-slate-400 shrink-0">
          <I width={16} height={16} />
        </span>
      )}
      <h3 className="text-sm font-semibold text-slate-200 tracking-wide uppercase">{title}</h3>
      {hint && <span className="text-[11px] text-slate-500 normal-case font-normal">{hint}</span>}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  )
}

export function Hint({ text, className = '' }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(v => !v)}
        aria-label="What does this mean?"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
      >
        <Icon.Info width={12} height={12} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 max-w-xs px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-[11.5px] leading-relaxed text-slate-200 shadow-xl pointer-events-none"
        >
          {text}
          <span className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-slate-800 border-r border-b border-slate-700 rotate-45 -mt-1" />
        </span>
      )}
    </span>
  )
}

// Severity badges use plain-language color cues with a friendly label
export function SeverityBadge({ level, large = false, hideLabel = false }) {
  const styles = {
    Green: { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/40', dot: 'bg-emerald-400', label: 'All clear' },
    Amber: { bg: 'bg-amber-500/15',  text: 'text-amber-300',   border: 'border-amber-500/40',   dot: 'bg-amber-400',   label: 'Heads up' },
    Red:   { bg: 'bg-red-500/15',    text: 'text-red-300',     border: 'border-red-500/40',     dot: 'bg-red-400',     label: 'Urgent action' },
  }
  const s = styles[level] || { bg: 'bg-slate-500/15', text: 'text-slate-300', border: 'border-slate-500/40', dot: 'bg-slate-400', label: level }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${s.bg} ${s.text} ${s.border} ${large ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {hideLabel ? level : s.label}
    </span>
  )
}

export function EventTypeBadge({ type }) {
  const isPlanned = type === 'planned'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium border ${
        isPlanned
          ? 'bg-violet-500/10 text-violet-300 border-violet-500/30'
          : 'bg-orange-500/10 text-orange-300 border-orange-500/30'
      }`}
    >
      <Icon.Calendar width={11} height={11} />
      {isPlanned ? 'Planned' : 'Unplanned'}
    </span>
  )
}

export function Stat({ label, value, sub, hint, big = false }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1">
        <span>{label}</span>
        {hint && <Hint text={hint} />}
      </div>
      <div className={`${big ? 'text-3xl' : 'text-xl'} font-semibold text-slate-100 leading-tight`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

export function ProgressBar({ value, max = 10, color = 'blue' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const colorMap = {
    blue:    'from-blue-500 to-cyan-400',
    green:   'from-emerald-500 to-green-400',
    amber:   'from-amber-500 to-yellow-400',
    red:     'from-red-500 to-rose-400',
    slate:   'from-slate-500 to-slate-400',
  }
  return (
    <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
      <div
        className={`h-full rounded-full bg-gradient-to-r ${colorMap[color] || colorMap.blue} transition-all duration-700`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function Step({ index, title, description, state = 'done', children }) {
  const stateStyles = {
    done:    { dot: 'bg-emerald-500 text-white',                ring: 'ring-emerald-500/30' },
    active:  { dot: 'bg-blue-500 text-white ring-4 ring-blue-500/30 animate-pulse', ring: '' },
    pending: { dot: 'bg-slate-700 text-slate-400',               ring: '' },
  }
  const s = stateStyles[state] || stateStyles.pending
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${s.dot}`}>
          {state === 'done' ? <Icon.Check width={14} height={14} /> : index}
        </div>
        <div className="w-px flex-1 bg-slate-800 mt-2" />
      </div>
      <div className="flex-1 pb-5">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="text-sm font-semibold text-slate-100">{title}</h4>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed mb-3">{description}</p>
        {children}
      </div>
    </div>
  )
}

export function Spinner({ size = 'md' }) {
  const sizeMap = { sm: 'w-4 h-4 border', md: 'w-5 h-5 border-2', lg: 'w-7 h-7 border-2' }
  return (
    <div className={`${sizeMap[size]} border-slate-600 border-t-transparent rounded-full animate-spin`} />
  )
}

export function Empty({ icon: I, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-10">
      {I && (
        <div className="w-12 h-12 rounded-full bg-slate-800/60 flex items-center justify-center text-slate-400 mb-3">
          <I width={22} height={22} />
        </div>
      )}
      <p className="text-sm font-medium text-slate-200 mb-1">{title}</p>
      {hint && <p className="text-xs text-slate-500 max-w-xs leading-relaxed">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function PrimaryButton({ children, onClick, icon: I, className = '', ...rest }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-medium transition-colors shadow-sm ${className}`}
      {...rest}
    >
      {I && <I width={16} height={16} />}
      {children}
    </button>
  )
}

export function SecondaryButton({ children, onClick, icon: I, className = '', ...rest }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-medium border border-slate-700 transition-colors ${className}`}
      {...rest}
    >
      {I && <I width={16} height={16} />}
      {children}
    </button>
  )
}

export function GhostButton({ children, onClick, icon: I, className = '', ...rest }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-md text-slate-300 hover:text-slate-100 hover:bg-slate-800 text-xs transition-colors ${className}`}
      {...rest}
    >
      {I && <I width={14} height={14} />}
      {children}
    </button>
  )
}
