// Currently using Gemini free tier for development/testing. Migrate to
// Claude API for production — swap the implementation inside
// generateStructuredContent(), callers remain unchanged.

import { GoogleGenerativeAI, Schema } from '@google/generative-ai'

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
    model: 'gemini-2.5-flash',
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
