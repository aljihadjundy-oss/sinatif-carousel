'use client'

// Read-only DOM canvas for one SlideDocument (phase 3a). Nodes render as
// absolutely-positioned divs at their frozen document coordinates inside
// a fixed 1080x1350 stage, scaled down uniformly with transform:scale to
// fit whatever width the page gives it — interaction layers added in
// later phase-3 PRs sit on top of this same stage so their math can work
// in document coordinates and ignore the display scale.
import React from 'react'
import { Fill, SlideDocument, SlideNode } from '@/lib/slideDocument'
import { IconName, ICON_NAMES, LucideIcon } from '@/lib/icons'
import { baseNodeCss, fillToCss, shapeNodeCss, textNodeCss } from './nodeStyles'

function CanvasNode({ node }: { node: SlideNode }) {
  switch (node.type) {
    case 'text':
      return <div style={textNodeCss(node)}>{node.text}</div>
    case 'shape':
      return <div style={shapeNodeCss(node)} />
    case 'image':
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={node.src} alt="" style={{ ...baseNodeCss(node), objectFit: node.fit }} />
      )
    case 'icon':
      return (
        <div style={{ ...baseNodeCss(node), display: 'flex' }}>
          {ICON_NAMES.includes(node.name as IconName) ? (
            <LucideIcon
              name={node.name as IconName}
              size={Math.min(node.width, node.height)}
              color={node.color}
              strokeWidth={node.strokeWidth ?? 2}
            />
          ) : null}
        </div>
      )
  }
}

function canvasBackgroundCss(background: Fill): React.CSSProperties {
  return fillToCss(background)
}

interface Props {
  document: SlideDocument
  // Display width in px; the 1080-wide stage scales to fit it.
  displayWidth: number
  children?: React.ReactNode
}

export default function SlideCanvas({ document, displayWidth, children }: Props) {
  const scale = displayWidth / document.canvas.width
  return (
    <div
      style={{
        width: displayWidth,
        height: document.canvas.height * scale,
        overflow: 'hidden',
      }}
      className="rounded-lg border border-gray-200 dark:border-gray-800"
    >
      <div
        style={{
          position: 'relative',
          width: document.canvas.width,
          height: document.canvas.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          overflow: 'hidden',
          ...canvasBackgroundCss(document.canvas.background),
        }}
      >
        {document.nodes.map((node) => (
          <CanvasNode key={node.id} node={node} />
        ))}
        {children}
      </div>
    </div>
  )
}
