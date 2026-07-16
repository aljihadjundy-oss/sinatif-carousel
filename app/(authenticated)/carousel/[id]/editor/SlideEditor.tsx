'use client'

// Phase-3 editor shell: slide tabs + one active canvas with the
// interaction overlay (select/drag/resize as of 3b). Documents live in
// local state here; persistence (autosave + manuallyEdited) and
// undo/redo land in the follow-up phase-3 PRs.
import { useCallback, useEffect, useRef, useState } from 'react'
import { SlideDocument, SlideNode } from '@/lib/slideDocument'
import SlideCanvas from './SlideCanvas'
import EditorOverlay, { NodeGeometry } from './EditorOverlay'
import TextEditLayer from './TextEditLayer'

const CANVAS_DISPLAY_WIDTH = 540 // half document scale — crisp but compact

const AUTOSAVE_DEBOUNCE_MS = 900
// Snapshot-stack undo (phase 3e): documents arrays are small plain JSON
// and every mutation already replaces them immutably, so whole-array
// snapshots by reference are the simplest correct history — no patch
// bookkeeping. One entry per completed edit unit (a full drag/resize
// gesture, one inline text-editing session), not per pointermove or
// keystroke.
const HISTORY_LIMIT = 50

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

interface Props {
  postId: string
  documents: SlideDocument[]
}

export default function SlideEditor({ postId, documents: initialDocuments }: Props) {
  const [documents, setDocuments] = useState(initialDocuments)
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [history, setHistory] = useState<{ past: SlideDocument[][]; future: SlideDocument[][] }>({
    past: [],
    future: [],
  })
  // Pre-edit snapshot of the current edit unit — set on the first
  // mutation of a gesture (or when text editing starts), committed to
  // history when the unit ends.
  const unitSnapshotRef = useRef<SlideDocument[] | null>(null)
  // Autosave fires on document VERSIONS, not renders: bump on every real
  // edit, debounce, then PATCH the whole array. A ref mirrors the latest
  // documents so the debounced callback never captures a stale array.
  const [editVersion, setEditVersion] = useState(0)
  const documentsRef = useRef(documents)
  documentsRef.current = documents

  const active = documents[activeIndex]
  const scale = active ? CANVAS_DISPLAY_WIDTH / active.canvas.width : 1

  useEffect(() => {
    if (editVersion === 0) return
    setSaveState('dirty')
    const timer = setTimeout(async () => {
      setSaveState('saving')
      try {
        const res = await fetch('/api/carousel/slide-documents', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id: postId, slide_documents: documentsRef.current }),
        })
        if (!res.ok) throw new Error(await res.text())
        setSaveState('saved')
      } catch (err) {
        console.error('editor autosave failed', err)
        setSaveState('error')
      }
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [editVersion, postId])

  const handleGeometryChange = useCallback(
    (nodeId: string, geometry: NodeGeometry) => {
      if (unitSnapshotRef.current === null) unitSnapshotRef.current = documentsRef.current
      setDocuments((docs) =>
        docs.map((doc, i) => {
          if (i !== activeIndex) return doc
          return {
            ...doc,
            manuallyEdited: true,
            nodes: doc.nodes.map((n): SlideNode => (n.id === nodeId ? { ...n, ...geometry } : n)),
          }
        })
      )
      setEditVersion((v) => v + 1)
    },
    [activeIndex]
  )

  const handleTextChange = useCallback(
    (nodeId: string, text: string) => {
      setDocuments((docs) =>
        docs.map((doc, i) => {
          if (i !== activeIndex) return doc
          return {
            ...doc,
            manuallyEdited: true,
            nodes: doc.nodes.map((n): SlideNode =>
              n.id === nodeId && n.type === 'text' ? { ...n, text } : n
            ),
          }
        })
      )
      setEditVersion((v) => v + 1)
    },
    [activeIndex]
  )

  const commitEditUnit = useCallback(() => {
    const snapshot = unitSnapshotRef.current
    unitSnapshotRef.current = null
    if (!snapshot || snapshot === documentsRef.current) return
    setHistory((h) => ({
      past: [...h.past.slice(-(HISTORY_LIMIT - 1)), snapshot],
      future: [],
    }))
  }, [])

  const undo = useCallback(() => {
    commitEditUnit() // a mid-air unit becomes its own entry first
    setHistory((h) => {
      if (h.past.length === 0) return h
      const previous = h.past[h.past.length - 1]
      const current = documentsRef.current
      setDocuments(previous)
      setEditVersion((v) => v + 1) // autosave persists the undo too
      return { past: h.past.slice(0, -1), future: [...h.future, current] }
    })
  }, [commitEditUnit])

  const redo = useCallback(() => {
    setHistory((h) => {
      if (h.future.length === 0) return h
      const next = h.future[h.future.length - 1]
      const current = documentsRef.current
      setDocuments(next)
      setEditVersion((v) => v + 1)
      return { past: [...h.past, current], future: h.future.slice(0, -1) }
    })
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // While the inline textarea is open, leave Ctrl+Z to the browser's
      // native text-field undo.
      if (editingId !== null) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editingId, undo, redo])

  if (!active) return null

  const editingNode =
    editingId !== null
      ? active.nodes.find((n): n is Extract<SlideNode, { type: 'text' }> => n.id === editingId && n.type === 'text') ?? null
      : null

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
              setEditingId(null)
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
        <SlideCanvas document={active} displayWidth={CANVAS_DISPLAY_WIDTH} hiddenNodeId={editingId}>
          <EditorOverlay
            document={active}
            scale={scale}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id)
              if (id !== editingId) setEditingId(null)
            }}
            onNodeGeometryChange={handleGeometryChange}
            onGestureEnd={commitEditUnit}
            editingId={editingId}
            onStartTextEdit={(id) => {
              unitSnapshotRef.current = documentsRef.current
              setEditingId(id)
            }}
          />
          {editingNode && (
            <TextEditLayer
              node={editingNode}
              onTextChange={(text) => handleTextChange(editingNode.id, text)}
              onDone={() => {
                setEditingId(null)
                commitEditUnit()
              }}
            />
          )}
        </SlideCanvas>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={undo}
              disabled={history.past.length === 0 && unitSnapshotRef.current === null}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              ↩ Undo
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={history.future.length === 0}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Redo ↪
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Klik teks/shape untuk memilih, tarik untuk memindah, tarik handle untuk mengubah
            ukuran. Klik dua kali teks untuk mengedit isinya (Esc/klik luar untuk selesai).
            Gambar & ikon masih read-only di MVP ini.
          </p>
          <span
            className={`shrink-0 text-xs ${
              saveState === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-gray-400 dark:text-gray-500'
            }`}
          >
            {saveState === 'dirty' && 'Perubahan belum tersimpan…'}
            {saveState === 'saving' && 'Menyimpan…'}
            {saveState === 'saved' && 'Tersimpan ✓'}
            {saveState === 'error' && 'Gagal menyimpan — coba edit lagi'}
          </span>
        </div>
      </div>
    </div>
  )
}
