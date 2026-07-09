import { createServerSupabaseClient } from '@/lib/supabase-server'
import { BrandProfile } from '@/lib/types'
import BrandProfilesClient from './BrandProfilesClient'

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

      <BrandProfilesClient profiles={(profiles as BrandProfile[]) ?? []} />
    </div>
  )
}
