// lucide-react's icon components are wrapped in React.forwardRef, which
// Satori (used by next/og's ImageResponse) silently fails to resolve —
// verified directly: a forwardRef-wrapped icon renders a blank image with
// no error, while the exact same SVG written by hand renders fine. Each
// icon module also exports its raw `__iconNode` path data (the array
// createLucideIcon builds the component from), which is plain data with
// no forwardRef involved — building <svg>/<path> JSX from that directly
// is real lucide-react icon data, just without the incompatible wrapper.
import { __iconNode as trendingUpNode } from 'lucide-react/dist/esm/icons/trending-up.mjs'
import { __iconNode as targetNode } from 'lucide-react/dist/esm/icons/target.mjs'
import { __iconNode as lightbulbNode } from 'lucide-react/dist/esm/icons/lightbulb.mjs'
import { __iconNode as checkCircleNode } from 'lucide-react/dist/esm/icons/circle-check-big.mjs'
import { __iconNode as arrowRightNode } from 'lucide-react/dist/esm/icons/arrow-right.mjs'

export type IconName =
  | 'TrendingUp'
  | 'Target'
  | 'Lightbulb'
  | 'CheckCircle'
  | 'ArrowRight'

export const ICON_NAMES: IconName[] = [
  'TrendingUp',
  'Target',
  'Lightbulb',
  'CheckCircle',
  'ArrowRight',
]

type IconNode = [string, Record<string, string>][]

const ICON_NODES: Record<IconName, IconNode> = {
  TrendingUp: trendingUpNode as IconNode,
  Target: targetNode as IconNode,
  Lightbulb: lightbulbNode as IconNode,
  CheckCircle: checkCircleNode as IconNode,
  ArrowRight: arrowRightNode as IconNode,
}

export function LucideIcon({
  name,
  size = 48,
  color = 'currentColor',
  strokeWidth = 2,
}: {
  name: IconName
  size?: number
  color?: string
  strokeWidth?: number
}) {
  const node = ICON_NODES[name]
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {node.map(([tag, attrs], i) => {
        if (tag === 'path') return <path key={i} d={attrs.d} />
        if (tag === 'circle')
          return <circle key={i} cx={attrs.cx} cy={attrs.cy} r={attrs.r} />
        if (tag === 'line')
          return <line key={i} x1={attrs.x1} y1={attrs.y1} x2={attrs.x2} y2={attrs.y2} />
        return null
      })}
    </svg>
  )
}

// Simple keyword heuristic for picking a slide icon based on content —
// falls back to a per-brand default when nothing matches, per spec
// ("based on sentiment if easy to infer, otherwise a consistent icon
// per brand").
const KEYWORD_ICONS: { icon: IconName; keywords: string[] }[] = [
  {
    icon: 'TrendingUp',
    keywords: ['naik', 'meningkat', 'tumbuh', 'growth', 'scale', 'progress'],
  },
  {
    icon: 'Target',
    keywords: ['target', 'tujuan', 'goal', 'fokus', 'sasaran'],
  },
  {
    icon: 'Lightbulb',
    keywords: ['ide', 'tips', 'insight', 'cara', 'strategi', 'trik', 'why'],
  },
  {
    icon: 'CheckCircle',
    keywords: ['selesai', 'checklist', 'berhasil', 'sukses', 'done', 'complete'],
  },
  {
    icon: 'ArrowRight',
    keywords: ['yuk', 'mulai', 'lanjut', 'action', 'sekarang'],
  },
]

const BRAND_DEFAULT_ICON: Record<string, IconName> = {
  'Sinatif Agency': 'Target',
  'Sinatif Academy': 'Lightbulb',
  'Osiris Event': 'CheckCircle',
  Hexolution: 'TrendingUp',
  'Bedadikit.id': 'ArrowRight',
}

export function pickSlideIcon(
  headline: string,
  body: string,
  brandName: string | null
): IconName {
  const text = `${headline} ${body}`.toLowerCase()
  for (const { icon, keywords } of KEYWORD_ICONS) {
    if (keywords.some((kw) => text.includes(kw))) return icon
  }
  return (brandName && BRAND_DEFAULT_ICON[brandName]) || 'Lightbulb'
}
