'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/carousel/brands', label: 'Brand Profiles' },
  { href: '/carousel/new', label: 'New Carousel' },
]

export default function NavBar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <nav className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-8 min-w-0">
          <span className="font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
            Sinatif Carousel
          </span>
          <div className="flex items-center gap-1 overflow-x-auto">
            {NAV_LINKS.map((link) => {
              const active =
                pathname === link.href ||
                (link.href !== '/dashboard' && pathname.startsWith(link.href))
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:inline truncate max-w-[16rem]">
            {userEmail}
          </span>
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-500 hover:text-red-600 border border-gray-300 rounded-lg px-3 py-1.5 dark:text-gray-400 dark:border-gray-700 dark:hover:text-red-400"
          >
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  )
}
