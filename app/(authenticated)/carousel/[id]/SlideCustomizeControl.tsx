'use client'

import { useRef, useState } from 'react'
import { SlideOverride } from '@/lib/slideDesign'
import { LAYOUT_OPTIONS, LayoutVariant, TextDensity } from './DesignOptionsPanel'

const TEXT_DENSITY_OPTIONS: { value: TextDensity; label: string }[] = [
  { value: 'concise', label: 'Concise' },
  { value: 'standard', label: 'Standard' },
  { value: 'detailed', label: 'Detailed' },
]

const DEFAULT_OPTION_VALUE = ''

// An override with every field cleared is the same as no override —
// collapsing back to undefined here (rather than leaving an empty {}
// object with just slideIndex) is what makes the "Custom" badge and the
// reset button disappear correctly, and keeps slide_overrides from
// silently accumulating empty entries over time.
function isEmptyOverride(o: SlideOverride): boolean {
  return !o.colorScheme && !o.textDensity && !o.backgroundImageUrl && !o.layoutTemplate
}

interface Props {
  slideIndex: number
  override: SlideOverride | undefined
  brandColors: Record<string, string> | null
  postId: string
  defaultBackgroundImageUrl: string | null
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
  postId,
  defaultBackgroundImageUrl,
  onChange,
  disabled = false,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasOverride = !!override

  function commit(next: SlideOverride) {
    onChange(isEmptyOverride(next) ? undefined : next)
  }

  function handleColorSchemeChange(value: string) {
    const next: SlideOverride = { ...override, slideIndex }
    if (value === DEFAULT_OPTION_VALUE) {
      delete next.colorScheme
    } else {
      next.colorScheme = value
    }
    commit(next)
  }

  function handleTextDensityChange(value: string) {
    const next: SlideOverride = { ...override, slideIndex }
    if (value === DEFAULT_OPTION_VALUE) {
      delete next.textDensity
    } else {
      next.textDensity = value as TextDensity
    }
    commit(next)
  }

  async function handleReplaceImage(file: File) {
    setUploading(true)
    setUploadError(null)

    const formData = new FormData()
    formData.append('post_id', postId)
    formData.append('slide_index', String(slideIndex))
    formData.append('file', file)

    const res = await fetch('/api/carousel/background-upload', { method: 'POST', body: formData })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setUploadError(json.error ?? 'Upload failed')
      setUploading(false)
      return
    }

    const { url } = await res.json()
    const next: SlideOverride = { ...override, slideIndex, backgroundImageUrl: url }
    commit(next)
    setUploading(false)
  }

  function handleResetImage() {
    const next: SlideOverride = { ...override, slideIndex }
    delete next.backgroundImageUrl
    commit(next)
  }

  function handleLayoutChange(value: string) {
    const next: SlideOverride = { ...override, slideIndex }
    if (value === DEFAULT_OPTION_VALUE) {
      delete next.layoutTemplate
    } else {
      next.layoutTemplate = value as LayoutVariant
    }
    commit(next)
  }

  function handleReset() {
    onChange(undefined)
    setExpanded(false)
  }

  const effectiveImageUrl = override?.backgroundImageUrl ?? defaultBackgroundImageUrl
  const selectedLayoutOption = LAYOUT_OPTIONS.find((opt) => opt.key === override?.layoutTemplate)
  // Non-blocking hint — image-required templates (news_card,
  // photo_editorial) still render via the fixed dark-gradient fallback
  // already built into renderSlide() when there's no image, this is just
  // a nudge toward the better-looking path, not a validation error.
  const showImageHint = !!selectedLayoutOption?.recommendsImage && !effectiveImageUrl

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

          <div>
            <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">
              Layout
            </label>
            <select
              value={override?.layoutTemplate ?? DEFAULT_OPTION_VALUE}
              onChange={(e) => handleLayoutChange(e.target.value)}
              disabled={disabled}
              className="w-full rounded border border-gray-300 px-1.5 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
            >
              <option value={DEFAULT_OPTION_VALUE}>Sama seperti default</option>
              {LAYOUT_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.name}
                </option>
              ))}
            </select>
            {showImageHint && (
              <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                Tambahkan gambar untuk hasil optimal
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">
              Background Image
            </label>
            {effectiveImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={effectiveImageUrl}
                alt=""
                className="mb-1 h-16 w-full rounded border border-gray-200 object-cover dark:border-gray-700"
              />
            )}
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleReplaceImage(file)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || uploading}
                className="rounded border border-gray-300 px-1.5 py-1 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {uploading ? 'Uploading…' : 'Replace Image'}
              </button>
              {override?.backgroundImageUrl && (
                <button
                  type="button"
                  onClick={handleResetImage}
                  disabled={disabled || uploading}
                  className="text-[11px] text-blue-600 hover:underline dark:text-blue-400 disabled:opacity-50"
                >
                  Reset image
                </button>
              )}
            </div>
            {uploadError && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{uploadError}</p>}
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
