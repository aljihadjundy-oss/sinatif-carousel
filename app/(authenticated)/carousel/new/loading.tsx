import { Skeleton } from '@/components/Skeleton'

export default function NewCarouselLoading() {
  return (
    <div className="max-w-2xl mx-auto p-8">
      <Skeleton className="h-7 w-40 mb-8" />
      <div className="bg-white rounded-xl shadow p-6 space-y-5 dark:bg-gray-900">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>
    </div>
  )
}
