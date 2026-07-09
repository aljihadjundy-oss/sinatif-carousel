'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { BUSINESS_UNITS, ProfileType } from '@/lib/types'

export default function BrandProfileForm() {
  const router = useRouter()
  const supabase = createClient()

  const [name, setName] = useState('')
  const [profileType, setProfileType] = useState<ProfileType>('internal_bu')
  const [businessUnit, setBusinessUnit] = useState<(typeof BUSINESS_UNITS)[number]>(
    BUSINESS_UNITS[0]
  )
  const [toneGuideline, setToneGuideline] = useState('')
  const [contentStandards, setContentStandards] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setError('Not authenticated')
      setLoading(false)
      return
    }

    const payload: Record<string, unknown> = {
      user_id: user.id,
      name,
      profile_type: profileType,
      tone_guideline: toneGuideline || null,
      content_standards: contentStandards || null,
      target_audience_default: targetAudience || null,
    }
    if (profileType === 'internal_bu') payload.business_unit = businessUnit

    const { error: dbErr } = await supabase
      .schema('carousel')
      .from('brand_profiles')
      .insert(payload)
    if (dbErr) {
      setError(dbErr.message)
    } else {
      router.refresh()
      setName('')
      setToneGuideline('')
      setContentStandards('')
      setTargetAudience('')
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Sinatif Agency Brand"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Profile Type
          </label>
          <select
            value={profileType}
            onChange={(e) => setProfileType(e.target.value as ProfileType)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
          >
            <option value="internal_bu">Internal BU</option>
            <option value="client">Client</option>
          </select>
        </div>

        {profileType === 'internal_bu' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Business Unit
            </label>
            <select
              value={businessUnit}
              onChange={(e) =>
                setBusinessUnit(e.target.value as typeof businessUnit)
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
            >
              {BUSINESS_UNITS.map((bu) => (
                <option key={bu} value={bu}>
                  {bu}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className={profileType === 'internal_bu' ? '' : 'md:col-span-2'}>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Default Target Audience
          </label>
          <input
            type="text"
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            placeholder="e.g. Marketing managers, 25–40"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Tone Guideline
        </label>
        <textarea
          value={toneGuideline}
          onChange={(e) => setToneGuideline(e.target.value)}
          rows={3}
          placeholder="Describe the brand's tone of voice…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Content Standards
        </label>
        <textarea
          value={contentStandards}
          onChange={(e) => setContentStandards(e.target.value)}
          rows={3}
          placeholder="List content dos and don'ts, formatting rules…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="bg-blue-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Saving…' : 'Create Profile'}
      </button>
    </form>
  )
}
