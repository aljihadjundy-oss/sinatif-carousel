'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type LayoutVariant = 'minimal' | 'accent'
type TextDensity = 'concise' | 'standard' | 'detailed'
type Hierarchy = 'headline_focused' | 'balanced'

interface Props {
  postId: string
  buttonStyle?: 'primary' | 'secondary'
  initialLayoutVariant?: LayoutVariant
  initialColorScheme?: string | null
  initialTextDensity?: TextDensity
  initialHierarchy?: Hierarchy
  brandColors?: Record<string, string> | null
}

export default function RegenerateDesignButton({
  postId,
  buttonStyle = 'secondary',
  initialLayoutVariant = 'minimal',
  initialColorScheme = null,
  initialTextDensity = 'standard',
  initialHierarchy = 'balanced',
  brandColors = null,
}: Props) {
  const router = useRouter()
  const [layoutVariant, setLayoutVariant] = useState<LayoutVariant>(initialLayoutVariant)
  const [colorScheme, setColorScheme] = useState<string>(initialColorScheme ?? '')
  const [textDensity, setTextDensity] = useState<TextDensity>(initialTextDensity)
  const [hierarchy, setHierarchy] = useState<Hierarchy>(initialHierarchy)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)

    const res = await fetch('/api/carousel/designer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_id: postId,
        layout_variant: layoutVariant,
        color_scheme: colorScheme || null,
        text_density: textDensity,
        hierarchy: hierarchy,
      }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Design generation failed')
      setLoading(false)
      return
    }

    setLoading(false)
    router.refresh()
  }

  const primaryClasses =
    'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
  const secondaryClasses =
    'border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
  const selectClasses =
    'border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'

  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-3 dark:border-gray-800">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Layout
          </label>
          <select
            value={layoutVariant}
            onChange={(e) => setLayoutVariant(e.target.value as LayoutVariant)}
            disabled={loading}
            className={`w-full ${selectClasses}`}
          >
            <option value="minimal">Minimal</option>
            <option value="accent">Accent</option>
          </select>
        </div>

        {brandColors && Object.keys(brandColors).length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Color Scheme
            </label>
            <select
              value={colorScheme}
              onChange={(e) => setColorScheme(e.target.value)}
              disabled={loading}
              className={`w-full ${selectClasses}`}
            >
              <option value="">Default</option>
              {Object.entries(brandColors).map(([name, hex]) => (
                <option key={name} value={name}>
                  {name.replace(/_/g, ' ')} ({hex})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Text Density
          </label>
          <select
            value={textDensity}
            onChange={(e) => setTextDensity(e.target.value as TextDensity)}
            disabled={loading}
            className={`w-full ${selectClasses}`}
          >
            <option value="concise">Concise</option>
            <option value="standard">Standard</option>
            <option value="detailed">Detailed</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Hierarchy
          </label>
          <select
            value={hierarchy}
            onChange={(e) => setHierarchy(e.target.value as Hierarchy)}
            disabled={loading}
            className={`w-full ${selectClasses}`}
          >
            <option value="headline_focused">Headline-focused</option>
            <option value="balanced">Balanced</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleClick}
        disabled={loading}
        className={`w-full rounded-lg px-4 py-2 text-sm font-medium ${
          buttonStyle === 'primary' ? primaryClasses : secondaryClasses
        }`}
      >
        {loading
          ? 'Membuat desain…'
          : buttonStyle === 'primary'
            ? 'Generate Design'
            : 'Regenerate Design'}
      </button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
