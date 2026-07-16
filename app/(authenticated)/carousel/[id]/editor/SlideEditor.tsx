'use client'

// Phase-3 editor shell: slide tabs + one active canvas with the
// interaction overlay (select/drag/resize as of 3b). Documents live in
// local state here; persistence (autosave + manuallyEdited) and
// undo/redo land in the follow-up phase-3 PRs.
import { useCallback, useEffect, useRef, useState } from 'react'
import { SlideDocument, SlideNode, createNodeId, duplicateSlideDocument } from '@/lib/slideDocument'
import { getTextColorForBackground } from '@/lib/contrast'
import SlideCanvas from './SlideCanvas'
import EditorOverlay, { NodeGeometry } from './EditorOverlay'
import TextEditLayer from './TextEditLayer'
import PropertiesPanel from './PropertiesPanel'
import SlidePropertiesPanel from './SlidePropertiesPanel'
import AssetDrawer, { ShapePrefab } from './AssetDrawer'

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
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false)
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

  const handleNodePropsChange = useCallback(
    (nodeId: string, partial: Partial<SlideNode>) => {
      if (unitSnapshotRef.current === null) unitSnapshotRef.current = documentsRef.current
      setDocuments((docs) =>
        docs.map((doc, i) => {
          if (i !== activeIndex) return doc
          return {
            ...doc,
            manuallyEdited: true,
            nodes: doc.nodes.map((n): SlideNode =>
              n.id === nodeId ? ({ ...n, ...partial } as SlideNode) : n
            ),
          }
        })
      )
      setEditVersion((v) => v + 1)
    },
    [activeIndex]
  )

  // Adding/deleting is a discrete action: snapshot, mutate, commit —
  // one history entry each, same manuallyEdited/autosave plumbing as
  // every other edit.
  const mutateActiveDocument = useCallback(
    (mutate: (doc: SlideDocument) => SlideDocument) => {
      if (unitSnapshotRef.current === null) unitSnapshotRef.current = documentsRef.current
      setDocuments((docs) =>
        docs.map((doc, i) => (i === activeIndex ? { ...mutate(doc), manuallyEdited: true } : doc))
      )
      setEditVersion((v) => v + 1)
    },
    [activeIndex]
  )

  const addNode = useCallback(
    (kind: 'text' | 'rect' | 'ellipse') => {
      const bg = documentsRef.current[activeIndex]?.canvas.background
      // New elements default to a color that reads against a solid
      // background; on photo/gradient backgrounds default to white (the
      // properties panel is right there to change it).
      const contrastColor = bg?.type === 'solid' ? getTextColorForBackground(bg.color) : '#FFFFFF'
      const id = createNodeId()
      const node: SlideNode =
        kind === 'text'
          ? {
              id,
              type: 'text',
              x: 240,
              y: 560,
              width: 600,
              height: 60,
              text: 'Teks baru — klik dua kali untuk mengedit',
              fontFamily: 'Inter',
              fontWeight: 400,
              fontSize: 36,
              color: contrastColor,
              align: 'left',
              lineHeight: 1.3,
            }
          : {
              id,
              type: 'shape',
              x: 390,
              y: 525,
              width: 300,
              height: 300,
              shape: kind,
              fill: { type: 'solid', color: contrastColor },
            }
      mutateActiveDocument((doc) => ({ ...doc, nodes: [...doc.nodes, node] }))
      commitEditUnitRef.current()
      setSelectedId(id)
    },
    [activeIndex, mutateActiveDocument]
  )

  // Asset-library inserts: same discrete-edit-unit plumbing as addNode.
  // '__accent__' placeholders in prefabs resolve to a contrast-aware
  // color against the active slide's background at insert time.
  const insertColor = useCallback(() => {
    const bg = documentsRef.current[activeIndex]?.canvas.background
    return bg?.type === 'solid' ? getTextColorForBackground(bg.color) : '#FFFFFF'
  }, [activeIndex])

  const insertIcon = useCallback(
    (name: string) => {
      const id = createNodeId()
      const node: SlideNode = {
        id,
        type: 'icon',
        x: 468,
        y: 603,
        width: 144,
        height: 144,
        name,
        color: insertColor(),
        strokeWidth: 2,
      }
      mutateActiveDocument((doc) => ({ ...doc, nodes: [...doc.nodes, node] }))
      commitEditUnitRef.current()
      setSelectedId(id)
    },
    [mutateActiveDocument, insertColor]
  )

  const insertShapePrefab = useCallback(
    (prefab: ShapePrefab) => {
      const accent = insertColor()
      const resolveColor = (c: string) => (c === '__accent__' ? accent : c)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { label: _label, ...rest } = prefab
      const fill =
        rest.fill.type === 'solid'
          ? { ...rest.fill, color: resolveColor(rest.fill.color) }
          : structuredClone(rest.fill)
      const id = createNodeId()
      const node: SlideNode = {
        ...structuredClone(rest),
        fill,
        ...(rest.stroke ? { stroke: { ...rest.stroke, color: resolveColor(rest.stroke.color) } } : {}),
        id,
        type: 'shape',
        x: Math.round((1080 - prefab.width) / 2),
        y: Math.round((1350 - prefab.height) / 2),
      }
      mutateActiveDocument((doc) => ({ ...doc, nodes: [...doc.nodes, node] }))
      commitEditUnitRef.current()
      setSelectedId(id)
    },
    [mutateActiveDocument, insertColor]
  )

  const deleteSelected = useCallback(() => {
    const id = selectedId
    if (!id) return
    const doc = documentsRef.current[activeIndex]
    const node = doc?.nodes.find((n) => n.id === id)
    // Every node type is deletable now that all are fully interactive
    // (phase 4.3) — an element you can select and move but not remove
    // would be a trap.
    if (!node) return
    mutateActiveDocument((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== id) }))
    commitEditUnitRef.current()
    setSelectedId(null)
    setEditingId(null)
  }, [selectedId, activeIndex, mutateActiveDocument])

  // Reorder/duplicate operate on the documents ARRAY. Every position
  // whose occupant changed is marked manuallyEdited — array position is
  // what the PNG paths / slides cache / regenerate preservation key on,
  // so a slide sitting at a new position IS an edit of that position,
  // and marking it (a) makes autosave re-render its PNG there and
  // (b) shields it from being recompiled back into script order by the
  // designer route.
  const mutateDocumentsArray = useCallback((mutate: (docs: SlideDocument[]) => SlideDocument[]) => {
    if (unitSnapshotRef.current === null) unitSnapshotRef.current = documentsRef.current
    setDocuments((docs) => {
      const next = mutate(docs)
      return next.map((doc, i) =>
        docs[i]?.id === doc.id ? doc : { ...doc, manuallyEdited: true }
      )
    })
    setEditVersion((v) => v + 1)
  }, [])

  const moveSlide = useCallback(
    (index: number, dir: -1 | 1) => {
      const target = index + dir
      if (target < 0 || target >= documentsRef.current.length) return
      mutateDocumentsArray((docs) => {
        const next = [...docs]
        ;[next[index], next[target]] = [next[target], next[index]]
        return next
      })
      commitEditUnitRef.current()
      setActiveIndex(target)
      setSelectedId(null)
      setEditingId(null)
    },
    [mutateDocumentsArray]
  )

  const duplicateSlide = useCallback(
    (index: number) => {
      mutateDocumentsArray((docs) => {
        const copy = { ...duplicateSlideDocument(docs[index]), manuallyEdited: true }
        return [...docs.slice(0, index + 1), copy, ...docs.slice(index + 1)]
      })
      commitEditUnitRef.current()
      setActiveIndex(index + 1)
      setSelectedId(null)
      setEditingId(null)
    },
    [mutateDocumentsArray]
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

  const commitEditUnitRef = useRef(commitEditUnit)
  commitEditUnitRef.current = commitEditUnit

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

  const deleteSelectedRef = useRef(deleteSelected)
  deleteSelectedRef.current = deleteSelected

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
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Never while typing in some other form control on the page.
        const tag = (e.target as HTMLElement | null)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        e.preventDefault()
        deleteSelectedRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editingId, undo, redo])

  if (!active) return null

  const selectedNode = selectedId !== null ? active.nodes.find((n) => n.id === selectedId) ?? null : null

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
            <span className="mt-1 flex justify-center gap-1">
              <span
                role="button"
                title="Pindah ke atas"
                onClick={(e) => {
                  e.stopPropagation()
                  moveSlide(i, -1)
                }}
                className={`rounded px-1 text-[10px] leading-4 ${i === 0 ? 'pointer-events-none opacity-30' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
              >
                ↑
              </span>
              <span
                role="button"
                title="Pindah ke bawah"
                onClick={(e) => {
                  e.stopPropagation()
                  moveSlide(i, 1)
                }}
                className={`rounded px-1 text-[10px] leading-4 ${i === documents.length - 1 ? 'pointer-events-none opacity-30' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
              >
                ↓
              </span>
              <span
                role="button"
                title="Duplikat slide"
                onClick={(e) => {
                  e.stopPropagation()
                  duplicateSlide(i)
                }}
                className="rounded px-1 text-[10px] leading-4 hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                ⧉
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-start gap-4">
      <div>
        <div className="mb-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => addNode('text')}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            + Teks
          </button>
          <button
            type="button"
            onClick={() => addNode('rect')}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            + Kotak
          </button>
          <button
            type="button"
            onClick={() => addNode('ellipse')}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            + Lingkaran
          </button>
          <button
            type="button"
            onClick={() => setAssetDrawerOpen((v) => !v)}
            className={`rounded border px-2 py-1 text-xs ${
              assetDrawerOpen
                ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
          >
            ✦ Aset
          </button>
          {selectedNode && (
            <button
              type="button"
              onClick={deleteSelected}
              className="ml-auto rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
            >
              Hapus elemen
            </button>
          )}
        </div>
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
            Klik elemen apa pun untuk memilih, tarik untuk memindah, tarik handle untuk
            mengubah ukuran, Delete untuk menghapus. Klik dua kali teks untuk mengedit isinya
            (Esc/klik luar untuk selesai).
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
      {assetDrawerOpen && (
        <AssetDrawer
          onInsertIcon={insertIcon}
          onInsertShape={insertShapePrefab}
          onClose={() => setAssetDrawerOpen(false)}
        />
      )}
      {selectedNode ? (
        <PropertiesPanel
          node={selectedNode}
          canvasBackground={active.canvas.background}
          onUpdateNode={handleNodePropsChange}
          onCommit={commitEditUnit}
        />
      ) : (
        <SlidePropertiesPanel
          document={active}
          onMutateDocument={mutateActiveDocument}
          onCommit={commitEditUnit}
        />
      )}
      </div>
    </div>
  )
}
