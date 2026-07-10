'use client'

import { ICON_NAMES, IconName, LucideIcon } from '@/lib/icons'

export type LayoutVariant = 'minimal' | 'accent'
export type TextDensity = 'concise' | 'standard' | 'detailed'
export type Hierarchy = 'headline_focused' | 'balanced'
export type BackgroundMode = 'solid' | 'image'
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
  backgroundMode: BackgroundMode
  onBackgroundModeChange: (value: BackgroundMode) => void
  backgroundImageUrl: string | null
  backgroundFile: File | null
  onBackgroundFileChange: (file: File | null) => void
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
  backgroundMode,
  onBackgroundModeChange,
  backgroundImageUrl,
  backgroundFile,
  onBackgroundFileChange,
  brandColors = null,
  disabled = false,
}: Props) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-3 dark:border-gray-800">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Layout
          </label>
          <select
            value={layoutVariant}
            onChange={(e) => onLayoutVariantChange(e.target.value as LayoutVariant)}
            disabled={disabled}
            className={`w-full ${selectClasses}`}
          >
            <option value="minimal">Minimal</option>
            <option value="accent">Accent</option>
          </select>
        </div>

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
          Icon (accent layout only)
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
          Background
        </label>
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
      </div>
    </div>
  )
}
