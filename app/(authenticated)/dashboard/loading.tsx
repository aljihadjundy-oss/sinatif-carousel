import { Skeleton } from '@/components/Skeleton'

export default function DashboardLoading() {
  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      <div className="bg-white rounded-xl shadow p-5 flex items-center justify-between dark:bg-gray-900">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-7 w-10" />
        </div>
        <Skeleton className="h-4 w-40" />
      </div>

      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <div className="bg-white rounded-xl shadow divide-y dark:bg-gray-900 dark:divide-gray-800">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0 space-y-2 flex-1">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
