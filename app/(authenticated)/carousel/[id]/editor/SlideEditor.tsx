'use client'

// Phase-3a shell: slide tab list + one active SlideCanvas. Interaction
// (select/drag/resize/text edit/autosave/undo) lands in the follow-up
// phase-3 PRs; this PR is deliberately just "SlideDocuments render in
// the browser instead of only as exported PNGs".
import { useState } from 'react'
import { SlideDocument } from '@/lib/slideDocument'
import SlideCanvas from './SlideCanvas'

const CANVAS_DISPLAY_WIDTH = 540 // half document scale — crisp but compact

interface Props {
  documents: SlideDocument[]
}

export default function SlideEditor({ documents }: Props) {
  const [activeIndex, setActiveIndex] = useState(0)
  const active = documents[activeIndex]

  if (!active) return null

  return (
    <div className="flex gap-6">
      <div className="flex w-24 shrink-0 flex-col gap-2">
        {documents.map((doc, i) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => setActiveIndex(i)}
            className={`rounded-md border px-2 py-3 text-sm font-medium transition-colors ${
              i === activeIndex
                ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400'
            }`}
          >
            {i + 1}
            {doc.manuallyEdited && (
              <span
                title="Sudah diedit manual"
                className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle"
              />
            )}
          </button>
        ))}
      </div>
      <div>
        <SlideCanvas document={active} displayWidth={CANVAS_DISPLAY_WIDTH} />
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Pratinjau kanvas (read-only). Interaksi edit menyusul di PR fase 3 berikutnya.
        </p>
      </div>
    </div>
  )
}
