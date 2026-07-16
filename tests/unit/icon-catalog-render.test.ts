import { describe, expect, it } from 'vitest'
import { LucideIcon, ICON_NAMES, ALL_ICON_NAMES } from '@/lib/icons'
import { ICON_CATEGORIES } from '@/lib/icon-catalog'

// Bug fix regression: the editor canvas (app/.../editor/SlideCanvas.tsx)
// used to gate icon rendering with `ICON_NAMES.includes(node.name)` — a
// 5-name legacy allowlist — before calling LucideIcon, silently dropping
// every asset-library catalog icon even though LucideIcon itself already
// resolves the merged catalog correctly (this is exactly how the same
// icon rendered fine through the Satori export path, which never had
// that gate). The regression is really "did anything reintroduce a
// legacy-only allowlist between the icon name and LucideIcon" — this
// test asserts LucideIcon itself (the single render path both the editor
// and the exporter now share) returns a real element for every catalog
// icon and every legacy icon, and that ALL_ICON_NAMES actually covers
// every name the asset-library drawer offers (the other half of the bug:
// write-boundary validation and render must agree on the same list).
describe('icon catalog is fully renderable and validated consistently', () => {
  it('LucideIcon resolves every legacy icon name to a real element', () => {
    for (const name of ICON_NAMES) {
      const el = LucideIcon({ name, size: 24, color: '#000', strokeWidth: 2 })
      expect(el, `legacy icon "${name}" should render`).not.toBeNull()
    }
  })

  it('LucideIcon resolves every asset-library catalog icon to a real element', () => {
    for (const category of ICON_CATEGORIES) {
      for (const icon of category.icons) {
        const el = LucideIcon({ name: icon.name, size: 24, color: '#000', strokeWidth: 2 })
        expect(el, `catalog icon "${icon.name}" (${category.name}) should render`).not.toBeNull()
      }
    }
  })

  it('LucideIcon returns null (not a crash) for a genuinely unknown name', () => {
    expect(LucideIcon({ name: 'TotallyMadeUpIconXYZ' })).toBeNull()
  })

  it('ALL_ICON_NAMES (the write-boundary validation list) covers every catalog icon and every legacy icon', () => {
    const allCatalogNames = ICON_CATEGORIES.flatMap((c) => c.icons.map((i) => i.name))
    for (const name of allCatalogNames) {
      expect(ALL_ICON_NAMES, `catalog icon "${name}" missing from ALL_ICON_NAMES`).toContain(name)
    }
    for (const name of ICON_NAMES) {
      expect(ALL_ICON_NAMES, `legacy icon "${name}" missing from ALL_ICON_NAMES`).toContain(name)
    }
    // No duplicates smuggled in by the union.
    expect(new Set(ALL_ICON_NAMES).size).toBe(ALL_ICON_NAMES.length)
  })
})
