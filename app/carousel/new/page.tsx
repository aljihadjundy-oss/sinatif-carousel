import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { BrandProfileSummary } from '@/lib/types'
import NewCarouselForm from './NewCarouselForm'

export default async function NewCarouselPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profiles } = await supabase
    .from('brand_profiles')
    .select('id, name, profile_type, business_unit')
    .order('created_at', { ascending: false })

  const summary = (profiles ?? []) as BrandProfileSummary[]

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">New Carousel</h1>
          <a
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Dashboard
          </a>
        </div>

        {summary.length === 0 ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 text-sm text-yellow-800">
            You need at least one{' '}
            <a href="/carousel/brands" className="underline font-medium">
              brand profile
            </a>{' '}
            before creating a carousel post.
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow p-6">
            <NewCarouselForm profiles={summary} />
          </div>
        )}
      </div>
    </div>
  )
}
