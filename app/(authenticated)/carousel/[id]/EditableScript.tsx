'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface Slide {
  index: number
  headline: string
  body: string
}

interface Props {
  postId: string
  stageOutputId: string
  title: string
  slides: Slide[]
}

export default function EditableScript({ postId, stageOutputId, title, slides }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Slide[]>(slides)
  const [saving, setSaving] = useState(false)
  const [savingLabel, setSavingLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  function updateDraft(index: number, field: 'headline' | 'body', value: string) {
    setDraft((current) =>
      current.map((s) => (s.index === index ? { ...s, [field]: value } : s))
    )
  }

  function startEditing() {
    setDraft(slides)
    setError(null)
    setEditing(true)
  }

  function cancelEditing() {
    setDraft(slides)
    setError(null)
    setEditing(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    setSavingLabel('Saving script…')
    const { error: updateErr } = await supabase
      .schema('carousel')
      .from('stage_outputs')
      .update({ output_json: { title, slides: draft } })
      .eq('id', stageOutputId)

    if (updateErr) {
      setError(updateErr.message)
      setSaving(false)
      return
    }

    setSavingLabel('Membuat desain…')
    const res = await fetch('/api/carousel/designer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: postId }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Design regeneration failed')
      setSaving(false)
      return
    }

    setSaving(false)
    setEditing(false)
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Script
        </h2>
        {!editing ? (
          <button
            onClick={startEditing}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={cancelEditing}
              disabled={saving}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm bg-blue-600 text-white rounded-lg px-3 py-1.5 hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? savingLabel : 'Save & Regenerate Design'}
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {draft.length > 0 ? (
        <div className="space-y-4">
          {draft.map((slide) => (
            <div
              key={slide.index}
              className="bg-white rounded-xl shadow p-5 dark:bg-gray-900"
            >
              <p className="text-xs text-gray-400 mb-1 dark:text-gray-500">
                Slide {slide.index}
              </p>
              {editing ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={slide.headline}
                    onChange={(e) => updateDraft(slide.index, 'headline', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-semibold bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                  <textarea
                    value={slide.body}
                    onChange={(e) => updateDraft(slide.index, 'body', e.target.value)}
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
              ) : (
                <>
                  <h3 className="font-semibold text-lg mb-2 text-gray-900 dark:text-gray-100">
                    {slide.headline}
                  </h3>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap dark:text-gray-300">
                    {slide.body}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-500 text-sm dark:text-gray-400">
          No script content available.
        </p>
      )}
    </div>
  )
}
