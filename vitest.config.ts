import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // tsconfig sets jsx:"preserve" for Next/SWC, which vite would otherwise
  // honor and leave the JSX in lib/slide-renderer.tsx untransformed.
  // Vitest 4 ships rolldown-vite (oxc transformer), so the override lives
  // under `oxc`, not the classic `esbuild` option.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    // Mirror tsconfig's "@/*" path alias — vitest doesn't read tsconfig
    // paths on its own.
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Each visual test renders a full 1080x1350 slide through
    // Satori/resvg — slow by unit-test standards, normal for this suite.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
