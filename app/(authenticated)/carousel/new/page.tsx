import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { BrandProfileSummary } from '@/lib/types'
import NewCarouselForm from './NewCarouselForm'

export default async function NewCarouselPage() {
  const supabase = await createServerSupabaseClient()

  const { data: profiles } = await supabase
    .schema('carousel')
    .from('brand_profiles')
    .select('id, name, profile_type, business_unit')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  const summary = (profiles ?? []) as BrandProfileSummary[]

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-8 text-gray-900 dark:text-gray-100">
        New Carousel
      </h1>

      {summary.length === 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 text-sm text-yellow-800 dark:bg-yellow-500/10 dark:border-yellow-500/30 dark:text-yellow-400">
          You need at least one{' '}
          <Link href="/carousel/brands" className="underline font-medium">
            brand profile
          </Link>{' '}
          before creating a carousel post.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow p-6 dark:bg-gray-900">
          <NewCarouselForm profiles={summary} />
        </div>
      )}
    </div>
  )
}
