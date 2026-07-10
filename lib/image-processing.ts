import sharp from 'sharp'

// Shared by background-upload/route.ts (user-uploaded photos) and
// ai-image/route.ts (Pollinations-generated images) — same target frame,
// same reasoning for every step. See background-upload/route.ts's prior
// comments for the original EXIF/crop investigation; kept in one place
// now so both call sites can't drift out of sync with each other.
//
// Every slide is a fixed 1080x1350 (4:5) canvas. `.rotate()` (no args)
// auto-orients based on EXIF and bakes the rotation into the pixels
// before stripping the tag — needed for phone photos, harmless as a
// no-op for images (like Pollinations output) that carry no EXIF
// orientation at all. `fit: 'cover'` then scales (up or down) to fully
// cover the frame and crops to the exact aspect ratio, centered — no
// stretching, no distortion, no empty borders — so the designer route
// can embed the stored object directly with no fit logic of its own.
const TARGET_WIDTH = 1080
const TARGET_HEIGHT = 1350
const JPEG_QUALITY = 80

export async function normalizeBackgroundImage(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'cover', position: 'center' })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()
}
