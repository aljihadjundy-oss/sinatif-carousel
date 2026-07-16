'use client'

// Asset library (Canva-flow redesign): a browsable bank of icons and
// decorative shapes, inserted into the ACTIVE slide with one click.
//
// Icons come from lib/icon-catalog.ts (~90 curated lucide icons, tree-
// shaken imports — free, no Iconify dependency needed at this size).
// Shapes are PREFABS over the existing ShapeNode primitives (rect/
// ellipse/line + fill/stroke/cornerRadius/opacity) — zero schema
// changes, so every gallery item is exportable by renderDocument()
// exactly like any hand-added shape, and the write-boundary validation
// already covers them.
import React, { useState } from 'react'
import { ICON_CATEGORIES } from '@/lib/icon-catalog'
import { LucideIcon } from '@/lib/icons'
import { ShapeNode } from '@/lib/slideDocument'

export type ShapePrefab = Omit<ShapeNode, 'id' | 'type' | 'x' | 'y'> & { label: string }

// `color` placeholders are swapped for a contrast-aware color at insert
// time (SlideEditor decides, same rule addNode already uses).
export const SHAPE_PREFABS: ShapePrefab[] = [
  { label: 'Kotak', shape: 'rect', width: 300, height: 300, fill: { type: 'solid', color: '__accent__' } },
  { label: 'Kotak membulat', shape: 'rect', width: 320, height: 220, cornerRadius: 24, fill: { type: 'solid', color: '__accent__' } },
  { label: 'Pil', shape: 'rect', width: 320, height: 96, cornerRadius: 9999, fill: { type: 'solid', color: '__accent__' } },
  { label: 'Lingkaran', shape: 'ellipse', width: 280, height: 280, fill: { type: 'solid', color: '__accent__' } },
  { label: 'Ring', shape: 'ellipse', width: 280, height: 280, fill: { type: 'solid', color: 'rgba(0,0,0,0)' }, stroke: { color: '__accent__', width: 12 } },
  { label: 'Oval', shape: 'ellipse', width: 360, height: 220, fill: { type: 'solid', color: '__accent__' } },
  { label: 'Garis tebal', shape: 'rect', width: 320, height: 10, fill: { type: 'solid', color: '__accent__' } },
  { label: 'Garis tipis', shape: 'rect', width: 320, height: 3, fill: { type: 'solid', color: '__accent__' } },
  { label: 'Batang vertikal', shape: 'rect', width: 10, height: 260, fill: { type: 'solid', color: '__accent__' } },
  { label: 'Kotak outline', shape: 'rect', width: 300, height: 300, fill: { type: 'solid', color: 'rgba(0,0,0,0)' }, stroke: { color: '__accent__', width: 6 } },
  { label: 'Kartu translusen', shape: 'rect', width: 480, height: 300, cornerRadius: 20, fill: { type: 'solid', color: 'rgba(255,255,255,0.85)' } },
  { label: 'Scrim gelap', shape: 'rect', width: 480, height: 300, cornerRadius: 20, fill: { type: 'solid', color: 'rgba(0,0,0,0.55)' } },
  { label: 'Lingkaran lembut', shape: 'ellipse', width: 340, height: 340, fill: { type: 'solid', color: '__accent__' }, opacity: 0.15 },
  {
    label: 'Gradien blok',
    shape: 'rect',
    width: 420,
    height: 280,
    cornerRadius: 16,
    fill: {
      type: 'linear-gradient',
      angle: 135,
      stops: [
        { offset: 0, color: '#2563eb' },
        { offset: 1, color: '#9333ea' },
      ],
    },
  },
  { label: 'Titik', shape: 'ellipse', width: 28, height: 28, fill: { type: 'solid', color: '__accent__' } },
]

interface Props {
  onInsertIcon: (name: string) => void
  onInsertShape: (prefab: ShapePrefab) => void
  onClose: () => void
}

export default function AssetDrawer({ onInsertIcon, onInsertShape, onClose }: Props) {
  const [tab, setTab] = useState<'icons' | 'shapes'>('icons')
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()

  return (
    <div className="w-64 shrink-0 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex gap-1">
          {(
            [
              { key: 'icons', label: 'Ikon' },
              { key: 'shapes', label: 'Shape' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                tab === t.key
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          title="Tutup"
        >
          ✕
        </button>
      </div>

      {tab === 'icons' && (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari ikon…"
            className="mb-2 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
          />
          <div className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
            {ICON_CATEGORIES.map((cat) => {
              const icons = q
                ? cat.icons.filter((i) => i.name.toLowerCase().includes(q))
                : cat.icons
              if (icons.length === 0) return null
              return (
                <div key={cat.name}>
                  <div className="mb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                    {cat.name}
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {icons.map((icon) => (
                      <button
                        key={icon.name}
                        type="button"
                        title={icon.name}
                        onClick={() => onInsertIcon(icon.name)}
                        className="flex items-center justify-center rounded border border-transparent p-1.5 text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <LucideIcon name={icon.name} size={20} color="currentColor" strokeWidth={2} />
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {tab === 'shapes' && (
        <div className="grid max-h-[480px] grid-cols-2 gap-1.5 overflow-y-auto pr-1">
          {SHAPE_PREFABS.map((prefab) => (
            <button
              key={prefab.label}
              type="button"
              onClick={() => onInsertShape(prefab)}
              className="flex h-20 flex-col items-center justify-center gap-1 rounded border border-gray-200 p-1 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              <span
                className="block"
                style={{
                  width: Math.min(48, (prefab.width / Math.max(prefab.width, prefab.height)) * 48),
                  height: Math.min(48, (prefab.height / Math.max(prefab.width, prefab.height)) * 48),
                  minHeight: 3,
                  minWidth: 3,
                  borderRadius:
                    prefab.shape === 'ellipse' ? 9999 : Math.min(8, (prefab.cornerRadius ?? 0) / 3),
                  background:
                    prefab.fill.type === 'linear-gradient'
                      ? `linear-gradient(${prefab.fill.angle}deg, ${prefab.fill.stops.map((s) => s.color).join(',')})`
                      : prefab.fill.type === 'solid'
                        ? prefab.fill.color === '__accent__'
                          ? '#3b82f6'
                          : prefab.fill.color
                        : undefined,
                  border: prefab.stroke
                    ? `2px solid ${prefab.stroke.color === '__accent__' ? '#3b82f6' : prefab.stroke.color}`
                    : undefined,
                  opacity: prefab.opacity,
                }}
              />
              <span className="text-[10px] leading-tight text-gray-500 dark:text-gray-400">
                {prefab.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
