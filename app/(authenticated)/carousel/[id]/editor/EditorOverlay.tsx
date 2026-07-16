'use client'

// Interaction layer for the slide canvas (phase 3b): selection, drag,
// and resize. Rendered INSIDE SlideCanvas's scaled stage, so all math
// here is in document coordinates (1080x1350); the only place the
// display scale appears is when converting pointer deltas (screen px)
// back into document px.
//
// MVP interaction scope (per the phase brief): text and shape nodes get
// the full select/drag/resize treatment; image and icon nodes render
// read-only and aren't selectable — adding/moving those is phase 4.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { SlideDocument, SlideNode } from '@/lib/slideDocument'

export interface NodeGeometry {
  x: number
  y: number
  width: number
  height: number
}

export function isInteractiveNode(node: SlideNode): boolean {
  return node.type === 'text' || node.type === 'shape'
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type Handle = (typeof HANDLES)[number]

const HANDLE_CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

const MIN_SIZE = 8

interface DragState {
  nodeId: string
  mode: 'move' | Handle
  startPointer: { x: number; y: number } // screen px
  startRect: NodeGeometry // document px
}

function applyDrag(state: DragState, dxDoc: number, dyDoc: number): NodeGeometry {
  const r = { ...state.startRect }
  if (state.mode === 'move') {
    r.x += dxDoc
    r.y += dyDoc
    return r
  }
  const m = state.mode
  if (m.includes('e')) r.width = Math.max(MIN_SIZE, state.startRect.width + dxDoc)
  if (m.includes('s')) r.height = Math.max(MIN_SIZE, state.startRect.height + dyDoc)
  if (m.includes('w')) {
    const w = Math.max(MIN_SIZE, state.startRect.width - dxDoc)
    r.x = state.startRect.x + (state.startRect.width - w)
    r.width = w
  }
  if (m.includes('n')) {
    const h = Math.max(MIN_SIZE, state.startRect.height - dyDoc)
    r.y = state.startRect.y + (state.startRect.height - h)
    r.height = h
  }
  return r
}

interface Props {
  document: SlideDocument
  scale: number
  selectedId: string | null
  onSelect: (nodeId: string | null) => void
  onNodeGeometryChange: (nodeId: string, geometry: NodeGeometry) => void
  // Fired once when a pointer gesture (drag/resize) completes — the
  // autosave/undo PRs hook here so a whole gesture is one history entry
  // and one save, not one per pointermove.
  onGestureEnd?: () => void
  // Double-clicking a text node hands editing over to the inline
  // textarea layer (phase 3c); while a node is being edited its hit
  // area is disabled so the textarea receives the pointer events.
  editingId?: string | null
  onStartTextEdit?: (nodeId: string) => void
}

export default function EditorOverlay({
  document: doc,
  scale,
  selectedId,
  onSelect,
  onNodeGeometryChange,
  onGestureEnd,
  editingId = null,
  onStartTextEdit,
}: Props) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag
  // Deliver the latest callbacks to the window listeners without
  // re-binding them mid-gesture.
  const changeRef = useRef(onNodeGeometryChange)
  changeRef.current = onNodeGeometryChange
  const gestureEndRef = useRef(onGestureEnd)
  gestureEndRef.current = onGestureEnd
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  useEffect(() => {
    if (!drag) return
    function onMove(e: PointerEvent) {
      const d = dragRef.current
      if (!d) return
      const dxDoc = (e.clientX - d.startPointer.x) / scaleRef.current
      const dyDoc = (e.clientY - d.startPointer.y) / scaleRef.current
      changeRef.current(d.nodeId, applyDrag(d, dxDoc, dyDoc))
    }
    function onUp() {
      setDrag(null)
      gestureEndRef.current?.()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag])

  const startGesture = useCallback(
    (e: React.PointerEvent, nodeId: string, mode: DragState['mode'], rect: NodeGeometry) => {
      e.preventDefault()
      e.stopPropagation()
      onSelect(nodeId)
      setDrag({ nodeId, mode, startPointer: { x: e.clientX, y: e.clientY }, startRect: rect })
    },
    [onSelect]
  )

  // Handle size is divided by scale so handles LOOK constant-size on
  // screen while living in document coordinates.
  const handleSize = 12 / scale

  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      onPointerDown={() => onSelect(null)}
    >
      {doc.nodes.filter(isInteractiveNode).map((node) => {
        const rect = { x: node.x, y: node.y, width: node.width, height: node.height }
        const selected = node.id === selectedId
        return (
          <div
            key={node.id}
            onPointerDown={(e) => startGesture(e, node.id, 'move', rect)}
            onDoubleClick={(e) => {
              if (node.type !== 'text' || !onStartTextEdit) return
              e.stopPropagation()
              onStartTextEdit(node.id)
            }}
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              cursor: 'move',
              pointerEvents: node.id === editingId ? 'none' : undefined,
              outline: selected ? `${2 / scale}px solid #2563eb` : undefined,
              outlineOffset: 0,
            }}
          >
            {selected &&
              HANDLES.map((h) => {
                const cx = h.includes('w') ? 0 : h.includes('e') ? rect.width : rect.width / 2
                const cy = h.includes('n') ? 0 : h.includes('s') ? rect.height : rect.height / 2
                return (
                  <div
                    key={h}
                    onPointerDown={(e) => startGesture(e, node.id, h, rect)}
                    style={{
                      position: 'absolute',
                      left: cx - handleSize / 2,
                      top: cy - handleSize / 2,
                      width: handleSize,
                      height: handleSize,
                      backgroundColor: '#ffffff',
                      border: `${1.5 / scale}px solid #2563eb`,
                      borderRadius: 2 / scale,
                      cursor: HANDLE_CURSOR[h],
                    }}
                  />
                )
              })}
          </div>
        )
      })}
    </div>
  )
}
