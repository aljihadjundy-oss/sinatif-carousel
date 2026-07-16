// Maps SlideDocument nodes to browser CSS — the client-side twin of
// lib/render-document.tsx's node renderers. Both read the same frozen
// x/y/width/height/colors, so keeping the two in sync is a matter of
// mirroring style keys, not layout logic (there is none left at render
// time by design — see phase 2).
import type { CSSProperties } from 'react'
import { Fill, ShapeNode, SlideNode, TextNode } from '@/lib/slideDocument'

export function fillToCss(fill: Fill): CSSProperties {
  switch (fill.type) {
    case 'solid':
      return { backgroundColor: fill.color }
    case 'linear-gradient':
      return {
        backgroundImage: `linear-gradient(${fill.angle}deg, ${fill.stops
          .map((s) => `${s.color} ${s.offset * 100}%`)
          .join(', ')})`,
      }
    case 'image':
      return {
        backgroundImage: `url(${fill.src})`,
        backgroundSize: fill.fit === 'cover' ? 'cover' : 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
  }
}

export function baseNodeCss(node: SlideNode): CSSProperties {
  return {
    position: 'absolute',
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    ...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
    ...(node.rotation ? { transform: `rotate(${node.rotation}deg)` } : {}),
  }
}

export function textNodeCss(node: TextNode): CSSProperties {
  return {
    ...baseNodeCss(node),
    fontFamily: node.fontFamily,
    fontWeight: node.fontWeight,
    fontSize: node.fontSize,
    color: node.color,
    textAlign: node.align,
    ...(node.lineHeight !== undefined ? { lineHeight: node.lineHeight } : {}),
    ...(node.letterSpacing !== undefined ? { letterSpacing: `${node.letterSpacing}px` } : {}),
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  }
}

export function shapeNodeCss(node: ShapeNode): CSSProperties {
  return {
    ...baseNodeCss(node),
    ...fillToCss(node.fill),
    ...(node.shape === 'ellipse'
      ? { borderRadius: 9999 }
      : node.cornerRadius
        ? { borderRadius: node.cornerRadius }
        : {}),
    ...(node.stroke ? { border: `${node.stroke.width}px solid ${node.stroke.color}` } : {}),
    boxSizing: 'border-box',
  }
}
