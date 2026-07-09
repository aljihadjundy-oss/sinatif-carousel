'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type LayoutVariant = 'minimal' | 'accent'

export default function RegenerateDesignButton({
  postId,
  buttonStyle = 'secondary',
  initialLayoutVariant = 'minimal',
}: {
  postId: string
  buttonStyle?: 'primary' | 'secondary'
  initialLayoutVariant?: LayoutVariant
}) {
  const router = useRouter()
  const [layoutVariant, setLayoutVariant] = useState<LayoutVariant>(initialLayoutVariant)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)

    const res = await fetch('/api/carousel/designer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: postId, layout_variant: layoutVariant }),
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

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <select
          value={layoutVariant}
          onChange={(e) => setLayoutVariant(e.target.value as LayoutVariant)}
          disabled={loading}
          className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
        >
          <option value="minimal">Minimal</option>
          <option value="accent">Accent</option>
        </select>
        <button
          onClick={handleClick}
          disabled={loading}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            buttonStyle === 'primary' ? primaryClasses : secondaryClasses
          }`}
        >
          {loading
            ? 'Membuat desain…'
            : buttonStyle === 'primary'
              ? 'Generate Design'
              : 'Regenerate Design'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
