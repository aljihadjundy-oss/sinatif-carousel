'use client'

import { ICON_NAMES, IconName, LucideIcon } from '@/lib/icons'
import { TYPOGRAPHY_PRESETS } from '@/lib/typography-presets'

export type LayoutVariant =
  | 'minimal'
  | 'accent'
  | 'editorial_gradient'
  | 'flat_icon_list'
  | 'flat_mockup_card'

// Thumbnails are static PNGs committed under public/layout-previews/,
// generated once by scripts/generate-layout-previews.ts — never rendered
// at runtime. imageOnly gates editorial_gradient out of the grid when
// there's no background photo to apply it to (the designer route falls
// back to accent-like rendering if it's ever submitted without one, but
// there's no reason to offer it here in that case). ignoresBackgroundImage
// flags the flat/no-photo layouts, which the designer route intentionally
// ignores background_image_url for regardless of whether one's set — a
// real report of "regenerated and got a plain solid background instead
// of my photo" turned out to be exactly this (a flat_mockup_card post
// whose brand palette's first color happened to be named "gray"), not a
// bug in how the background URL is resolved/sent. The warning below the
// Background section is the fix: surface this up front instead of
// letting it look like a broken photo.
const LAYOUT_OPTIONS: {
  key: LayoutVariant
  name: string
  imageOnly?: boolean
  ignoresBackgroundImage?: boolean
}[] = [
  { key: 'minimal', name: 'Minimal' },
  { key: 'accent', name: 'Accent' },
  { key: 'editorial_gradient', name: 'Editorial (Gradient)', imageOnly: true },
  { key: 'flat_icon_list', name: 'Flat Icon List', ignoresBackgroundImage: true },
  { key: 'flat_mockup_card', name: 'Flat Mockup Card', ignoresBackgroundImage: true },
]
export type TextDensity = 'concise' | 'standard' | 'detailed'
export type Hierarchy = 'headline_focused' | 'balanced'
export type BackgroundMode = 'solid' | 'image' | 'ai'
export type IconSelection = 'auto' | 'none' | IconName

// Pure, controlled options UI shared by RegenerateDesignButton.tsx (design
// already exists, editing it) and NewCarouselForm.tsx (design doesn't
// exist yet, choosing options before the first generation) — both flows
// need the exact same set of controls, just wired to different submit
// logic/state ownership, so this component owns none of that itself.
interface Props {
  layoutVariant: LayoutVariant
  onLayoutVariantChange: (value: LayoutVariant) => void
  colorScheme: string
  onColorSchemeChange: (value: string) => void
  textDensity: TextDensity
  onTextDensityChange: (value: TextDensity) => void
  hierarchy: Hierarchy
  onHierarchyChange: (value: Hierarchy) => void
  iconSelection: IconSelection
  onIconSelectionChange: (value: IconSelection) => void
  typographyPreset: string | null
  onTypographyPresetChange: (value: string | null) => void
  backgroundMode: BackgroundMode
  onBackgroundModeChange: (value: BackgroundMode) => void
  backgroundImageUrl: string | null
  backgroundFile: File | null
  onBackgroundFileChange: (file: File | null) => void
  // "Generate with AI" — deliberately NOT a single "generate and use"
  // action: aiPreviewUrl holds a generated-but-not-yet-confirmed image,
  // shown with explicit "Use This Image" / "Try Again" choices, since
  // Pollinations has minimal content moderation and results need human
  // review before being used as real (often client-facing) brand
  // content. This component only renders the prompt/preview UI; the
  // actual generation call and "use" logic live in the parent, same
  // division of responsibility as backgroundFile/onBackgroundFileChange
  // above.
  aiPrompt: string
  onAiPromptChange: (value: string) => void
  aiPreviewUrl: string | null
  onGeneratePreview: () => void
  onUseAiImage: () => void
  generatingAi?: boolean
  aiError?: string | null
  brandColors?: Record<string, string> | null
  disabled?: boolean
}

const selectClasses =
  'border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'

