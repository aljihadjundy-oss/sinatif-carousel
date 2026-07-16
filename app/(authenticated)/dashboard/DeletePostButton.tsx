'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  postId: string
  topic: string
}

// Destructive action (feature request): delete a post + everything that
// belongs to it (slides, stage outputs, storage PNGs — the route handles
// cascade/cleanup). Confirmed before it ever fires — native confirm()
// rather than a custom modal: this is the only destructive action
// anywhere in this app's UI, so a whole modal component for one button
// isn't worth it, and confirm() blocks input the same way a modal would.
export default function DeletePostButton({ postId, topic }: Props) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete(e: React.MouseEvent) {
    // Row is a <Link>; this button is a sibling, not nested inside it
    // (a <button> inside an <a> is invalid HTML and double-fires
    // navigation), but stopPropagation stays cheap insurance.
    e.preventDefault()
    e.stopPropagation()

    if (!window.confirm(`Hapus "${topic}"? Semua slide dan file gambar terkait akan ikut terhapus permanen.`)) {
      return
    }

    setDeleting(true)
    setError(null)
    const res = await fetch(`/api/carousel/posts/${postId}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Gagal menghapus post')
      setDeleting(false)
      return
    }
    router.refresh()
  }

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        title="Hapus post"
        className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950 dark:hover:text-red-400"
      >
        {deleting ? (
          <span className="block h-4 w-4 text-xs leading-4">…</span>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path
              fillRule="evenodd"
              d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.808a2.75 2.75 0 0 0 2.741-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>
      {error && <p className="mt-1 max-w-[10rem] text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
