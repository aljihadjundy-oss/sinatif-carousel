'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { BrandProfileSummary } from '@/lib/types'

interface Props {
  profiles: BrandProfileSummary[]
}

type Mode = 'ai' | 'manual' | 'research'

interface ManualSlide {
  headline: string
  body: string
}

interface Idea {
  title: string
  hook: string
  angle_description: string
}

export default function NewCarouselForm({ profiles }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>('ai')
  const [brandProfileId, setBrandProfileId] = useState(profiles[0]?.id ?? '')
  const [topic, setTopic] = useState('')
  const [audience, setAudience] = useState('')
  const [goal, setGoal] = useState('')
  const [slideCount, setSlideCount] = useState(7)
  const [manualSlides, setManualSlides] = useState<ManualSlide[]>([
    { headline: '', body: '' },
  ])
  const [researchText, setResearchText] = useState('')
  const [ideas, setIdeas] = useState<Idea[] | null>(null)
  const [ideationLoading, setIdeationLoading] = useState(false)
  const [ideationError, setIdeationError] = useState<string | null>(null)
  const [selectingIdea, setSelectingIdea] = useState<string | null>(null)
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

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
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
        slide_count: slideCount,
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

  async function handleGenerateIdeas() {
    setIdeationError(null)
    setIdeationLoading(true)
    setIdeas(null)

    const res = await fetch('/api/carousel/ideation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        research_text: researchText,
        brand_profile_id: brandProfileId,
      }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setIdeationError(json.error ?? 'Failed to generate ideas')
      setIdeationLoading(false)
      return
    }

    const { ideas: generatedIdeas } = await res.json()
    setIdeas(generatedIdeas)
    setIdeationLoading(false)
  }

  async function handleSelectIdea(idea: Idea) {
    setSelectingIdea(idea.title)
    setStage('script')
    setError(null)

    const scriptRes = await fetch('/api/carousel/script-writer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand_profile_id: brandProfileId,
        topic: idea.title,
        idea_angle: idea.angle_description,
        research_context: researchText,
        slide_count: slideCount,
      }),
    })

    if (!scriptRes.ok) {
      const json = await scriptRes.json().catch(() => ({}))
      setError(json.error ?? 'Something went wrong')
      setStage('idle')
      setSelectingIdea(null)
      return
    }

    const { id } = await scriptRes.json()
    await runDesignerAndRedirect(id)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'research') return

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
          onClick={() => switchMode('ai')}
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
          onClick={() => switchMode('manual')}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
            mode === 'manual'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
          }`}
        >
          Write My Own Script
        </button>
        <button
          type="button"
          onClick={() => switchMode('research')}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
            mode === 'research'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
          }`}
        >
          From Research/Article
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Brand Profile <span className="text-red-500">*</span>
        </label>
        <select
          value={brandProfileId}
          onChange={(e) => setBrandProfileId(e.target.value)}
          required
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
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

      {mode !== 'research' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Topic <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            required
            placeholder="e.g. 5 cara meningkatkan engagement Instagram"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>
      )}

      {mode === 'ai' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Target Audience
            </label>
            <input
              type="text"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="e.g. UMKM yang ingin scale digital marketing"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Goal
            </label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Educate, drive DM inquiries"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Number of Slides
            </label>
            <input
              type="number"
              min={3}
              max={12}
              value={slideCount}
              onChange={(e) => setSlideCount(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>
        </>
      )}

      {mode === 'manual' && (
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
              />
              <textarea
                value={slide.body}
                onChange={(e) => updateManualSlide(i, 'body', e.target.value)}
                rows={3}
                placeholder="Body"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
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

      {mode === 'research' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Paste your research/article content <span className="text-red-500">*</span>
            </label>
            <textarea
              value={researchText}
              onChange={(e) => setResearchText(e.target.value)}
              required
              rows={10}
              placeholder="Paste the full article or research notes here…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Number of Slides
            </label>
            <input
              type="number"
              min={3}
              max={12}
              value={slideCount}
              onChange={(e) => setSlideCount(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>

          <button
            type="button"
            onClick={handleGenerateIdeas}
            disabled={ideationLoading || !researchText.trim() || !brandProfileId || loading}
            className="w-full border border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {ideationLoading ? 'Generating ideas…' : 'Generate Ideas'}
          </button>

          {ideationError && (
            <p className="text-sm text-red-600 dark:text-red-400">{ideationError}</p>
          )}

          {ideas && ideas.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Pick one angle to build the script from:
              </p>
              {ideas.map((idea) => (
                <button
                  key={idea.title}
                  type="button"
                  onClick={() => handleSelectIdea(idea)}
                  disabled={loading}
                  className="w-full text-left border border-gray-200 rounded-lg p-4 hover:border-blue-500 hover:bg-blue-50 disabled:opacity-50 dark:border-gray-800 dark:hover:border-blue-500 dark:hover:bg-blue-500/10"
                >
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    {idea.title}
                  </p>
                  <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                    {idea.hook}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {idea.angle_description}
                  </p>
                  {loading && selectingIdea === idea.title && (
                    <p className="text-xs text-gray-400 mt-2">{loadingLabel}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {mode !== 'research' && (
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loadingLabel}
        </button>
      )}
    </form>
  )
}
