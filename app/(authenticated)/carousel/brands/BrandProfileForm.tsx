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
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoInputKey, setLogoInputKey] = useState(0)
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

    const { data: profile, error: dbErr } = await supabase
      .schema('carousel')
      .from('brand_profiles')
      .insert(payload)
      .select('id')
      .single()

    if (dbErr || !profile) {
      setError(dbErr?.message ?? 'Failed to create profile')
      setLoading(false)
      return
    }

    if (logoFile) {
      const path = `logos/${profile.id}.png`
      const { error: uploadErr } = await supabase.storage
        .from('carousel-assets')
        .upload(path, logoFile, { contentType: logoFile.type, upsert: true })

      if (uploadErr) {
        setError(`Profile created, but logo upload failed: ${uploadErr.message}`)
        setLoading(false)
        router.refresh()
        return
      }

      const { data: publicUrl } = supabase.storage
        .from('carousel-assets')
        .getPublicUrl(path)

      const { error: visualStyleErr } = await supabase
        .schema('carousel')
        .from('brand_profiles')
        .update({ visual_style: { logo_url: publicUrl.publicUrl } })
        .eq('id', profile.id)

      if (visualStyleErr) {
        setError(`Profile created, but saving logo URL failed: ${visualStyleErr.message}`)
        setLoading(false)
        router.refresh()
        return
      }
    }

    router.refresh()
    setName('')
    setToneGuideline('')
    setContentStandards('')
    setTargetAudience('')
    setLogoFile(null)
    setLogoInputKey((k) => k + 1)
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

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Logo
        </label>
        <input
          key={logoInputKey}
          type="file"
          accept="image/png,image/svg+xml"
          onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:file:bg-gray-800 dark:file:text-gray-300 dark:hover:file:bg-gray-700"
        />
        <p className="mt-1 text-xs text-gray-400">PNG or SVG. Rendered on every slide.</p>
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
