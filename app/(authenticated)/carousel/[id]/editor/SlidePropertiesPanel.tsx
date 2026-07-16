'use client'

// Canva-flow redesign: per-slide controls that used to live in the
// pre-generate options step (background, typography, hierarchy), now
// scoped to the ACTIVE slide only — shown when no node is selected, so
// the right-hand panel is always contextual: node selected → node
// properties (PropertiesPanel), nothing selected → slide properties.
//
// Typography/hierarchy in a node-tree world aren't settings — they're
// just font values on nodes. So here they're one-click appliers that
// rewrite the active slide's TEXT nodes: the typography preset maps the
// largest text node to the preset's headline pair and the rest to its
// body pair; hierarchy scales the largest text node's size. Applying to
// slide 2 never touches slide 1 — same per-slide independence rule as
// everything else in the editor.
import React, { useRef } from 'react'
import { TYPOGRAPHY_PRESETS } from '@/lib/typography-presets'
import { Fill, SlideDocument, SlideNode, TextNode } from '@/lib/slideDocument'

// Same normalization the node PropertiesPanel uses for <input type="color">.
function toPickerHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  }
  if (/^#[0-9a-fA-F]{8}$/.test(color)) return color.slice(0, 7)
  return '#111827'
}

function largestTextNode(doc: SlideDocument): TextNode | null {
  const texts = doc.nodes.filter((n): n is TextNode => n.type === 'text')
  if (texts.length === 0) return null
  return texts.reduce((max, n) => (n.fontSize > max.fontSize ? n : max))
}

interface Props {
  document: SlideDocument
  // Mutates the ACTIVE document only (same plumbing as node edits:
  // manuallyEdited + autosave + one undo entry via onCommit).
  onMutateDocument: (mutate: (doc: SlideDocument) => SlideDocument) => void
  onCommit: () => void
  onUploadBackgroundPhoto?: (file: File) => void
  uploadingPhoto?: boolean
}

export default function SlidePropertiesPanel({
  document: doc,
  onMutateDocument,
  onCommit,
  onUploadBackgroundPhoto,
  uploadingPhoto = false,
}: Props) {
  const bgPhotoInputRef = useRef<HTMLInputElement>(null)
  const bg = doc.canvas.background

  function setBackground(background: Fill) {
    onMutateDocument((d) => ({ ...d, canvas: { ...d.canvas, background } }))
  }

  function applyTypographyPreset(presetKey: string) {
    const preset = TYPOGRAPHY_PRESETS.find((p) => p.key === presetKey)
    if (!preset) return
    onMutateDocument((d) => {
      const headline = largestTextNode(d)
      return {
        ...d,
        nodes: d.nodes.map((n): SlideNode => {
          if (n.type !== 'text') return n
          return n.id === headline?.id
            ? { ...n, fontFamily: preset.headlineFamily, fontWeight: preset.headlineWeight }
            : { ...n, fontFamily: preset.bodyFamily, fontWeight: preset.bodyWeight }
        }),
      }
    })
    onCommit()
  }

  // Hierarchy relocated from the generate step: headline-focused bumps
  // the biggest text to 76px, balanced to 64px — the same two values the
  // legacy HEADLINE_FONT_SIZE table used, now applied per slide.
  function applyHierarchy(headlineSize: 76 | 64) {
    onMutateDocument((d) => {
      const headline = largestTextNode(d)
      if (!headline) return d
      return {
        ...d,
        nodes: d.nodes.map((n): SlideNode =>
          n.id === headline.id && n.type === 'text' ? { ...n, fontSize: headlineSize } : n
        ),
      }
    })
    onCommit()
  }

  const gradient =
    bg.type === 'linear-gradient'
      ? bg
      : {
          type: 'linear-gradient' as const,
          angle: 180,
          stops: [
            { offset: 0, color: bg.type === 'solid' ? bg.color : '#111827' },
            { offset: 1, color: '#1f2937' },
          ],
        }

  return (
    <div className="w-56 shrink-0 space-y-4 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Properti Slide
      </div>

      <div>
        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Background</span>
        <div className="mb-2 flex gap-1.5">
          {(
            [
              { key: 'solid', label: 'Solid' },
              { key: 'linear-gradient', label: 'Gradien' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                if (t.key === bg.type) return
                if (t.key === 'solid') {
                  setBackground({
                    type: 'solid',
                    color: bg.type === 'linear-gradient' ? toPickerHex(bg.stops[0].color) : '#111827',
                  })
                } else {
                  setBackground(gradient)
                }
                onCommit()
              }}
              className={`flex-1 rounded border py-1 text-xs transition-colors ${
                bg.type === t.key
                  ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {bg.type === 'solid' && (
          <input
            type="color"
            value={toPickerHex(bg.color)}
            onChange={(e) => setBackground({ type: 'solid', color: e.target.value })}
            onBlur={onCommit}
            className="h-8 w-full cursor-pointer rounded border border-gray-300 dark:border-gray-700"
          />
        )}

        {bg.type === 'linear-gradient' && (
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              {bg.stops.slice(0, 2).map((stop, i) => (
                <input
                  key={i}
                  type="color"
                  value={toPickerHex(stop.color)}
                  onChange={(e) =>
                    setBackground({
                      ...bg,
                      stops: bg.stops.map((s, j) => (j === i ? { ...s, color: e.target.value } : s)),
                    })
                  }
                  onBlur={onCommit}
                  className="h-8 flex-1 cursor-pointer rounded border border-gray-300 dark:border-gray-700"
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              Arah
              <input
                type="range"
                min={0}
                max={360}
                step={15}
                value={bg.angle}
                onChange={(e) => setBackground({ ...bg, angle: Number(e.target.value) })}
                onBlur={onCommit}
                className="flex-1"
              />
              {bg.angle}°
            </label>
          </div>
        )}

        {onUploadBackgroundPhoto && (
          <>
            <input
              ref={bgPhotoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onUploadBackgroundPhoto(file)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => bgPhotoInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="mt-1.5 w-full rounded border border-gray-300 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {uploadingPhoto ? 'Mengunggah…' : bg.type === 'image' ? 'Ganti foto background' : 'Upload foto background'}
            </button>
          </>
        )}
      </div>

      <div>
        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
          Preset tipografi (slide ini)
        </span>
        <div className="space-y-1">
          {TYPOGRAPHY_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyTypographyPreset(p.key)}
              className="block w-full rounded border border-gray-200 px-2 py-1 text-left text-xs text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <span style={{ fontFamily: p.headlineFamily, fontWeight: p.headlineWeight }}>
                {p.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
          Hierarki teks (slide ini)
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => applyHierarchy(76)}
            className="flex-1 rounded border border-gray-200 py-1 text-xs text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Headline besar
          </button>
          <button
            type="button"
            onClick={() => applyHierarchy(64)}
            className="flex-1 rounded border border-gray-200 py-1 text-xs text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Seimbang
          </button>
        </div>
      </div>
    </div>
  )
}
