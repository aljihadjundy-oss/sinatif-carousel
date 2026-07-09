'use client'

import { useState } from 'react'
import { BrandProfile } from '@/lib/types'
import BrandProfileForm from './BrandProfileForm'

export default function BrandProfilesClient({ profiles }: { profiles: BrandProfile[] }) {
  const [editingProfile, setEditingProfile] = useState<BrandProfile | null>(null)

  return (
    <>
      {profiles.length > 0 ? (
        <div className="bg-white rounded-xl shadow divide-y dark:bg-gray-900 dark:divide-gray-800">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setEditingProfile(p)}
              className="w-full text-left p-4 flex items-start justify-between gap-4 hover:bg-gray-50 dark:hover:bg-gray-800/60"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  {p.name}
                </p>
                <p className="text-sm text-gray-500 mt-0.5 dark:text-gray-400">
                  {p.profile_type === 'internal_bu' ? 'Internal BU' : 'Client'}
                  {p.business_unit ? ` · ${p.business_unit}` : ''}
                </p>
                {p.target_audience_default && (
                  <p className="text-sm text-gray-400 mt-0.5 dark:text-gray-500">
                    Audience: {p.target_audience_default}
                  </p>
                )}
              </div>
              <span className="text-xs text-blue-600 dark:text-blue-400 shrink-0">Edit</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-gray-500 text-sm dark:text-gray-400">
          No brand profiles yet.
        </p>
      )}

      <div className="bg-white rounded-xl shadow p-6 dark:bg-gray-900">
        <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
          {editingProfile ? `Edit "${editingProfile.name}"` : 'Create Brand Profile'}
        </h2>
        <BrandProfileForm
          key={editingProfile?.id ?? 'new'}
          existingProfile={editingProfile}
          onSaved={() => setEditingProfile(null)}
          onCancel={() => setEditingProfile(null)}
        />
      </div>
    </>
  )
}
