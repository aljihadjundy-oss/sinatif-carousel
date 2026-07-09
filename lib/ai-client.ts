// Currently using Gemini free tier for development/testing. Migrate to
// Claude API for production — swap the implementation inside
// generateStructuredContent(), callers remain unchanged.

import { GoogleGenerativeAI, GoogleGenerativeAIFetchError, Schema } from '@google/generative-ai'

// gemini-2.5-flash was shut down by Google on 2026-06-17 ("model ...
// is no longer available", 404), which broke every AI-backed route.
// gemini-flash-latest is Google's auto-updating alias for their current
// recommended Flash model, chosen specifically to stop this from
// recurring every time Google retires a dated snapshot. Structured
// output (responseMimeType/responseSchema) is a capability of the
// underlying model family, not tied to a specific dated version, so it
// should keep working the same way through the alias — but this could
// not be verified against the live API (no GEMINI_API_KEY configured
// in the environment this was written in). If gemini-flash-latest ever
// turns out not to support structured output the same way, or itself
// gets retired, check https://ai.google.dev/gemini-api/docs/models for
// the current stable dated Flash model and pin to that instead — watch
// for another deprecation-date-style shutdown notice like this one.
const MODEL = 'gemini-flash-latest'

interface GenerateStructuredContentInput {
  systemPrompt: string
  userPrompt: string
  jsonSchema: object
}

// 503 (model overloaded) and 429 (rate limited) are transient,
// server-side conditions on Google's end — confirmed via a real
// production error where Gemini returned 503 with no code bug involved.
// Retrying with backoff is standard practice for these rather than
// surfacing a hard failure on the first transient blip.
//
// The original 1s/3s/9s schedule (13s of pure delay, before any generation
// time) was confirmed via Vercel logs to be the actual cause of a 502:
// callers run with maxDuration=60 now (see script-writer/route.ts and
// ideation/route.ts), but at the time this route had no maxDuration set
// and Vercel's default 10s timeout killed the function mid-retry, which
// surfaces to the client as a generic 502 rather than any error this code
// throws. 500ms/1.5s/3s (5s total delay) leaves much more of the 60s
// budget for the actual generateContent() calls themselves, and still
// backs off meaningfully between attempts.
const RETRYABLE_STATUS_CODES = [429, 503]
const RETRY_DELAYS_MS = [500, 1500, 3000]

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableError(err: unknown): boolean {
  return (
    err instanceof GoogleGenerativeAIFetchError &&
    err.status !== undefined &&
    RETRYABLE_STATUS_CODES.includes(err.status)
  )
}

export async function generateStructuredContent({
  systemPrompt,
  userPrompt,
  jsonSchema,
}: GenerateStructuredContentInput): Promise<object> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured')
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: jsonSchema as Schema,
    },
  })

  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await model.generateContent(userPrompt)
      const text = result.response.text()
      return JSON.parse(text)
    } catch (err) {
      lastErr = err
      if (!isRetryableError(err) || attempt === RETRY_DELAYS_MS.length) {
        throw err
      }
      const delay = RETRY_DELAYS_MS[attempt]
      console.warn(
        `ai-client: Gemini returned a transient error (status ${
          (err as GoogleGenerativeAIFetchError).status
        }), retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`
      )
      await sleep(delay)
    }
  }

  throw lastErr
}
