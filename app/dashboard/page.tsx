import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import LogoutButton from './LogoutButton'

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <LogoutButton />
        </div>
        <div className="bg-white rounded-xl shadow p-6">
          <p className="text-gray-600">Welcome, <span className="font-medium">{user.email}</span></p>
          <p className="mt-4 text-gray-500">Sinatif Carousel pipeline will appear here.</p>
        </div>
      </div>
    </div>
  )
}
