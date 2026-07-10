// One-time script — not a deployed route. Run with:
//   npx tsx scripts/generate-typography-previews.ts
//
// Renders a small font-pairing preview PNG per entry in
// lib/typography-presets.ts and writes it to
// public/typography-previews/{preset_key}.png. These are committed as
// static files and never regenerated at runtime — re-run this script by
// hand if a preset's fonts ever change.
//
// Does NOT import app/api/carousel/designer/route.tsx: that route pulls
// in createServerSupabaseClient() (next/headers' cookies()), which
// throws outside a real Next.js request context. This script duplicates
// just the small font-file-loading helper instead, working from the same
// public/fonts/ files the designer route already uses.
import { readFile, mkdir, writeFile } from 'fs/promises'
import path from 'path'
import * as React from 'react'
import { ImageResponse } from 'next/og'
import { TYPOGRAPHY_PRESETS, FontWeight } from '../lib/typography-presets'

const PREVIEW_WIDTH = 400
const PREVIEW_HEIGHT = 250
const HEADLINE_SAMPLE = 'Judul Menarik Anda'
const BODY_SAMPLE = 'Contoh teks body untuk preview tipografi ini.'

// Mirrors FONT_FILES in app/api/carousel/designer/route.tsx — kept as a
// separate copy rather than importing that route (see header comment).
const FONT_FILES: Record<string, string> = {
  'Inter-400': 'inter-400.ttf',
  'Inter-600': 'inter-600.ttf',
  'Inter-700': 'inter-700.ttf',
  'Khand-700': 'khand-700.ttf',
  'Nunito-400': 'nunito-400.ttf',
  'Cinzel-700': 'cinzel-700.ttf',
  'Poppins-400': 'poppins-400.ttf',
  'Archivo Black-400': 'archivo-black-400.ttf',
  'Architects Daughter-400': 'architects-daughter-400.ttf',
  'Noto Sans-400': 'noto-sans-400.ttf',
}

async function loadLocalFont(family: string, weight: FontWeight): Promise<ArrayBuffer> {
  const key = `${family}-${weight}`
  const filename = FONT_FILES[key]
  if (!filename) {
    throw new Error(`No bundled font file registered for ${key}`)
  }
  const filePath = path.join(process.cwd(), 'public', 'fonts', filename)
  const buffer = await readFile(filePath)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

async function renderPreview(preset: (typeof TYPOGRAPHY_PRESETS)[number]): Promise<Buffer> {
  const sameFont =
    preset.headlineFamily === preset.bodyFamily && preset.headlineWeight === preset.bodyWeight

  const headlineData = await loadLocalFont(preset.headlineFamily, preset.headlineWeight)
  const bodyData = sameFont ? headlineData : await loadLocalFont(preset.bodyFamily, preset.bodyWeight)

  const fonts = [
    {
      name: preset.headlineFamily,
      weight: preset.headlineWeight,
      style: 'normal' as const,
      data: headlineData,
    },
    ...(sameFont
      ? []
      : [
          {
            name: preset.bodyFamily,
            weight: preset.bodyWeight,
            style: 'normal' as const,
            data: bodyData,
          },
        ]),
  ]

  const element = React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 14,
        backgroundColor: '#F9FAFB',
        padding: 32,
      },
    },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          fontFamily: preset.headlineFamily,
          fontWeight: preset.headlineWeight,
          fontSize: 32,
          color: '#111827',
          lineHeight: 1.2,
        },
      },
      HEADLINE_SAMPLE
    ),
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          fontFamily: preset.bodyFamily,
          fontWeight: preset.bodyWeight,
          fontSize: 16,
          color: '#4B5563',
          lineHeight: 1.4,
        },
      },
      BODY_SAMPLE
    )
  )

  const image = new ImageResponse(element, {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    fonts,
  })
  return Buffer.from(await image.arrayBuffer())
}

async function main() {
  const outDir = path.join(process.cwd(), 'public', 'typography-previews')
  await mkdir(outDir, { recursive: true })

  for (const preset of TYPOGRAPHY_PRESETS) {
    const buffer = await renderPreview(preset)
    const outPath = path.join(outDir, `${preset.key}.png`)
    await writeFile(outPath, buffer)
    console.log(`wrote ${outPath} (${buffer.length} bytes)`)
  }
}

main().catch((err) => {
  console.error('generate-typography-previews failed:', err)
  process.exit(1)
})
