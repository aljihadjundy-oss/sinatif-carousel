import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

const SYSTEM_PROMPT =
  'You are a senior Indonesian social-media copywriter who writes Instagram carousel scripts. ' +
  'You always reply with a single valid JSON object and nothing else — no prose, no markdown fences.'

function buildUserPrompt(input: {
  topic: string
  audience: string | null
  goal: string | null
  brandName: string
  toneGuideline: string | null
  contentStandards: string | null
}): string {
  const lines: string[] = []
  lines.push(`Brand: ${input.brandName}`)
  if (input.toneGuideline) lines.push(`Brand voice: ${input.toneGuideline}`)
  if (input.contentStandards)
    lines.push(`Content standards: ${input.contentStandards}`)
  lines.push(`Topic: ${input.topic}`)
  if (input.audience) lines.push(`Target audience: ${input.audience}`)
  if (input.goal) lines.push(`Goal: ${input.goal}`)
  lines.push('')
  lines.push(
    'Write a 6–8 slide Instagram carousel script. Return ONLY this JSON shape:'
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

  if (!brandProfileId) {
    return NextResponse.json(
      { error: 'brand_profile_id is required' },
      { status: 400 }
    )
  }
  if (!topic) {
    return NextResponse.json({ error: 'topic is required' }, { status: 400 })
  }

  const { data: brand, error: brandErr } = await supabase
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

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured' },
      { status: 500 }
    )
  }

  const client = new Anthropic({ apiKey })

  let script: unknown
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt({
            topic,
            audience,
            goal,
            brandName: brand.name,
            toneGuideline: brand.tone_guideline,
            contentStandards: brand.content_standards,
          }),
        },
      ],
    })

    const textBlock = msg.content.find((b) => b.type === 'text')
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : ''

    try {
      script = JSON.parse(text)
    } catch {
      script = { raw: text }
    }
  } catch (err) {
    console.error('script-writer: anthropic error', err)
    return NextResponse.json(
      { error: 'Script generation failed' },
      { status: 502 }
    )
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('carousel_posts')
    .insert({
      user_id: user.id,
      brand_profile_id: brand.id,
      topic,
      audience,
      goal,
      script,
      status: 'generated',
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'Insert failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({ id: inserted.id })
}
