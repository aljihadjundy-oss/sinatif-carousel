import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { BrandProfile } from '@/lib/types'
import BrandProfileForm from './BrandProfileForm'

export default async function BrandsPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profiles } = await supabase
    .schema('carousel')
    .from('brand_profiles')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Brand Profiles</h1>
          <a
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Dashboard
          </a>
        </div>

        {profiles && profiles.length > 0 ? (
          <div className="bg-white rounded-xl shadow divide-y">
            {(profiles as BrandProfile[]).map((p) => (
              <div
                key={p.id}
                className="p-4 flex items-start justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {p.profile_type === 'internal_bu'
                      ? 'Internal BU'
                      : 'Client'}
                    {p.business_unit ? ` · ${p.business_unit}` : ''}
                  </p>
                  {p.target_audience_default && (
                    <p className="text-sm text-gray-400 mt-0.5">
                      Audience: {p.target_audience_default}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No brand profiles yet.</p>
        )}

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Create Brand Profile</h2>
          <BrandProfileForm />
        </div>
      </div>
    </div>
  )
}
