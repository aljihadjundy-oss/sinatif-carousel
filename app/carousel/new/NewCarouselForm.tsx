'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BrandProfileSummary } from '@/lib/types'

interface Props {
  profiles: BrandProfileSummary[]
}

export default function NewCarouselForm({ profiles }: Props) {
  const router = useRouter()
  const [brandProfileId, setBrandProfileId] = useState(profiles[0]?.id ?? '')
  const [topic, setTopic] = useState('')
  const [audience, setAudience] = useState('')
  const [goal, setGoal] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function profileLabel(p: BrandProfileSummary) {
    const tag =
      p.profile_type === 'internal_bu' && p.business_unit
        ? p.business_unit
        : 'Client'
    return `${p.name} (${tag})`
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/carousel/script-writer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand_profile_id: brandProfileId,
        topic,
        audience,
        goal,
      }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Something went wrong')
      setLoading(false)
      return
    }

    // No detail page yet — bounce to dashboard. Stage 2 will add a carousels list.
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Generating script…' : 'Generate Script'}
      </button>
    </form>
  )
}
