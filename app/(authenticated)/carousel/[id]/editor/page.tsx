import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { isSlideDocumentArray } from '@/lib/slideDocument'
import SlideEditor from './SlideEditor'
import './editor-fonts.css'

export default async function SlideEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { data: post } = await supabase
    .schema('carousel')
    .from('posts')
    .select('id, topic, slide_documents')
    .eq('id', id)
    .single()

  if (!post) notFound()

  // JSONB straight from the DB — validate the shape before trusting it
  // (rows written before migration 0012 default to [], and a future
  // schema version bump must fail closed here, not crash the canvas).
  const documents = isSlideDocumentArray(post.slide_documents) ? post.slide_documents : []

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Editor Kanvas
        </h1>
        <Link
          href={`/carousel/${id}`}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ← Kembali ke post
        </Link>
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Post ini belum punya dokumen slide untuk diedit. Generate ulang desainnya dulu dari
          halaman post (slide_documents terisi otomatis di setiap generate sejak fase 2), lalu
          buka editor ini lagi.
        </p>
      ) : (
        <SlideEditor documents={documents} />
      )}
    </div>
  )
}
