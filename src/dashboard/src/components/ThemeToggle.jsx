import { Icon } from './icons.jsx'
import { useTheme } from './useTheme.js'

export function ThemeToggle({ size = 'md' }) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  const dims = size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'
  const iconDims = size === 'sm' ? 14 : 15

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`relative inline-flex items-center justify-center ${dims} rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-400 transition-colors dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:hover:border-slate-600`}
    >
      {isDark
        ? <Icon.Sun    width={iconDims} height={iconDims} />
        : <Icon.Moon   width={iconDims} height={iconDims} />}
    </button>
  )
}
