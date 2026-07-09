import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { generateStructuredContentGroq, AiServiceUnavailableError } from '@/lib/ai-client'

export const runtime = 'nodejs'
// Vercel's default serverless function timeout is 10s, but this route calls
// generateStructuredContentGroq() which retries transient errors/timeouts
// with backoff (see lib/ai-client.ts) — worst case is several calls plus
// delays between them, which can exceed 10s. 60 is the maximum maxDuration
// Vercel allows for a standard (non-Fluid-Compute) Hobby-plan function;
// Pro/Enterprise allow more but 60 covers this route's worst case with
// margin. https://vercel.com/docs/functions/configuring-functions/duration
export const maxDuration = 60

const SYSTEM_PROMPT =
  'You are a senior Indonesian social-media copywriter who writes Instagram carousel scripts. ' +
  'You always reply with a single valid JSON object and nothing else — no prose, no markdown fences.'

const MIN_SLIDE_COUNT = 3
const MAX_SLIDE_COUNT = 12
const DEFAULT_SLIDE_COUNT = 7

function buildScriptJsonSchema(slideCount: number) {
  return {
    type: 'object',
    properties: {
      title: { type: 'string' },
      slides: {
        type: 'array',
        minItems: slideCount,
        maxItems: slideCount,
        items: {
          type: 'object',
          properties: {
            index: { type: 'number' },
            headline: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['index', 'headline', 'body'],
        },
      },
    },
    required: ['title', 'slides'],
  }
}

function buildUserPrompt(input: {
  topic: string
  audience: string | null
  goal: string | null
  brandName: string
  toneGuideline: string | null
  contentStandards: string | null
  ideaAngle: string | null
  researchContext: string | null
  slideCount: number
}): string {
  const lines: string[] = []
  lines.push(`Brand: ${input.brandName}`)
  if (input.toneGuideline) lines.push(`Brand voice: ${input.toneGuideline}`)
  if (input.contentStandards)
    lines.push(`Content standards: ${input.contentStandards}`)
  lines.push(`Topic: ${input.topic}`)
  if (input.audience) lines.push(`Target audience: ${input.audience}`)
  if (input.goal) lines.push(`Goal: ${input.goal}`)
  if (input.ideaAngle) {
    lines.push('')
    lines.push(`Content angle to build this script around: ${input.ideaAngle}`)
  }
  if (input.researchContext) {
    lines.push('')
    lines.push(
      'Source research/article — ground the script in real facts and ' +
        'details from this text rather than generic claims:'
    )
    lines.push(input.researchContext)
  }
  lines.push('')
  lines.push(
    `Generate exactly ${input.slideCount} slides for this Instagram carousel script. Return ONLY this JSON shape:`
  )
  lines.push(
    '{"title": string, "slides": [{"index": number, "headline": string, "body": string}]}'
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

  let body: {
    brand_profile_id?: string
    topic?: string
    audience?: string | null
    goal?: string | null
    idea_angle?: string | null
    research_context?: string | null
    slide_count?: number
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const brandProfileId = body.brand_profile_id?.trim()
  const topic = body.topic?.trim()
  const audience = body.audience?.trim() || null
  const goal = body.goal?.trim() || null
  const ideaAngle = body.idea_angle?.trim() || null
  const researchContext = body.research_context?.trim() || null

  if (!brandProfileId) {
    return NextResponse.json(
      { error: 'brand_profile_id is required' },
      { status: 400 }
    )
  }
  if (!topic) {
    return NextResponse.json({ error: 'topic is required' }, { status: 400 })
  }

  const slideCount = body.slide_count ?? DEFAULT_SLIDE_COUNT
  if (
    !Number.isInteger(slideCount) ||
    slideCount < MIN_SLIDE_COUNT ||
    slideCount > MAX_SLIDE_COUNT
  ) {
    return NextResponse.json(
      { error: `slide_count must be an integer between ${MIN_SLIDE_COUNT} and ${MAX_SLIDE_COUNT}` },
      { status: 400 }
    )
  }

  const { data: brand, error: brandErr } = await supabase
    .schema('carousel')
    .from('brand_profiles')
    .select('id, name, tone_guideline, content_standards')
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

  let script: unknown
  try {
    script = await generateStructuredContentGroq({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt({
        topic,
        audience,
        goal,
        brandName: brand.name,
        toneGuideline: brand.tone_guideline,
        contentStandards: brand.content_standards,
        ideaAngle,
        researchContext,
        slideCount,
      }),
      jsonSchema: buildScriptJsonSchema(slideCount),
    })
  } catch (err) {
    console.error('script-writer: ai-client error', err)
    if (err instanceof AiServiceUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    return NextResponse.json(
      { error: 'Script generation failed' },
      { status: 502 }
    )
  }

  const { data: inserted, error: insertErr } = await supabase
    .schema('carousel')
    .from('posts')
    .insert({
      user_id: user.id,
      brand_profile_id: brand.id,
      topic,
      audience,
      goal,
      status: 'scripted',
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'Insert failed' },
      { status: 500 }
    )
  }

  const { error: stageErr } = await supabase
    .schema('carousel')
    .from('stage_outputs')
    .insert({
      post_id: inserted.id,
      stage: 'script',
      output_json: script,
    })

  if (stageErr) {
    await supabase.schema('carousel').from('posts').delete().eq('id', inserted.id)
    return NextResponse.json({ error: stageErr.message }, { status: 500 })
  }

  return NextResponse.json({ id: inserted.id })
}
