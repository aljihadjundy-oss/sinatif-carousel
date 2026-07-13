'use client'

import { useState } from 'react'
import { SlideOverride } from '@/lib/slideDesign'
import { TextDensity } from './DesignOptionsPanel'

const TEXT_DENSITY_OPTIONS: { value: TextDensity; label: string }[] = [
  { value: 'concise', label: 'Concise' },
  { value: 'standard', label: 'Standard' },
  { value: 'detailed', label: 'Detailed' },
]

const DEFAULT_OPTION_VALUE = ''

interface Props {
  slideIndex: number
  override: SlideOverride | undefined
  brandColors: Record<string, string> | null
  onChange: (override: SlideOverride | undefined) => void
  disabled?: boolean
}

// Inline per-slide override editor — rendered below each slide thumbnail
// (see DesignWorkspace.tsx). Collapsed by default so the slide grid isn't
// dominated by controls most slides will never need; a slide with an
// active override gets a "Custom" badge on its thumbnail (also in
// DesignWorkspace.tsx) so it's visible even collapsed.
export default function SlideCustomizeControl({
  slideIndex,
  override,
  brandColors,
  onChange,
  disabled = false,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const hasOverride = !!override

  function handleColorSchemeChange(value: string) {
    const next: SlideOverride = { ...override, slideIndex }
    if (value === DEFAULT_OPTION_VALUE) {
      delete next.colorScheme
    } else {
      next.colorScheme = value
    }
    onChange(next.colorScheme || next.textDensity ? next : undefined)
  }

  function handleTextDensityChange(value: string) {
    const next: SlideOverride = { ...override, slideIndex }
    if (value === DEFAULT_OPTION_VALUE) {
      delete next.textDensity
    } else {
      next.textDensity = value as TextDensity
    }
    onChange(next.colorScheme || next.textDensity ? next : undefined)
  }

  function handleReset() {
    onChange(undefined)
    setExpanded(false)
  }

  return (
    <div className="mt-1.5 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50"
      >
        <span>Customize Slide {slideIndex}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-1.5 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
          {/* Bug found via live data: a real post's brand had no
              visual_style at all (visual_style: null), so this select
              rendered with nothing but the no-op "Sama seperti default"
              option — selecting a color scheme was silently impossible,
              not broken merge/render logic. DesignOptionsPanel's
              post-level Color Scheme control already guards the same way
              (hides the whole block rather than rendering an empty
              select); this now matches it instead of misleadingly
              implying the control works when there's no palette to
              choose from. */}
          {brandColors && Object.keys(brandColors).length > 0 ? (
            <div>
              <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">
                Color Scheme
              </label>
              <select
                value={override?.colorScheme ?? DEFAULT_OPTION_VALUE}
                onChange={(e) => handleColorSchemeChange(e.target.value)}
                disabled={disabled}
                className="w-full rounded border border-gray-300 px-1.5 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
              >
                <option value={DEFAULT_OPTION_VALUE}>Sama seperti default</option>
                {Object.keys(brandColors).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              Brand ini belum punya palet warna, jadi color scheme tidak bisa di-override.
            </p>
          )}

          <div>
            <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">
              Text Density
            </label>
            <select
              value={override?.textDensity ?? DEFAULT_OPTION_VALUE}
              onChange={(e) => handleTextDensityChange(e.target.value)}
              disabled={disabled}
              className="w-full rounded border border-gray-300 px-1.5 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
            >
              <option value={DEFAULT_OPTION_VALUE}>Sama seperti default</option>
              {TEXT_DENSITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {hasOverride && (
            <button
              type="button"
              onClick={handleReset}
              disabled={disabled}
              className="text-[11px] text-blue-600 hover:underline dark:text-blue-400 disabled:opacity-50"
            >
              Reset to default
            </button>
          )}
        </div>
      )}
    </div>
  )
}
