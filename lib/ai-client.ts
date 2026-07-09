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

// Thrown when every attempt failed for a transient, external reason (a
// retryable Gemini status or a per-attempt timeout) rather than a bug in
// this code — callers should show the user a "try again" message instead
// of a generic failure.
export class AiServiceUnavailableError extends Error {
  constructor(cause: unknown) {
    super('AI service is temporarily overloaded, please try again in a moment')
    this.name = 'AiServiceUnavailableError'
    this.cause = cause
  }
}

// 503 (model overloaded) and 429 (rate limited) are transient,
// server-side conditions on Google's end — confirmed via a real
// production error where Gemini returned 503 with no code bug involved.
// Retrying with backoff is standard practice for these rather than
// surfacing a hard failure on the first transient blip.
//
// The 1s/3s/9s schedule (13s of pure delay, before any generation time)
// was confirmed via Vercel logs to be the actual cause of a prior 502:
// Vercel's default 10s timeout was killing the function mid-retry, which
// surfaced to the client as a generic 502 rather than any error this code
// throws. Adding maxDuration=60 to callers (script-writer/route.ts,
// ideation/route.ts) fixed the *ceiling*, but a single hanging/slow
// Gemini call could still consume the whole budget across every retry
// with no per-call bound — so each attempt now also gets its own
// AbortController timeout, and total retries were cut from 3 to 2 so
// worst case (3 attempts x 8s timeout + delays) stays well under 60s
// with margin for everything else the function does.
const RETRYABLE_STATUS_CODES = [429, 503]
const RETRY_DELAYS_MS = [500, 1500]
const PER_ATTEMPT_TIMEOUT_MS = 8000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true
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
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS)
    try {
      const result = await model.generateContent(userPrompt, { signal: controller.signal })
      const text = result.response.text()
      return JSON.parse(text)
    } catch (err) {
      lastErr = err
      const timedOut = err instanceof DOMException && err.name === 'AbortError'
      if (!isRetryableError(err) || attempt === RETRY_DELAYS_MS.length) {
        throw timedOut || isRetryableError(err) ? new AiServiceUnavailableError(err) : err
      }
      const delay = RETRY_DELAYS_MS[attempt]
      console.warn(
        `ai-client: Gemini call ${
          timedOut
            ? `timed out after ${PER_ATTEMPT_TIMEOUT_MS}ms`
            : `returned a transient error (status ${(err as GoogleGenerativeAIFetchError).status})`
        }, retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`
      )
      await sleep(delay)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  throw lastErr
}
