import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { generateStructuredContent } from '@/lib/ai-client'

export const runtime = 'nodejs'
// See app/api/carousel/script-writer/route.ts for why this is set — same
// generateStructuredContent() retry/backoff path applies here.
export const maxDuration = 60

const SYSTEM_PROMPT =
  'You are a senior Indonesian social-media strategist who turns research ' +
  'articles into distinct Instagram carousel content angles for a brand. ' +
  'You always reply with a single valid JSON object and nothing else — ' +
  'no prose, no markdown fences.'

const IDEATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          hook: { type: 'string' },
          angle_description: { type: 'string' },
        },
        required: ['title', 'hook', 'angle_description'],
      },
    },
  },
  required: ['ideas'],
}

function buildUserPrompt(input: {
  researchText: string
  brandName: string
  toneGuideline: string | null
  contentStandards: string | null
  targetAudienceDefault: string | null
}): string {
  const lines: string[] = []
  lines.push(`Brand: ${input.brandName}`)
  if (input.toneGuideline) lines.push(`Brand voice: ${input.toneGuideline}`)
  if (input.contentStandards)
    lines.push(`Content standards: ${input.contentStandards}`)
  if (input.targetAudienceDefault)
    lines.push(`Default target audience: ${input.targetAudienceDefault}`)
  lines.push('')
  lines.push('Source research/article:')
  lines.push(input.researchText)
  lines.push('')
  lines.push(
    'Generate 3-5 distinct Instagram carousel content angle ideas based on ' +
      'this research, relevant to this brand. Each idea must take a genuinely ' +
      'different angle on the material (not just reworded titles). Return ' +
      'ONLY this JSON shape:'
  )
  lines.push(
    '{"ideas": [{"title": string, "hook": string, "angle_description": string}]}'
  )
  return lines.join('\n')
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { research_text?: string; brand_profile_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const researchText = body.research_text?.trim()
  const brandProfileId = body.brand_profile_id?.trim()

  if (!researchText) {
    return NextResponse.json(
      { error: 'research_text is required' },
      { status: 400 }
    )
  }
  if (!brandProfileId) {
    return NextResponse.json(
      { error: 'brand_profile_id is required' },
      { status: 400 }
    )
  }

  const { data: brand, error: brandErr } = await supabase
    .schema('carousel')
    .from('brand_profiles')
    .select('id, name, tone_guideline, content_standards, target_audience_default')
    .eq('id', brandProfileId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (brandErr) {
    return NextResponse.json({ error: brandErr.message }, { status: 500 })
  }
  if (!brand) {
    return NextResponse.json(
      { error: 'Brand profile not found' },
      { status: 404 }
    )
  }

  let result: unknown
  try {
    result = await generateStructuredContent({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt({
        researchText,
        brandName: brand.name,
        toneGuideline: brand.tone_guideline,
        contentStandards: brand.content_standards,
        targetAudienceDefault: brand.target_audience_default,
      }),
      jsonSchema: IDEATION_JSON_SCHEMA,
    })
  } catch (err) {
    console.error('ideation: ai-client error', err)
    return NextResponse.json(
      { error: 'Idea generation failed' },
      { status: 502 }
    )
  }

  const ideas = (result as { ideas?: unknown }).ideas
  if (!Array.isArray(ideas)) {
    return NextResponse.json(
      { error: 'Idea generation returned an unexpected shape' },
      { status: 502 }
    )
  }

  return NextResponse.json({ ideas })
}