export default function DesignOptionsPanel({
  layoutVariant,
  onLayoutVariantChange,
  colorScheme,
  onColorSchemeChange,
  textDensity,
  onTextDensityChange,
  hierarchy,
  onHierarchyChange,
  iconSelection,
  onIconSelectionChange,
  typographyPreset,
  onTypographyPresetChange,
  backgroundMode,
  onBackgroundModeChange,
  backgroundImageUrl,
  backgroundFile,
  onBackgroundFileChange,
  aiPrompt,
  onAiPromptChange,
  aiPreviewUrl,
  onGeneratePreview,
  onUseAiImage,
  generatingAi = false,
  aiError = null,
  brandColors = null,
  disabled = false,
}: Props) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-3 dark:border-gray-800">
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          Layout
        </label>
        {/* Visual picker (thumbnail + name, radio-style selection) instead
            of a plain dropdown — same pattern as the Typography picker
            below, applied here too so every layout option has a visual
            preview rather than just a text label. */}
        <div className="grid grid-cols-4 gap-1.5">
          {LAYOUT_OPTIONS.filter(
            (opt) => !opt.imageOnly || backgroundMode === 'image' || backgroundMode === 'ai'
          ).map(
            (opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => onLayoutVariantChange(opt.key)}
                disabled={disabled}
                className={`rounded-lg border p-1 text-left disabled:opacity-50 ${
                  layoutVariant === opt.key
                    ? 'border-blue-600 bg-blue-50 dark:border-blue-500 dark:bg-blue-500/10'
                    : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/layout-previews/${opt.key}.png`}
                  alt={opt.name}
                  className="w-full aspect-[400/500] rounded object-cover border border-gray-200 dark:border-gray-700"
                />
                <p
                  className={`mt-1 text-[11px] font-medium truncate ${
                    layoutVariant === opt.key
                      ? 'text-blue-700 dark:text-blue-400'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {opt.name}
                </p>
              </button>
            )
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {brandColors && Object.keys(brandColors).length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Color Scheme
            </label>
            <select
              value={colorScheme}
              onChange={(e) => onColorSchemeChange(e.target.value)}
              disabled={disabled}
              className={`w-full ${selectClasses}`}
            >
              <option value="">Default</option>
              {Object.entries(brandColors).map(([name, hex]) => (
                <option key={name} value={name}>
                  {name.replace(/_/g, ' ')} ({hex})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Text Density
          </label>
          <select
            value={textDensity}
            onChange={(e) => onTextDensityChange(e.target.value as TextDensity)}
            disabled={disabled}
            className={`w-full ${selectClasses}`}
          >
            <option value="concise">Concise</option>
            <option value="standard">Standard</option>
            <option value="detailed">Detailed</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Hierarchy
          </label>
          <select
            value={hierarchy}
            onChange={(e) => onHierarchyChange(e.target.value as Hierarchy)}
            disabled={disabled}
            className={`w-full ${selectClasses}`}
          >
            <option value="headline_focused">Headline-focused</option>
            <option value="balanced">Balanced</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          Icon (Accent / Flat Icon List layouts only)
        </label>
        <div className="flex flex-wrap gap-1.5">
          {(['auto', 'none', ...ICON_NAMES] as IconSelection[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onIconSelectionChange(option)}
              disabled={disabled}
              title={option}
              className={`flex items-center justify-center w-9 h-9 rounded-lg border text-xs font-medium disabled:opacity-50 ${
                iconSelection === option
                  ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-500/10 dark:text-blue-400'
                  : 'border-gray-300 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'
              }`}
            >
              {option === 'auto' ? (
                'Auto'
              ) : option === 'none' ? (
                'None'
              ) : (
                <LucideIcon name={option} size={18} strokeWidth={2} />
              )}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          Typography
        </label>
        {/* Visual picker (thumbnail + name, radio-style selection) instead
            of a plain dropdown, so users see the actual font pairing
            rather than just a label — same selected/unselected border
            treatment as the icon picker above for consistency. Thumbnails
            are static PNGs committed under public/typography-previews/,
            generated once by scripts/generate-typography-previews.ts —
            never rendered at runtime. */}
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => onTypographyPresetChange(null)}
            disabled={disabled}
            className={`rounded-lg border p-1 text-left disabled:opacity-50 ${
              typographyPreset === null
                ? 'border-blue-600 bg-blue-50 dark:border-blue-500 dark:bg-blue-500/10'
                : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
            }`}
          >
            <div className="w-full aspect-[400/250] rounded bg-gray-100 flex items-center justify-center dark:bg-gray-800">
              <span className="text-xs text-gray-500 dark:text-gray-400">Aa</span>
            </div>
            <p
              className={`mt-1 text-[11px] font-medium truncate ${
                typographyPreset === null
                  ? 'text-blue-700 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              Brand Default
            </p>
          </button>

          {TYPOGRAPHY_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => onTypographyPresetChange(preset.key)}
              disabled={disabled}
              className={`rounded-lg border p-1 text-left disabled:opacity-50 ${
                typographyPreset === preset.key
                  ? 'border-blue-600 bg-blue-50 dark:border-blue-500 dark:bg-blue-500/10'
                  : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/typography-previews/${preset.key}.png`}
                alt={preset.name}
                className="w-full aspect-[400/250] rounded object-cover border border-gray-200 dark:border-gray-700"
              />
              <p
                className={`mt-1 text-[11px] font-medium truncate ${
                  typographyPreset === preset.key
                    ? 'text-blue-700 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                {preset.name}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          Background
        </label>
        {LAYOUT_OPTIONS.find((opt) => opt.key === layoutVariant)?.ignoresBackgroundImage && (
          <p className="mb-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/30">
            The selected layout ({LAYOUT_OPTIONS.find((opt) => opt.key === layoutVariant)?.name})
            is a flat, no-photo style — any background image chosen below won&apos;t be used.
            Pick Minimal, Accent, or Editorial (Gradient) to use a photo.
          </p>
        )}
        <div className="flex rounded-lg border border-gray-300 p-1 dark:border-gray-700">
          <button
            type="button"
            onClick={() => onBackgroundModeChange('solid')}
            disabled={disabled}
            className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${
              backgroundMode === 'solid'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
          >
            Solid Color
          </button>
          <button
            type="button"
            onClick={() => onBackgroundModeChange('image')}
            disabled={disabled}
            className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${
              backgroundMode === 'image'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
          >
            Upload Image
          </button>
          <button
            type="button"
            onClick={() => onBackgroundModeChange('ai')}
            disabled={disabled}
            className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${
              backgroundMode === 'ai'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
          >
            Generate with AI
          </button>
        </div>

        {backgroundMode === 'image' && (
          <div className="mt-2 space-y-1">
            {backgroundImageUrl && !backgroundFile && (
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={backgroundImageUrl}
                  alt="Current background"
                  className="w-10 h-10 object-cover rounded border border-gray-200 dark:border-gray-700"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">Current background — choose a file to replace it</span>
              </div>
            )}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onBackgroundFileChange(e.target.files?.[0] ?? null)}
              disabled={disabled}
              className="w-full text-sm bg-white text-gray-900 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200 dark:bg-gray-900 dark:text-gray-100 dark:file:bg-gray-800 dark:file:text-gray-300 dark:hover:file:bg-gray-700"
            />
          </div>
        )}

        {backgroundMode === 'ai' && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              AI-generated images may occasionally produce unexpected results —
              please review before using.
            </p>

            <textarea
              value={aiPrompt}
              onChange={(e) => onAiPromptChange(e.target.value)}
              disabled={disabled || generatingAi}
              rows={2}
              placeholder="Describe the background image you want…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
            />

            {backgroundImageUrl && !aiPreviewUrl && (
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={backgroundImageUrl}
                  alt="Current background"
                  className="w-10 h-10 object-cover rounded border border-gray-200 dark:border-gray-700"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Current background — generate a new one to replace it
                </span>
              </div>
            )}

            {aiPreviewUrl ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={aiPreviewUrl}
                  alt="Generated preview"
                  className="w-full max-w-[240px] aspect-[1080/1350] object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onUseAiImage}
                    disabled={disabled || generatingAi}
                    className="flex-1 rounded-lg bg-blue-600 text-white py-1.5 text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    Use This Image
                  </button>
                  <button
                    type="button"
                    onClick={onGeneratePreview}
                    disabled={disabled || generatingAi || !aiPrompt.trim()}
                    className="flex-1 rounded-lg border border-gray-300 text-gray-700 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    {generatingAi ? 'Generating…' : 'Try Again'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onGeneratePreview}
                disabled={disabled || generatingAi || !aiPrompt.trim()}
                className="w-full rounded-lg border border-gray-300 text-gray-700 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {generatingAi ? 'Generating…' : 'Generate Preview'}
              </button>
            )}

            {aiError && <p className="text-xs text-red-600 dark:text-red-400">{aiError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
