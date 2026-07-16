'use client'

// Phase-3 editor shell: slide tabs + one active canvas with the
// interaction overlay (select/drag/resize as of 3b). Documents live in
// local state here; persistence (autosave + manuallyEdited) and
// undo/redo land in the follow-up phase-3 PRs.
import { useCallback, useState } from 'react'
import { SlideDocument, SlideNode } from '@/lib/slideDocument'
import SlideCanvas from './SlideCanvas'
import EditorOverlay, { NodeGeometry } from './EditorOverlay'

const CANVAS_DISPLAY_WIDTH = 540 // half document scale — crisp but compact

interface Props {
  documents: SlideDocument[]
}

export default function SlideEditor({ documents: initialDocuments }: Props) {
  const [documents, setDocuments] = useState(initialDocuments)
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const active = documents[activeIndex]
  const scale = active ? CANVAS_DISPLAY_WIDTH / active.canvas.width : 1

  const handleGeometryChange = useCallback(
    (nodeId: string, geometry: NodeGeometry) => {
      setDocuments((docs) =>
        docs.map((doc, i) => {
          if (i !== activeIndex) return doc
          return {
            ...doc,
            nodes: doc.nodes.map((n): SlideNode => (n.id === nodeId ? { ...n, ...geometry } : n)),
          }
        })
      )
    },
    [activeIndex]
  )

  if (!active) return null

  return (
    <div className="flex gap-6">
      <div className="flex w-24 shrink-0 flex-col gap-2">
        {documents.map((doc, i) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => {
              setActiveIndex(i)
              setSelectedId(null)
            }}
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
        <SlideCanvas document={active} displayWidth={CANVAS_DISPLAY_WIDTH}>
          <EditorOverlay
            document={active}
            scale={scale}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNodeGeometryChange={handleGeometryChange}
          />
        </SlideCanvas>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Klik teks/shape untuk memilih, tarik untuk memindah, tarik handle untuk mengubah
          ukuran. Gambar & ikon masih read-only di MVP ini. Perubahan belum tersimpan
          otomatis (menyusul di PR berikutnya).
        </p>
      </div>
    </div>
  )
}
