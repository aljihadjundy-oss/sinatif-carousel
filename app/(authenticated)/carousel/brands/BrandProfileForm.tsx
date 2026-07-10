'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { BUSINESS_UNITS, BrandProfile, ProfileType } from '@/lib/types'

interface Props {
  existingProfile?: BrandProfile | null
  onSaved?: () => void
  onCancel?: () => void
}

export default function BrandProfileForm({ existingProfile, onSaved, onCancel }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const isEditing = !!existingProfile

  const [name, setName] = useState(existingProfile?.name ?? '')
  const [profileType, setProfileType] = useState<ProfileType>(
    existingProfile?.profile_type ?? 'internal_bu'
  )
  const [businessUnit, setBusinessUnit] = useState<(typeof BUSINESS_UNITS)[number]>(
    existingProfile?.business_unit ?? BUSINESS_UNITS[0]
  )
  const [toneGuideline, setToneGuideline] = useState(existingProfile?.tone_guideline ?? '')
  const [contentStandards, setContentStandards] = useState(
    existingProfile?.content_standards ?? ''
  )
  const [targetAudience, setTargetAudience] = useState(
    existingProfile?.target_audience_default ?? ''
  )
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoInputKey, setLogoInputKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentLogoUrl = existingProfile?.visual_style?.logo_url ?? null

  function resetFieldsForCreate() {
    setName('')
    setToneGuideline('')
    setContentStandards('')
    setTargetAudience('')
    setLogoFile(null)
    setLogoInputKey((k) => k + 1)
  }

  async function uploadLogoAndGetUrl(profileId: string): Promise<string> {
    const path = `logos/${profileId}.png`
    const { error: uploadErr } = await supabase.storage
      .from('carousel-assets')
      .upload(path, logoFile as File, {
        contentType: (logoFile as File).type,
        upsert: true,
      })
    if (uploadErr) throw uploadErr

    const { data: publicUrl } = supabase.storage
      .from('carousel-assets')
      .getPublicUrl(path)
    return publicUrl.publicUrl
  }

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
      name,
      profile_type: profileType,
      tone_guideline: toneGuideline || null,
      content_standards: contentStandards || null,
      target_audience_default: targetAudience || null,
      business_unit: profileType === 'internal_bu' ? businessUnit : null,
    }

    let profileId = existingProfile?.id ?? null

    if (isEditing && profileId) {
      const { error: updateErr } = await supabase
        .schema('carousel')
        .from('brand_profiles')
        .update(payload)
        .eq('id', profileId)

      if (updateErr) {
        setError(updateErr.message)
        setLoading(false)
        return
      }
    } else {
      payload.user_id = user.id
      const { data: created, error: insertErr } = await supabase
        .schema('carousel')
        .from('brand_profiles')
        .insert(payload)
        .select('id')
        .single()

      if (insertErr || !created) {
        setError(insertErr?.message ?? 'Failed to create profile')
        setLoading(false)
        return
      }
      profileId = created.id
    }

    if (logoFile && profileId) {
      try {
        const logoUrl = await uploadLogoAndGetUrl(profileId)
        const { error: visualStyleErr } = await supabase
          .schema('carousel')
          .from('brand_profiles')
          .update({
            visual_style: { ...(existingProfile?.visual_style ?? {}), logo_url: logoUrl },
          })
          .eq('id', profileId)

        if (visualStyleErr) {
          setError(`Saved, but logo URL update failed: ${visualStyleErr.message}`)
          setLoading(false)
          router.refresh()
          return
        }
      } catch (err) {
        setError(
          `Saved, but logo upload failed: ${err instanceof Error ? err.message : 'unknown error'}`
        )
        setLoading(false)
        router.refresh()
        return
      }
    }

    router.refresh()
    if (!isEditing) resetFieldsForCreate()
    setLoading(false)
    onSaved?.()
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
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Profile Type
          </label>
          <select
            value={profileType}
            onChange={(e) => setProfileType(e.target.value as ProfileType)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
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
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
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
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
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
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Logo
        </label>
        {currentLogoUrl && !logoFile && (
          <div className="mb-2 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentLogoUrl}
              alt="Current logo"
              className="w-10 h-10 object-contain rounded border border-gray-200 dark:border-gray-700"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">Current logo — choose a file to replace it</span>
          </div>
        )}
        <input
          key={logoInputKey}
          type="file"
          accept="image/png,image/svg+xml"
          onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:file:bg-gray-800 dark:file:text-gray-300 dark:hover:file:bg-gray-700"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">PNG or SVG. Rendered on every slide.</p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Profile'}
        </button>
        {isEditing && (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="border border-gray-300 text-gray-700 rounded-lg px-5 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
