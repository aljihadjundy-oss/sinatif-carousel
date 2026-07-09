import { Skeleton } from '@/components/Skeleton'

export default function CarouselPostLoading() {
  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-24" />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-lg" />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Skeleton className="h-6 w-20" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        ))}
      </div>
    </div>
  )
}
