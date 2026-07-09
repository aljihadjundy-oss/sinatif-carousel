// script-writer and ideation call generateStructuredContentGroq() (Groq,
// OpenAI-compatible endpoint) as the active provider — Gemini
// (generateStructuredContent()) proved unreliable in production
// (frequent 503 overload, and hangs that ate the retry budget even with
// a per-attempt timeout). generateStructuredContent() is kept intact,
// unused, as a documented fallback: switch a caller's import back to it
// if Groq has its own outage, no other code changes needed since both
// functions share the same call signature. Migrate to Claude API for
// production is still the longer-term plan — swap whichever of these is
// active at the time, callers remain unchanged either way.

import { GoogleGenerativeAI, GoogleGenerativeAIFetchError, Schema } from '@google/generative-ai'
import OpenAI, { APIError } from 'openai'

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

// Groq alternative for script-writer/ideation, added because Gemini has
// been unreliable in production (frequent 503 overload, and hangs that
// eat the retry budget even with the AbortController timeout above).
// Groq exposes an OpenAI-compatible /openai/v1 endpoint, so this uses the
// `openai` SDK pointed at Groq's baseURL rather than @google/generative-ai
// — same interface as generateStructuredContent() so callers don't need
// to change how they call it, just which function they import.
const GROQ_MODEL = 'llama-3.3-70b-versatile'
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'

// Groq's per-model "Structured Outputs" strict json_schema mode is only
// available on a subset of models (verified via Groq's docs at
// console.groq.com/docs/structured-outputs before writing this — not
// assumed). response_format: { type: "json_object" } ("JSON Object Mode")
// is the broadly-supported one instead, confirmed to work with
// llama-3.3-70b-versatile — it guarantees valid JSON syntax but not
// schema conformance, so `jsonSchema` is accepted here only to keep the
// same call signature as generateStructuredContent() and isn't sent to
// Groq. Schema shape is instead enforced the same way it always has been
// for this app: by the system/user prompts callers already build.
// OpenAI-compatible JSON mode also requires the word "json" to appear
// somewhere in the messages, which every caller's SYSTEM_PROMPT already
// satisfies ("You always reply with a single valid JSON object...").
//
// Groq responds far faster than Gemini in practice, so the per-attempt
// timeout is shortened from Gemini's 8s to 5s — retry count/delays are
// unchanged from generateStructuredContent().
const GROQ_PER_ATTEMPT_TIMEOUT_MS = 5000

function isRetryableGroqError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true
  return err instanceof APIError && err.status !== undefined && RETRYABLE_STATUS_CODES.includes(err.status)
}

export async function generateStructuredContentGroq({
  systemPrompt,
  userPrompt,
}: GenerateStructuredContentInput): Promise<object> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured')
  }

  const client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL })

  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), GROQ_PER_ATTEMPT_TIMEOUT_MS)
    try {
      const result = await client.chat.completions.create(
        {
          model: GROQ_MODEL,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        },
        { signal: controller.signal }
      )
      const text = result.choices[0]?.message?.content
      if (!text) {
        throw new Error('Groq response had no message content')
      }
      return JSON.parse(text)
    } catch (err) {
      lastErr = err
      const timedOut = err instanceof DOMException && err.name === 'AbortError'
      if (!isRetryableGroqError(err) || attempt === RETRY_DELAYS_MS.length) {
        throw timedOut || isRetryableGroqError(err) ? new AiServiceUnavailableError(err) : err
      }
      const delay = RETRY_DELAYS_MS[attempt]
      console.warn(
        `ai-client: Groq call ${
          timedOut
            ? `timed out after ${GROQ_PER_ATTEMPT_TIMEOUT_MS}ms`
            : `returned a transient error (status ${(err as APIError).status})`
        }, retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`
      )
      await sleep(delay)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  throw lastErr
}
