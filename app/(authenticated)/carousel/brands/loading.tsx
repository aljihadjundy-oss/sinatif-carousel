import { Skeleton } from '@/components/Skeleton'

export default function BrandsLoading() {
  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8">
      <Skeleton className="h-7 w-48" />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow p-5 space-y-3 dark:bg-gray-900">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  )
}
