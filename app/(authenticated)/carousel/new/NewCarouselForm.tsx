'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { BrandProfileSummary } from '@/lib/types'

interface Props {
  profiles: BrandProfileSummary[]
}

type Mode = 'ai' | 'manual'

interface ManualSlide {
  headline: string
  body: string
}

export default function NewCarouselForm({ profiles }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>('ai')
  const [brandProfileId, setBrandProfileId] = useState(profiles[0]?.id ?? '')
  const [topic, setTopic] = useState('')
  const [audience, setAudience] = useState('')
  const [goal, setGoal] = useState('')
  const [manualSlides, setManualSlides] = useState<ManualSlide[]>([
    { headline: '', body: '' },
  ])
  const [stage, setStage] = useState<'idle' | 'script' | 'design'>('idle')
  const [error, setError] = useState<string | null>(null)

  const loading = stage !== 'idle'
  const loadingLabel =
    stage === 'script'
      ? mode === 'manual'
        ? 'Menyimpan script…'
        : 'Menulis script…'
      : stage === 'design'
        ? 'Membuat desain…'
        : mode === 'manual'
          ? 'Save & Generate Design'
          : 'Generate Script'

  function profileLabel(p: BrandProfileSummary) {
    const tag =
      p.profile_type === 'internal_bu' && p.business_unit
        ? p.business_unit
        : 'Client'
    return `${p.name} (${tag})`
  }

  function updateManualSlide(index: number, field: keyof ManualSlide, value: string) {
    setManualSlides((slides) =>
      slides.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    )
  }

  function addManualSlide() {
    setManualSlides((slides) => [...slides, { headline: '', body: '' }])
  }

  function removeManualSlide(index: number) {
    setManualSlides((slides) =>
      slides.length > 1 ? slides.filter((_, i) => i !== index) : slides
    )
  }

  async function runDesignerAndRedirect(id: string) {
    setStage('design')
    await fetch('/api/carousel/designer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: id }),
    })

    // Land on the post either way — the script already exists, and the
    // detail page offers a retry if design generation failed.
    router.push(`/carousel/${id}`)
  }

  async function handleAiSubmit() {
    const scriptRes = await fetch('/api/carousel/script-writer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand_profile_id: brandProfileId,
        topic,
        audience,
        goal,
      }),
    })

    if (!scriptRes.ok) {
      const json = await scriptRes.json().catch(() => ({}))
      setError(json.error ?? 'Something went wrong')
      setStage('idle')
      return
    }

    const { id } = await scriptRes.json()
    await runDesignerAndRedirect(id)
  }

  async function handleManualSubmit() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setError('Not authenticated')
      setStage('idle')
      return
    }

    const { data: post, error: postErr } = await supabase
      .schema('carousel')
      .from('posts')
      .insert({
        user_id: user.id,
        brand_profile_id: brandProfileId,
        topic,
        status: 'scripted',
      })
      .select('id')
      .single()

    if (postErr || !post) {
      setError(postErr?.message ?? 'Failed to create post')
      setStage('idle')
      return
    }

    const slides = manualSlides.map((s, i) => ({
      index: i + 1,
      headline: s.headline,
      body: s.body,
    }))

    const { error: stageErr } = await supabase
      .schema('carousel')
      .from('stage_outputs')
      .insert({
        post_id: post.id,
        stage: 'script',
        output_json: { title: topic, slides },
      })

    if (stageErr) {
      setError(stageErr.message)
      setStage('idle')
      return
    }

    await runDesignerAndRedirect(post.id)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStage('script')
    setError(null)

    if (mode === 'ai') {
      await handleAiSubmit()
    } else {
      await handleManualSubmit()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex rounded-lg border border-gray-300 p-1 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setMode('ai')}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
            mode === 'ai'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
          }`}
        >
          Generate with AI
        </button>
        <button
          type="button"
          onClick={() => setMode('manual')}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
            mode === 'manual'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
          }`}
        >
          Write My Own Script
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Brand Profile <span className="text-red-500">*</span>
        </label>
        <select
          value={brandProfileId}
          onChange={(e) => setBrandProfileId(e.target.value)}
          required
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {profileLabel(p)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-400">
          Don&apos;t have one?{' '}
          <a href="/carousel/brands" className="underline">
            Create a brand profile
          </a>
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Topic <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          required
          placeholder="e.g. 5 cara meningkatkan engagement Instagram"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {mode === 'ai' ? (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Target Audience
            </label>
            <input
              type="text"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="e.g. UMKM yang ingin scale digital marketing"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Goal
            </label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Educate, drive DM inquiries"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            Slides <span className="text-red-500">*</span>
          </label>

          {manualSlides.map((slide, i) => (
            <div
              key={i}
              className="border border-gray-200 rounded-lg p-4 space-y-3 dark:border-gray-800"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-400">Slide {i + 1}</p>
                {manualSlides.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeManualSlide(i)}
                    className="text-gray-400 hover:text-red-600 text-sm leading-none"
                    aria-label={`Remove slide ${i + 1}`}
                  >
                    ×
                  </button>
                )}
              </div>
              <input
                type="text"
                value={slide.headline}
                onChange={(e) => updateManualSlide(i, 'headline', e.target.value)}
                required
                placeholder="Headline"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <textarea
                value={slide.body}
                onChange={(e) => updateManualSlide(i, 'body', e.target.value)}
                rows={3}
                placeholder="Body"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}

          <button
            type="button"
            onClick={addManualSlide}
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            + Add Slide
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {loadingLabel}
      </button>
    </form>
  )
}
