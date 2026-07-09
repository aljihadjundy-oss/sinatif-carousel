// Currently using Gemini free tier for development/testing. Migrate to
// Claude API for production — swap the implementation inside
// generateStructuredContent(), callers remain unchanged.

import { GoogleGenerativeAI, Schema } from '@google/generative-ai'

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

  const result = await model.generateContent(userPrompt)
  const text = result.response.text()

  return JSON.parse(text)
}
