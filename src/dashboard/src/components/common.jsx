import { useState } from 'react'
import { Icon } from './icons.jsx'

// ── Reusable, self-explanatory UI primitives ──────────────────────────────
// Tones use a 4px left-border accent (Light) / subtle border (Dark) instead
// of a full-tint background, so cards stay calm and data-dense.

export function Card({ children, className = '', tone = 'default', ...rest }) {
  // Light-mode tones follow the Transit Command Center palette
  // (white surfaces + colored 4px left border for severity). Dark mode keeps
  // the original subtle tinting for readability.
  const tones = {
    default: 'bg-white border border-slate-200 shadow-sm dark:bg-slate-900/70 dark:border-slate-800 dark:shadow-none',
    quiet:   'bg-slate-50/70 border border-slate-200/70 dark:bg-slate-900/40 dark:border-slate-800/60',
    soft:    'bg-slate-50 border border-slate-200 dark:bg-slate-800/40 dark:border-slate-700/50',
    accent:  'bg-white border-l-4 border-l-blue-600 border-r border-y border-slate-200 shadow-sm dark:bg-blue-950/30 dark:border-blue-900/60',
    success: 'bg-white border-l-4 border-l-emerald-600 border-r border-y border-slate-200 shadow-sm dark:bg-emerald-950/20 dark:border-emerald-900/50',
    warning: 'bg-white border-l-4 border-l-amber-600 border-r border-y border-slate-200 shadow-sm dark:bg-amber-950/20 dark:border-amber-900/50',
    danger:  'bg-white border-l-4 border-l-rose-600 border-r border-y border-slate-200 shadow-sm dark:bg-rose-950/20 dark:border-rose-900/50',
  }
  return (
    <div className={`rounded-xl ${tones[tone] || tones.default} ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function SectionTitle({ icon: I, title, hint, action }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {I && (
        <span className="text-slate-400 shrink-0 dark:text-slate-500">
          <I width={16} height={16} />
        </span>
      )}
      <h3 className="text-sm font-semibold text-slate-700 tracking-wide uppercase dark:text-slate-200">{title}</h3>
      {hint && <span className="text-[11px] text-slate-500 normal-case font-normal dark:text-slate-400">{hint}</span>}
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
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800"
      >
        <Icon.Info width={12} height={12} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 max-w-xs px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-[11.5px] leading-relaxed text-slate-100 shadow-xl pointer-events-none dark:bg-slate-800 dark:border-slate-700"
        >
          {text}
          <span className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-slate-900 border-r border-b border-slate-700 rotate-45 -mt-1 dark:bg-slate-800" />
        </span>
      )}
    </span>
  )
}

// Severity badges use a small pill with a colored ring — no big tinted blocks.
export function SeverityBadge({ level, large = false, hideLabel = false }) {
  const styles = {
    Green: { bg: 'bg-emerald-50',  text: 'text-emerald-700', ring: 'ring-emerald-600/20', dot: 'bg-emerald-600',  label: 'All clear' },
    Amber: { bg: 'bg-amber-50',    text: 'text-amber-700',   ring: 'ring-amber-600/20',   dot: 'bg-amber-600',    label: 'Heads up' },
    Red:   { bg: 'bg-rose-50',     text: 'text-rose-700',    ring: 'ring-rose-600/20',    dot: 'bg-rose-600',     label: 'Urgent action' },
  }
  const s = styles[level] || { bg: 'bg-slate-50', text: 'text-slate-700', ring: 'ring-slate-500/20', dot: 'bg-slate-500', label: level }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ring-1 font-medium ${s.bg} ${s.text} ${s.ring} ${large ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'} dark:bg-slate-800 dark:text-slate-100`}
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
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium ring-1 ${
        isPlanned
          ? 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950/40 dark:text-violet-300'
          : 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950/40 dark:text-orange-300'
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
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1 dark:text-slate-400">
        <span>{label}</span>
        {hint && <Hint text={hint} />}
      </div>
      <div className={`${big ? 'text-3xl' : 'text-xl'} font-semibold text-slate-900 leading-tight dark:text-slate-50`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">{sub}</div>}
    </div>
  )
}

export function ProgressBar({ value, max = 10, color = 'blue' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const colorMap = {
    blue:    'from-blue-500 to-cyan-400',
    green:   'from-emerald-500 to-green-400',
    amber:   'from-amber-500 to-yellow-400',
    red:     'from-rose-500 to-pink-400',
    slate:   'from-slate-500 to-slate-400',
  }
  return (
    <div className="h-2 rounded-full bg-slate-200 overflow-hidden dark:bg-slate-800">
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
    pending: { dot: 'bg-slate-300 text-slate-600',               ring: 'dark:bg-slate-700 dark:text-slate-400' },
  }
  const s = stateStyles[state] || stateStyles.pending
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${s.dot}`}>
          {state === 'done' ? <Icon.Check width={14} height={14} /> : index}
        </div>
        <div className="w-px flex-1 bg-slate-200 mt-2 dark:bg-slate-800" />
      </div>
      <div className="flex-1 pb-5">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50">{title}</h4>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed mb-3 dark:text-slate-400">{description}</p>
        {children}
      </div>
    </div>
  )
}

export function Spinner({ size = 'md' }) {
  const sizeMap = { sm: 'w-4 h-4 border', md: 'w-5 h-5 border-2', lg: 'w-7 h-7 border-2' }
  return (
    <div className={`${sizeMap[size]} border-slate-300 border-t-blue-600 rounded-full animate-spin dark:border-slate-700 dark:border-t-blue-400`} />
  )
}

export function Empty({ icon: I, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-10">
      {I && (
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3 dark:bg-slate-800 dark:text-slate-500">
          <I width={22} height={22} />
        </div>
      )}
      <p className="text-sm font-medium text-slate-900 mb-1 dark:text-slate-100">{title}</p>
      {hint && <p className="text-xs text-slate-500 max-w-xs leading-relaxed dark:text-slate-400">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function PrimaryButton({ children, onClick, icon: I, className = '', ...rest }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium transition-colors shadow-sm ${className}`}
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
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium border border-slate-200 transition-colors dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-slate-700 ${className}`}
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
      className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 text-xs transition-colors dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 ${className}`}
      {...rest}
    >
      {I && <I width={14} height={14} />}
      {children}
    </button>
  )
}
