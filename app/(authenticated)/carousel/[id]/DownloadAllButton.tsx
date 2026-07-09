'use client'

import { useState } from 'react'
import { slugify } from '@/lib/slug'

interface Props {
  topic: string
  slides: { index: number; url: string }[]
}

export default function DownloadAllButton({ topic, slides }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)

    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()

      await Promise.all(
        slides.map(async ({ index, url }) => {
          const res = await fetch(url)
          if (!res.ok) {
            throw new Error(`Failed to fetch slide ${index}`)
          }
          const blob = await res.blob()
          zip.file(`slide-${index}.png`, blob)
        })
      )

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const objectUrl = URL.createObjectURL(zipBlob)

      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `${slugify(topic)}-carousel.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build zip')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={loading}
        className="rounded-lg px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        {loading ? 'Zipping…' : 'Download All (ZIP)'}
      </button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
