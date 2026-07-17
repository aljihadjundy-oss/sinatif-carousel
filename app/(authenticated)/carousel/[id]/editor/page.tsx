import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { materializeSlideDocuments } from '@/lib/materialize-documents'
import SlideEditor from './SlideEditor'
import './editor-fonts.css'

// Lazy materialization (AUDIT.md R4) replaced the old "belum punya
// dokumen slide untuk diedit" dead-end that used to render here: if this
// post's slide_documents is empty or shorter than its script — whatever
// upstream failure caused that — the documents are compiled NOW from the
// script + saved design options, persisted, and opened. The dead-end
// message is deliberately gone from the codebase: there is no state left
// that should show it (a post with no script gets a blank editable
// fallback slide). Two real production causes this absorbs, both from
// the 2026-07 bug reports: the designer route's final posts UPDATE
// failing silently (layout_variant CHECK-constraint violation, its error
// never read), and the designer route failing outright after script
// generation (timeout/render error) so no document write ever ran.
export default async function SlideEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ warning?: string }>
}) {
  const { id } = await params
  // The designer route can succeed overall while degrading individual
  // slides (see slide_documents_warning) — NewCarouselForm forwards that
  // as ?warning=... so the explanation lands where the user actually is.
  const { warning } = await searchParams
  const supabase = await createServerSupabaseClient()

  const { data: post } = await supabase
    .schema('carousel')
    .from('posts')
    .select(
      'id, topic, layout_variant, color_scheme, text_density, hierarchy, background_image_url, icon_name, typography_preset, slide_overrides, slide_documents, brand_profile_id'
    )
    .eq('id', id)
    .single()

  if (!post) notFound()

  const { documents, fallbackSlideOrders, materialized } = await materializeSlideDocuments(
    supabase,
    post
  )
  if (materialized) {
    console.log(
      `editor: lazily materialized ${documents.length} slide document(s) for post ${post.id}` +
        (fallbackSlideOrders.length > 0
          ? ` (fallback layout for slide ${fallbackSlideOrders.join(', ')})`
          : '')
    )
  }

  const fallbackNotice =
    fallbackSlideOrders.length > 0
      ? `Slide ${fallbackSlideOrders.join(', ')} dibuka dengan layout sederhana karena template aslinya gagal disiapkan — isinya tetap lengkap dan bisa diedit.`
      : null

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

      {(warning || fallbackNotice) && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {warning ?? fallbackNotice}
        </p>
      )}

      <SlideEditor postId={post.id} documents={documents} />
    </div>
  )
}
