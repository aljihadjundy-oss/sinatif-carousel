// Tiny PNG snapshot harness for the visual baseline suite — deliberately
// hand-rolled (pixelmatch + pngjs, both MIT) instead of pulling in a
// full image-snapshot plugin: the whole requirement is "compare a PNG
// against a committed baseline and fail loudly with a diff image", which
// is ~60 lines, and every extra dependency here is one more thing that
// can drift under the phase-2 renderer refactor this suite exists to
// guard.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const BASELINE_DIR = path.join(__dirname, '__baselines__')
// Diff/actual images on failure land here — gitignored, purely for a
// human to open and eyeball what changed.
const OUTPUT_DIR = path.join(__dirname, '__output__')

// Satori/resvg output is deterministic within one environment, but
// anti-aliasing can shift by a hair across resvg/font-stack versions.
// Allow a small fraction of pixels to differ before calling it a
// regression; a real layout/color change moves far more than this.
// 0.0002 of 1080x1350 ≈ 290 pixels. Measured same-environment rerun
// noise is 0 pixels, and a deliberate one-character headline change was
// only partially caught at the looser 0.001 — this is tight enough to
// catch a single glyph moving while still leaving headroom for future
// resvg/font anti-aliasing drift.
const MAX_DIFF_PIXEL_RATIO = 0.0002
// pixelmatch per-pixel color distance threshold (0..1); default-ish
// value, tolerant of sub-pixel anti-aliasing noise only.
const PIXEL_THRESHOLD = 0.1

export interface SnapshotResult {
  status: 'created' | 'matched' | 'mismatched' | 'size-mismatch'
  diffPixelRatio?: number
  message: string
}

export function compareToBaseline(name: string, pngBuffer: Buffer): SnapshotResult {
  mkdirSync(BASELINE_DIR, { recursive: true })
  const baselinePath = path.join(BASELINE_DIR, `${name}.png`)

  if (!existsSync(baselinePath) || process.env.UPDATE_SNAPSHOTS === '1') {
    writeFileSync(baselinePath, pngBuffer)
    return {
      status: 'created',
      message: `baseline written: ${path.relative(process.cwd(), baselinePath)}`,
    }
  }

  const baseline = PNG.sync.read(readFileSync(baselinePath))
  const actual = PNG.sync.read(pngBuffer)

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    mkdirSync(OUTPUT_DIR, { recursive: true })
    writeFileSync(path.join(OUTPUT_DIR, `${name}.actual.png`), pngBuffer)
    return {
      status: 'size-mismatch',
      message:
        `canvas size changed: baseline ${baseline.width}x${baseline.height}, ` +
        `actual ${actual.width}x${actual.height} — actual saved to tests/visual/__output__/`,
    }
  }

  const diff = new PNG({ width: baseline.width, height: baseline.height })
  const diffPixels = pixelmatch(
    baseline.data,
    actual.data,
    diff.data,
    baseline.width,
    baseline.height,
    { threshold: PIXEL_THRESHOLD }
  )
  const diffPixelRatio = diffPixels / (baseline.width * baseline.height)

  if (diffPixelRatio > MAX_DIFF_PIXEL_RATIO) {
    mkdirSync(OUTPUT_DIR, { recursive: true })
    writeFileSync(path.join(OUTPUT_DIR, `${name}.actual.png`), pngBuffer)
    writeFileSync(path.join(OUTPUT_DIR, `${name}.diff.png`), PNG.sync.write(diff))
    return {
      status: 'mismatched',
      diffPixelRatio,
      message:
        `${(diffPixelRatio * 100).toFixed(3)}% of pixels differ from baseline ` +
        `(allowed ${(MAX_DIFF_PIXEL_RATIO * 100).toFixed(3)}%) — actual + diff saved to ` +
        `tests/visual/__output__/${name}.{actual,diff}.png. If the change is intentional, ` +
        `re-run with UPDATE_SNAPSHOTS=1 to accept it as the new baseline.`,
    }
  }

  return {
    status: 'matched',
    diffPixelRatio,
    message: `matched baseline (${(diffPixelRatio * 100).toFixed(4)}% pixel diff)`,
  }
}
