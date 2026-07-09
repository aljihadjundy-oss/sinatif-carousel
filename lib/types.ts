export type ProfileType = 'internal_bu' | 'client'

export const BUSINESS_UNITS = [
  'Sinatif Agency',
  'Sinatif Academy',
  'Osiris Event',
  'Hexolution',
  'Bedadikit.id',
  'HMAIRA Scarf',
] as const

export type BusinessUnit = (typeof BUSINESS_UNITS)[number]

export interface VisualStyle {
  colors?: Record<string, string>
  fonts?: Record<string, string>
  logo_url?: string | null
  logo_description?: string | null
  visual_notes?: string
}

export interface BrandProfile {
  id: string
  user_id: string
  name: string
  profile_type: ProfileType
  business_unit: BusinessUnit | null
  tone_guideline: string | null
  content_standards: string | null
  target_audience_default: string | null
  visual_style: VisualStyle | null
  created_at: string
}

export type BrandProfileSummary = Pick<
  BrandProfile,
  'id' | 'name' | 'profile_type' | 'business_unit'
>

export interface CarouselPost {
  id: string
  user_id: string
  brand_profile_id: string | null
  topic: string
  audience: string | null
  goal: string | null
  script: unknown
  status: string
  created_at: string
}
