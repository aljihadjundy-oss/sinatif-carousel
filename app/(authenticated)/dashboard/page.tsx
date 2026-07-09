import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'

interface RecentPost {
  id: string
  topic: string
  status: string
  created_at: string
  brand_profiles: { name: string } | null
}

const STATUS_STYLES: Record<string, string> = {
  draft:
    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  scripted:
    'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  generated:
    'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
}

function statusBadge(status: string) {
  return (
    STATUS_STYLES[status] ??
    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: posts }, { count: brandCount }] = await Promise.all([
    supabase
      .schema('carousel')
      .from('posts')
      .select('id, topic, status, created_at, brand_profiles(name)')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .schema('carousel')
      .from('brand_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),
  ])

  const recentPosts = (posts ?? []) as unknown as RecentPost[]

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">
            Welcome back, <span className="font-medium">{user?.email}</span>
          </p>
        </div>
        <Link
          href="/carousel/new"
          className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          + New Carousel
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow p-5 flex items-center justify-between dark:bg-gray-900">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Active Brand Profiles
          </p>
          <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {brandCount ?? 0}
          </p>
        </div>
        <Link
          href="/carousel/brands"
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          Manage brand profiles →
        </Link>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Recent Posts
        </h2>

        {recentPosts.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-8 text-center space-y-3 dark:bg-gray-900">
            <p className="text-gray-500 dark:text-gray-400">
              No carousels yet — create your first one
            </p>
            <Link
              href="/carousel/new"
              className="inline-block bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
            >
              + New Carousel
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow divide-y dark:bg-gray-900 dark:divide-gray-800">
            {recentPosts.map((post) => (
              <Link
                key={post.id}
                href={`/carousel/${post.id}`}
                className="flex items-center justify-between gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-800/60"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate text-gray-900 dark:text-gray-100">
                    {post.topic}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5 dark:text-gray-400">
                    {post.brand_profiles?.name ?? 'No brand'} ·{' '}
                    {formatDate(post.created_at)}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${statusBadge(post.status)}`}
                >
                  {post.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
