'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import DesignOptionsPanel, {
  BackgroundMode,
  Hierarchy,
  IconSelection,
  LayoutVariant,
  TextDensity,
} from './DesignOptionsPanel'

interface Props {
  postId: string
  buttonStyle?: 'primary' | 'secondary'
  initialLayoutVariant?: LayoutVariant
  initialColorScheme?: string | null
  initialTextDensity?: TextDensity
  initialHierarchy?: Hierarchy
  initialBackgroundImageUrl?: string | null
  initialIconName?: IconSelection
  initialTypographyPreset?: string | null
  brandColors?: Record<string, string> | null
}

export default function RegenerateDesignButton({
  postId,
  buttonStyle = 'secondary',
  initialLayoutVariant = 'minimal',
  initialColorScheme = null,
  initialTextDensity = 'standard',
  initialHierarchy = 'balanced',
  initialBackgroundImageUrl = null,
  initialIconName = 'auto',
  initialTypographyPreset = null,
  brandColors = null,
}: Props) {
  const router = useRouter()
  const [layoutVariant, setLayoutVariant] = useState<LayoutVariant>(initialLayoutVariant)
  const [colorScheme, setColorScheme] = useState<string>(initialColorScheme ?? '')
  const [textDensity, setTextDensity] = useState<TextDensity>(initialTextDensity)
  const [hierarchy, setHierarchy] = useState<Hierarchy>(initialHierarchy)
  const [iconSelection, setIconSelection] = useState<IconSelection>(initialIconName)
  const [typographyPreset, setTypographyPreset] = useState<string | null>(
    initialTypographyPreset
  )
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(
    initialBackgroundImageUrl ? 'image' : 'solid'
  )
  // Switching to solid removes "Editorial (Gradient)" from the Layout
  // dropdown (it only makes sense with a photo) — if it was selected,
  // reset it rather than leaving a value with no matching <option>.
  function handleBackgroundModeChange(mode: BackgroundMode) {
    setBackgroundMode(mode)
    if (mode === 'solid' && layoutVariant === 'editorial_gradient') {
      setLayoutVariant('minimal')
    }
  }
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null)
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(
    initialBackgroundImageUrl
  )
  const [loading, setLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)

    let effectiveBackgroundUrl = backgroundMode === 'image' ? backgroundImageUrl : null

    if (backgroundMode === 'image' && backgroundFile) {
      setLoadingLabel('Mengunggah background…')
      const formData = new FormData()
      formData.append('post_id', postId)
      formData.append('file', backgroundFile)

      const uploadRes = await fetch('/api/carousel/background-upload', {
        method: 'POST',
        body: formData,
      })

      if (!uploadRes.ok) {
        const json = await uploadRes.json().catch(() => ({}))
        setError(json.error ?? 'Background upload failed')
        setLoading(false)
        return
      }

      const { url } = await uploadRes.json()
      effectiveBackgroundUrl = url
      setBackgroundImageUrl(url)
    }

    setLoadingLabel('Membuat desain…')
    const requestBody = {
      post_id: postId,
      layout_variant: layoutVariant,
      color_scheme: colorScheme || null,
      text_density: textDensity,
      hierarchy: hierarchy,
      background_image_url: effectiveBackgroundUrl,
      icon_name: iconSelection === 'auto' ? null : iconSelection,
      typography_preset: typographyPreset,
    }

    // Gated behind NEXT_PUBLIC_DEBUG_DESIGNER rather than always-on: logs
    // the exact body this button is about to send, to compare (in the
    // browser console) against what the designer route logs it received
    // (same gate, server-side) when diagnosing a "design options don't
    // visibly change anything" report — confirms whether the UI's
    // selections are actually captured and sent before looking any
    // further downstream.
    if (process.env.NEXT_PUBLIC_DEBUG_DESIGNER) {
      console.log('RegenerateDesignButton: sending designer request body', requestBody)
    }

    const res = await fetch('/api/carousel/designer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Design generation failed')
      setLoading(false)
      return
    }

    setLoading(false)
    router.refresh()
  }

  const primaryClasses =
    'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
  const secondaryClasses =
    'border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'

  return (
    <div className="space-y-3">
      <DesignOptionsPanel
        layoutVariant={layoutVariant}
        onLayoutVariantChange={setLayoutVariant}
        colorScheme={colorScheme}
        onColorSchemeChange={setColorScheme}
        textDensity={textDensity}
        onTextDensityChange={setTextDensity}
        hierarchy={hierarchy}
        onHierarchyChange={setHierarchy}
        iconSelection={iconSelection}
        onIconSelectionChange={setIconSelection}
        typographyPreset={typographyPreset}
        onTypographyPresetChange={setTypographyPreset}
        backgroundMode={backgroundMode}
        onBackgroundModeChange={handleBackgroundModeChange}
        backgroundImageUrl={backgroundImageUrl}
        backgroundFile={backgroundFile}
        onBackgroundFileChange={setBackgroundFile}
        brandColors={brandColors}
        disabled={loading}
      />

      <button
        onClick={handleClick}
        disabled={loading}
        className={`w-full rounded-lg px-4 py-2 text-sm font-medium ${
          buttonStyle === 'primary' ? primaryClasses : secondaryClasses
        }`}
      >
        {loading
          ? loadingLabel || 'Membuat desain…'
          : buttonStyle === 'primary'
            ? 'Generate Design'
            : 'Regenerate Design'}
      </button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
