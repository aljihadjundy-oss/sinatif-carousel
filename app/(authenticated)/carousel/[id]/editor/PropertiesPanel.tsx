'use client'

// Phase-4 properties panel: per-element font (family/size/weight) and
// color for the selected node. Contrast checks reuse lib/contrast.ts
// and are advisory-only (warn, never block) — the same deliberate-user-
// choice policy the per-slide color wheel established in PR #55-59.
import React from 'react'
import { FONT_CATALOG } from '@/lib/font-catalog'
import {
  getManualColorContrastWarning,
  getManualShapeContrastWarning,
} from '@/lib/contrast'
import { Fill, IconNode, ShapeNode, SlideNode, TextNode } from '@/lib/slideDocument'

const FONT_WEIGHT_LABELS: Record<number, string> = {
  400: 'Regular (400)',
  500: 'Medium (500)',
  600: 'Semibold (600)',
  700: 'Bold (700)',
  800: 'Extrabold (800)',
  900: 'Black (900)',
}

// <input type="color"> only accepts #rrggbb — normalize what documents
// may carry (#rgb, rgba(), #rrggbbaa) to something the picker can show,
// falling back to black for non-hex (the stored value stays untouched
// until the user actually picks).
function toPickerHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  }
  if (/^#[0-9a-fA-F]{8}$/.test(color)) return color.slice(0, 7)
  return '#000000'
}

interface Props {
  node: SlideNode
  canvasBackground: Fill
  onUpdateNode: (
    nodeId: string,
    partial: Partial<TextNode> | Partial<ShapeNode> | Partial<IconNode>
  ) => void
  // Ends the current edit unit (history entry + autosave flush follows
  // via the normal debounce) — called on blur so a color-picker drag or
  // size spinner session is one undo step, not dozens.
  onCommit: () => void
}

export default function PropertiesPanel({ node, canvasBackground, onUpdateNode, onCommit }: Props) {
  const bgSolid = canvasBackground.type === 'solid' ? canvasBackground.color : null

  if (node.type === 'image') {
    return (
      <div className="w-56 shrink-0 space-y-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Properti Gambar
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Geser/ubah ukuran langsung di kanvas. Mengganti sumber gambar belum tersedia di
          fase ini.
        </p>
      </div>
    )
  }

  return (
    <div className="w-56 shrink-0 space-y-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {node.type === 'text' ? 'Properti Teks' : node.type === 'icon' ? 'Properti Ikon' : 'Properti Shape'}
      </div>

      {node.type === 'icon' && (
        <>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Warna ikon</span>
            <input
              type="color"
              value={toPickerHex(node.color)}
              onChange={(e) => onUpdateNode(node.id, { color: e.target.value })}
              onBlur={onCommit}
              className="h-8 w-full cursor-pointer rounded border border-gray-300 dark:border-gray-700"
            />
          </label>
          {bgSolid &&
            (() => {
              const warning = getManualShapeContrastWarning(toPickerHex(node.color), bgSolid)
              return warning ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">{warning}</p>
              ) : null
            })()}
        </>
      )}

      {node.type === 'text' && (
        <>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Font</span>
            <select
              value={node.fontFamily}
              onChange={(e) => {
                const family = e.target.value
                const weights = FONT_CATALOG.find((f) => f.family === family)?.weights ?? [400]
                // Keep the current weight when the new family has it,
                // else snap to the nearest available — the exporter can
                // only render weights that exist as files.
                const weight = weights.includes(node.fontWeight)
                  ? node.fontWeight
                  : weights.reduce((best, w) =>
                      Math.abs(w - node.fontWeight) < Math.abs(best - node.fontWeight) ? w : best
                    )
                onUpdateNode(node.id, {
                  fontFamily: family,
                  fontWeight: weight as TextNode['fontWeight'],
                })
                onCommit()
              }}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              {FONT_CATALOG.map((f) => (
                <option key={f.family} value={f.family}>
                  {f.family}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-2">
            <label className="block flex-1">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Ukuran</span>
              <input
                type="number"
                min={8}
                max={400}
                value={node.fontSize}
                onChange={(e) => {
                  const size = Number(e.target.value)
                  if (!Number.isFinite(size) || size < 8 || size > 400) return
                  onUpdateNode(node.id, { fontSize: size })
                }}
                onBlur={onCommit}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
              />
            </label>
            <label className="block flex-1">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Weight</span>
              <select
                value={node.fontWeight}
                onChange={(e) => {
                  onUpdateNode(node.id, {
                    fontWeight: Number(e.target.value) as TextNode['fontWeight'],
                  })
                  onCommit()
                }}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
              >
                {(FONT_CATALOG.find((f) => f.family === node.fontFamily)?.weights ?? [node.fontWeight]).map(
                  (w) => (
                    <option key={w} value={w}>
                      {FONT_WEIGHT_LABELS[w] ?? w}
                    </option>
                  )
                )}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Warna teks</span>
            <input
              type="color"
              value={toPickerHex(node.color)}
              onChange={(e) => onUpdateNode(node.id, { color: e.target.value })}
              onBlur={onCommit}
              className="h-8 w-full cursor-pointer rounded border border-gray-300 dark:border-gray-700"
            />
          </label>
          {bgSolid &&
            (() => {
              const warning = getManualColorContrastWarning('font', toPickerHex(node.color), bgSolid)
              return warning ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">{warning}</p>
              ) : null
            })()}
        </>
      )}

      {node.type === 'shape' &&
        (node.fill.type === 'solid' ? (
          <>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Warna isi</span>
              <input
                type="color"
                value={toPickerHex(node.fill.color)}
                onChange={(e) =>
                  onUpdateNode(node.id, { fill: { type: 'solid', color: e.target.value } })
                }
                onBlur={onCommit}
                className="h-8 w-full cursor-pointer rounded border border-gray-300 dark:border-gray-700"
              />
            </label>
            {bgSolid &&
              (() => {
                const warning = getManualShapeContrastWarning(toPickerHex(node.fill.color), bgSolid)
                return warning ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">{warning}</p>
                ) : null
              })()}
          </>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Shape ini memakai isi {node.fill.type === 'image' ? 'gambar' : 'gradien'} — belum bisa
            diedit di MVP ini.
          </p>
        ))}
    </div>
  )
}
