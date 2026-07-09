import { createServerSupabaseClient } from '@/lib/supabase-server'
import { BrandProfile } from '@/lib/types'
import BrandProfileForm from './BrandProfileForm'

export default async function BrandsPage() {
  const supabase = await createServerSupabaseClient()

  const { data: profiles } = await supabase
    .schema('carousel')
    .from('brand_profiles')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        Brand Profiles
      </h1>

      {profiles && profiles.length > 0 ? (
        <div className="bg-white rounded-xl shadow divide-y dark:bg-gray-900 dark:divide-gray-800">
          {(profiles as BrandProfile[]).map((p) => (
            <div
              key={p.id}
              className="p-4 flex items-start justify-between gap-4"
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
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-500 text-sm dark:text-gray-400">
          No brand profiles yet.
        </p>
      )}

      <div className="bg-white rounded-xl shadow p-6 dark:bg-gray-900">
        <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
          Create Brand Profile
        </h2>
        <BrandProfileForm />
      </div>
    </div>
  )
}
