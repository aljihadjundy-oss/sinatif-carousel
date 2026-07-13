'use client'

import { useState } from 'react'
import { slugify } from '@/lib/slug'

interface Props {
  topic: string
  index: number
  url: string
  isCustomized?: boolean
}

export default function SlideImage({ topic, index, url, isCustomized = false }: Props) {
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch slide')
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `${slugify(topic)}-slide-${index}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)
    } catch {
      // Silently ignored — a failed single-slide download isn't worth a
      // dedicated error UI when "Download All" covers the same data.
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="relative group">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`Slide ${index}`}
        className="rounded-lg border border-gray-200 dark:border-gray-800 w-full"
      />
      {isCustomized && (
        <span className="absolute top-2 left-2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white shadow">
          Custom
        </span>
      )}
      <button
        onClick={handleDownload}
        disabled={downloading}
        title="Download this slide"
        className="absolute top-2 right-2 bg-black/60 text-white rounded-md p-1.5 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-4 h-4"
        >
          <path d="M10 12.5a.75.75 0 0 1-.53-.22l-3.5-3.5a.75.75 0 1 1 1.06-1.06L9.25 9.94V3a.75.75 0 0 1 1.5 0v6.94l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-.53.22Z" />
          <path d="M4 13a.75.75 0 0 1 .75.75v1.5c0 .414.336.75.75.75h9a.75.75 0 0 0 .75-.75v-1.5a.75.75 0 0 1 1.5 0v1.5A2.25 2.25 0 0 1 14.5 17.5h-9A2.25 2.25 0 0 1 3.25 15.25v-1.5A.75.75 0 0 1 4 13Z" />
        </svg>
      </button>
    </div>
  )
}
