// Phase-2 exporter: SlideDocument (node tree) → PNG, via the same
// next/og ImageResponse pipeline lib/slide-renderer.tsx uses. Every node
// is absolutely positioned from its frozen x/y/width/height — no flow
// layout, no flexbox math, no color computation: all of that happened at
// compile time (lib/template-compiler.ts) and is data by the time it
// gets here. This is what makes a future client-side editor and this
// exporter agree: both read the same positions and colors from the same
// document.
//
// Same purity rule as lib/slide-renderer.tsx: no Next-server-only
// imports, callable from routes, scripts, and tests alike.
import React from 'react'
import { ImageResponse } from 'next/og'
import {
  FALLBACK_FAMILY,
  FALLBACK_WEIGHT,
  loadLocalFont,
  loadFontsForBrand,
} from '@/lib/slide-renderer'
import { IconName, LucideIcon } from '@/lib/icons'
import {
  Fill,
  IconNode,
  ImageNode,
  ShapeNode,
  SlideDocument,
  SlideNode,
  TextNode,
  imageFillLayerStyle,
} from '@/lib/slideDocument'

type Fonts = Awaited<ReturnType<typeof loadFontsForBrand>>

// Collects the (family, weight) pairs a document actually uses and loads
// them plus the same per-family Noto Sans fallback loadFontsForBrand
// registers (see that function for why a same-name fallback entry is
// required). Primaries first, fallbacks after — order decides which entry
// wins when name+weight tie.
export async function loadFontsForDocument(doc: SlideDocument): Promise<Fonts> {
  const pairs = new Map<string, { family: string; weight: number }>()
  for (const node of doc.nodes) {
    if (node.type === 'text') {
      pairs.set(`${node.fontFamily}-${node.fontWeight}`, {
        family: node.fontFamily,
        weight: node.fontWeight,
      })
    }
  }
  const families = Array.from(new Set(Array.from(pairs.values()).map((p) => p.family)))
  const fallbackData = await loadLocalFont(FALLBACK_FAMILY, FALLBACK_WEIGHT)

  const primary = await Promise.all(
    Array.from(pairs.values()).map(async ({ family, weight }) => ({
      name: family,
      weight: weight as 400 | 500 | 600 | 700 | 800 | 900,
      style: 'normal' as const,
      data: await loadLocalFont(family, weight),
    }))
  )
  const fallbacks = families.map((family) => ({
    name: family,
    weight: FALLBACK_WEIGHT,
    style: 'normal' as const,
    data: fallbackData,
  }))
  return [...primary, ...fallbacks]
}

function fillToBackgroundStyle(fill: Fill): React.CSSProperties {
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
      // Image fills on shapes/canvas render as a dedicated <img> child
      // (see canvas handling below) — as a plain CSS background satori's
      // support is weaker than its <img> support. Shapes with image
      // fills aren't produced by any compiler yet; guard when they are.
      return {}
  }
}

function baseNodeStyle(node: SlideNode): React.CSSProperties {
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

function renderTextNode(node: TextNode): React.ReactElement {
  return React.createElement(
    'div',
    {
      key: node.id,
      style: {
        ...baseNodeStyle(node),
        display: 'flex',
        fontFamily: node.fontFamily,
        fontWeight: node.fontWeight,
        fontSize: node.fontSize,
        color: node.color,
        textAlign: node.align,
        ...(node.align === 'center'
          ? { justifyContent: 'center' }
          : node.align === 'right'
            ? { justifyContent: 'flex-end' }
            : {}),
        ...(node.lineHeight !== undefined ? { lineHeight: node.lineHeight } : {}),
        ...(node.letterSpacing !== undefined ? { letterSpacing: node.letterSpacing } : {}),
      },
    },
    node.text
  )
}

function renderShapeNode(node: ShapeNode): React.ReactElement {
  const style: React.CSSProperties = {
    ...baseNodeStyle(node),
    display: 'flex',
    ...fillToBackgroundStyle(node.fill),
    ...(node.shape === 'ellipse'
      ? { borderRadius: 9999 }
      : node.cornerRadius
        ? { borderRadius: node.cornerRadius }
        : {}),
    ...(node.stroke
      ? { border: `${node.stroke.width}px solid ${node.stroke.color}` }
      : {}),
  }
  return React.createElement('div', { key: node.id, style })
}

function renderImageNode(node: ImageNode): React.ReactElement {
  return React.createElement('img', {
    key: node.id,
    src: node.src,
    width: node.width,
    height: node.height,
    style: { ...baseNodeStyle(node), objectFit: node.fit },
  })
}

function renderIconNode(node: IconNode): React.ReactElement {
  return React.createElement(
    'div',
    { key: node.id, style: { ...baseNodeStyle(node), display: 'flex' } },
    React.createElement(LucideIcon, {
      name: node.name as IconName,
      size: Math.min(node.width, node.height),
      color: node.color,
      strokeWidth: node.strokeWidth ?? 2,
    })
  )
}

function renderNode(node: SlideNode): React.ReactElement {
  switch (node.type) {
    case 'text':
      return renderTextNode(node)
    case 'shape':
      return renderShapeNode(node)
    case 'image':
      return renderImageNode(node)
    case 'icon':
      return renderIconNode(node)
  }
}

export async function renderDocument(doc: SlideDocument, fonts?: Fonts): Promise<Buffer> {
  const resolvedFonts = fonts ?? (await loadFontsForDocument(doc))
  const background = doc.canvas.background

  const children: React.ReactElement[] = []
  if (background.type === 'image') {
    children.push(
      React.createElement('img', {
        key: '__background__',
        src: background.src,
        width: doc.canvas.width,
        height: doc.canvas.height,
        // Shared with the editor's SlideCanvas — pan/zoom (ImageFill
        // scale/offsetX/offsetY) must export exactly as previewed.
        style: imageFillLayerStyle(background, doc.canvas),
      })
    )
  }
  children.push(...doc.nodes.map(renderNode))

  const root = React.createElement(
    'div',
    {
      style: {
        position: 'relative',
        display: 'flex',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        ...(background.type !== 'image' ? fillToBackgroundStyle(background) : {}),
      },
    },
    ...children
  )

  const image = new ImageResponse(root, {
    width: doc.canvas.width,
    height: doc.canvas.height,
    fonts: resolvedFonts,
  })
  return Buffer.from(await image.arrayBuffer())
}
