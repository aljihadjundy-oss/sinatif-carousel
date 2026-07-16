'use client'

// Inline text editing (phase 3c): a plain <textarea> positioned exactly
// over the text node being edited, styled with the node's own font
// properties so what you type sits where the rendered text sits. Native
// DOM editing is the whole reason phase 3 chose DOM over Konva (see PR
// #66) — no hidden-input workarounds, IME/selection/mobile keyboards
// all just work.
//
// The textarea grows the node's understanding of nothing: only `text`
// changes. The canvas hides the underlying node while editing (see
// SlideCanvas.hiddenNodeId) so the textarea is the single visible copy.
import React, { useEffect, useRef } from 'react'
import { TextNode } from '@/lib/slideDocument'
import { textNodeCss } from './nodeStyles'

interface Props {
  node: TextNode
  onTextChange: (text: string) => void
  onDone: () => void
}

export default function TextEditLayer({ node, onTextChange, onDone }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  return (
    <textarea
      ref={ref}
      value={node.text}
      onChange={(e) => onTextChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onDone()
        }
      }}
      style={{
        ...textNodeCss(node),
        // Grow past the node's frozen height rather than scroll inside
        // it — matches how the rendered node overflows its box.
        height: undefined,
        minHeight: node.height,
        background: 'transparent',
        border: 'none',
        outline: '2px dashed #2563eb',
        outlineOffset: 2,
        resize: 'none',
        overflow: 'hidden',
        padding: 0,
        margin: 0,
      }}
    />
  )
}
