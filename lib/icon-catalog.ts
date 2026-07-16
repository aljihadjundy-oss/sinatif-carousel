// Asset-library icon catalog (Canva-flow redesign): a curated set of
// lucide icons importable by the editor AND renderable by the Satori
// exporter. Same __iconNode mechanism lib/icons.tsx pioneered (raw path
// data, no forwardRef — see that file for why), one explicit import per
// icon so the bundle stays tree-shaken: ~60 curated icons instead of
// shipping all ~1,500 lucide icons to the client. Adding an icon = one
// import + one map entry; everything downstream (editor drawer,
// validation, exporter) reads this catalog.
import { __iconNode as arrowRight } from 'lucide-react/dist/esm/icons/arrow-right.mjs'
import { __iconNode as arrowLeft } from 'lucide-react/dist/esm/icons/arrow-left.mjs'
import { __iconNode as arrowUp } from 'lucide-react/dist/esm/icons/arrow-up.mjs'
import { __iconNode as arrowDown } from 'lucide-react/dist/esm/icons/arrow-down.mjs'
import { __iconNode as arrowUpRight } from 'lucide-react/dist/esm/icons/arrow-up-right.mjs'
import { __iconNode as chevronRight } from 'lucide-react/dist/esm/icons/chevron-right.mjs'
import { __iconNode as moveRight } from 'lucide-react/dist/esm/icons/move-right.mjs'
import { __iconNode as trendingUp } from 'lucide-react/dist/esm/icons/trending-up.mjs'
import { __iconNode as trendingDown } from 'lucide-react/dist/esm/icons/trending-down.mjs'
import { __iconNode as target } from 'lucide-react/dist/esm/icons/target.mjs'
import { __iconNode as lightbulb } from 'lucide-react/dist/esm/icons/lightbulb.mjs'
import { __iconNode as checkCircle } from 'lucide-react/dist/esm/icons/circle-check-big.mjs'
import { __iconNode as check } from 'lucide-react/dist/esm/icons/check.mjs'
import { __iconNode as x } from 'lucide-react/dist/esm/icons/x.mjs'
import { __iconNode as plus } from 'lucide-react/dist/esm/icons/plus.mjs'
import { __iconNode as star } from 'lucide-react/dist/esm/icons/star.mjs'
import { __iconNode as heart } from 'lucide-react/dist/esm/icons/heart.mjs'
import { __iconNode as thumbsUp } from 'lucide-react/dist/esm/icons/thumbs-up.mjs'
import { __iconNode as sparkles } from 'lucide-react/dist/esm/icons/sparkles.mjs'
import { __iconNode as zap } from 'lucide-react/dist/esm/icons/zap.mjs'
import { __iconNode as flame } from 'lucide-react/dist/esm/icons/flame.mjs'
import { __iconNode as award } from 'lucide-react/dist/esm/icons/award.mjs'
import { __iconNode as trophy } from 'lucide-react/dist/esm/icons/trophy.mjs'
import { __iconNode as crown } from 'lucide-react/dist/esm/icons/crown.mjs'
import { __iconNode as rocket } from 'lucide-react/dist/esm/icons/rocket.mjs'
import { __iconNode as gem } from 'lucide-react/dist/esm/icons/gem.mjs'
import { __iconNode as briefcase } from 'lucide-react/dist/esm/icons/briefcase.mjs'
import { __iconNode as building } from 'lucide-react/dist/esm/icons/building-2.mjs'
import { __iconNode as chartBar } from 'lucide-react/dist/esm/icons/chart-column.mjs'
import { __iconNode as chartPie } from 'lucide-react/dist/esm/icons/chart-pie.mjs'
import { __iconNode as chartLine } from 'lucide-react/dist/esm/icons/chart-line.mjs'
import { __iconNode as wallet } from 'lucide-react/dist/esm/icons/wallet.mjs'
import { __iconNode as banknote } from 'lucide-react/dist/esm/icons/banknote.mjs'
import { __iconNode as shoppingCart } from 'lucide-react/dist/esm/icons/shopping-cart.mjs'
import { __iconNode as shoppingBag } from 'lucide-react/dist/esm/icons/shopping-bag.mjs'
import { __iconNode as tag } from 'lucide-react/dist/esm/icons/tag.mjs'
import { __iconNode as percent } from 'lucide-react/dist/esm/icons/percent.mjs'
import { __iconNode as gift } from 'lucide-react/dist/esm/icons/gift.mjs'
import { __iconNode as megaphone } from 'lucide-react/dist/esm/icons/megaphone.mjs'
import { __iconNode as messageCircle } from 'lucide-react/dist/esm/icons/message-circle.mjs'
import { __iconNode as mail } from 'lucide-react/dist/esm/icons/mail.mjs'
import { __iconNode as phone } from 'lucide-react/dist/esm/icons/phone.mjs'
import { __iconNode as share } from 'lucide-react/dist/esm/icons/share-2.mjs'
import { __iconNode as globe } from 'lucide-react/dist/esm/icons/globe.mjs'
import { __iconNode as hash } from 'lucide-react/dist/esm/icons/hash.mjs'
import { __iconNode as users } from 'lucide-react/dist/esm/icons/users.mjs'
import { __iconNode as user } from 'lucide-react/dist/esm/icons/user.mjs'
import { __iconNode as smile } from 'lucide-react/dist/esm/icons/smile.mjs'
import { __iconNode as eye } from 'lucide-react/dist/esm/icons/eye.mjs'
import { __iconNode as brain } from 'lucide-react/dist/esm/icons/brain.mjs'
import { __iconNode as bookOpen } from 'lucide-react/dist/esm/icons/book-open.mjs'
import { __iconNode as graduationCap } from 'lucide-react/dist/esm/icons/graduation-cap.mjs'
import { __iconNode as pencil } from 'lucide-react/dist/esm/icons/pencil.mjs'
import { __iconNode as calendar } from 'lucide-react/dist/esm/icons/calendar.mjs'
import { __iconNode as clock } from 'lucide-react/dist/esm/icons/clock.mjs'
import { __iconNode as timer } from 'lucide-react/dist/esm/icons/timer.mjs'
import { __iconNode as mapPin } from 'lucide-react/dist/esm/icons/map-pin.mjs'
import { __iconNode as camera } from 'lucide-react/dist/esm/icons/camera.mjs'
import { __iconNode as image } from 'lucide-react/dist/esm/icons/image.mjs'
import { __iconNode as music } from 'lucide-react/dist/esm/icons/music.mjs'
import { __iconNode as play } from 'lucide-react/dist/esm/icons/play.mjs'
import { __iconNode as video } from 'lucide-react/dist/esm/icons/video.mjs'
import { __iconNode as mic } from 'lucide-react/dist/esm/icons/mic.mjs'
import { __iconNode as coffee } from 'lucide-react/dist/esm/icons/coffee.mjs'
import { __iconNode as sun } from 'lucide-react/dist/esm/icons/sun.mjs'
import { __iconNode as moon } from 'lucide-react/dist/esm/icons/moon.mjs'
import { __iconNode as cloud } from 'lucide-react/dist/esm/icons/cloud.mjs'
import { __iconNode as leaf } from 'lucide-react/dist/esm/icons/leaf.mjs'
import { __iconNode as shield } from 'lucide-react/dist/esm/icons/shield-check.mjs'
import { __iconNode as lock } from 'lucide-react/dist/esm/icons/lock.mjs'
import { __iconNode as key } from 'lucide-react/dist/esm/icons/key.mjs'
import { __iconNode as settings } from 'lucide-react/dist/esm/icons/settings.mjs'
import { __iconNode as wrench } from 'lucide-react/dist/esm/icons/wrench.mjs'
import { __iconNode as alertTriangle } from 'lucide-react/dist/esm/icons/triangle-alert.mjs'
import { __iconNode as info } from 'lucide-react/dist/esm/icons/info.mjs'
import { __iconNode as helpCircle } from 'lucide-react/dist/esm/icons/circle-question-mark.mjs'
import { __iconNode as quote } from 'lucide-react/dist/esm/icons/quote.mjs'
import { __iconNode as bookmark } from 'lucide-react/dist/esm/icons/bookmark.mjs'
import { __iconNode as pin } from 'lucide-react/dist/esm/icons/pin.mjs'
import { __iconNode as bell } from 'lucide-react/dist/esm/icons/bell.mjs'
import { __iconNode as smartphone } from 'lucide-react/dist/esm/icons/smartphone.mjs'
import { __iconNode as laptop } from 'lucide-react/dist/esm/icons/laptop.mjs'
import { __iconNode as code } from 'lucide-react/dist/esm/icons/code.mjs'
import { __iconNode as package_ } from 'lucide-react/dist/esm/icons/package.mjs'
import { __iconNode as layers } from 'lucide-react/dist/esm/icons/layers.mjs'
import { __iconNode as puzzle } from 'lucide-react/dist/esm/icons/puzzle.mjs'
import { __iconNode as handshake } from 'lucide-react/dist/esm/icons/handshake.mjs'

export type CatalogIconNode = [string, Record<string, string>][]

export interface IconCategory {
  name: string
  icons: { name: string; node: CatalogIconNode }[]
}

// Categories drive the editor drawer's sections. Names are the keys
// stored in IconNode.name (PascalCase, matching the legacy 5 so old
// documents keep rendering).
export const ICON_CATEGORIES: IconCategory[] = [
  {
    name: 'Panah & Arah',
    icons: [
      { name: 'ArrowRight', node: arrowRight as CatalogIconNode },
      { name: 'ArrowLeft', node: arrowLeft as CatalogIconNode },
      { name: 'ArrowUp', node: arrowUp as CatalogIconNode },
      { name: 'ArrowDown', node: arrowDown as CatalogIconNode },
      { name: 'ArrowUpRight', node: arrowUpRight as CatalogIconNode },
      { name: 'ChevronRight', node: chevronRight as CatalogIconNode },
      { name: 'MoveRight', node: moveRight as CatalogIconNode },
      { name: 'TrendingUp', node: trendingUp as CatalogIconNode },
      { name: 'TrendingDown', node: trendingDown as CatalogIconNode },
    ],
  },
  {
    name: 'Simbol & Aksen',
    icons: [
      { name: 'Check', node: check as CatalogIconNode },
      { name: 'CheckCircle', node: checkCircle as CatalogIconNode },
      { name: 'X', node: x as CatalogIconNode },
      { name: 'Plus', node: plus as CatalogIconNode },
      { name: 'Star', node: star as CatalogIconNode },
      { name: 'Heart', node: heart as CatalogIconNode },
      { name: 'ThumbsUp', node: thumbsUp as CatalogIconNode },
      { name: 'Sparkles', node: sparkles as CatalogIconNode },
      { name: 'Zap', node: zap as CatalogIconNode },
      { name: 'Flame', node: flame as CatalogIconNode },
      { name: 'Quote', node: quote as CatalogIconNode },
      { name: 'AlertTriangle', node: alertTriangle as CatalogIconNode },
      { name: 'Info', node: info as CatalogIconNode },
      { name: 'HelpCircle', node: helpCircle as CatalogIconNode },
    ],
  },
  {
    name: 'Bisnis & Data',
    icons: [
      { name: 'Target', node: target as CatalogIconNode },
      { name: 'Briefcase', node: briefcase as CatalogIconNode },
      { name: 'Building2', node: building as CatalogIconNode },
      { name: 'BarChart3', node: chartBar as CatalogIconNode },
      { name: 'PieChart', node: chartPie as CatalogIconNode },
      { name: 'LineChart', node: chartLine as CatalogIconNode },
      { name: 'Wallet', node: wallet as CatalogIconNode },
      { name: 'Banknote', node: banknote as CatalogIconNode },
      { name: 'ShoppingCart', node: shoppingCart as CatalogIconNode },
      { name: 'ShoppingBag', node: shoppingBag as CatalogIconNode },
      { name: 'Tag', node: tag as CatalogIconNode },
      { name: 'Percent', node: percent as CatalogIconNode },
      { name: 'Gift', node: gift as CatalogIconNode },
      { name: 'Award', node: award as CatalogIconNode },
      { name: 'Trophy', node: trophy as CatalogIconNode },
      { name: 'Crown', node: crown as CatalogIconNode },
      { name: 'Rocket', node: rocket as CatalogIconNode },
      { name: 'Gem', node: gem as CatalogIconNode },
      { name: 'Handshake', node: handshake as CatalogIconNode },
    ],
  },
  {
    name: 'Komunikasi & Sosial',
    icons: [
      { name: 'Megaphone', node: megaphone as CatalogIconNode },
      { name: 'MessageCircle', node: messageCircle as CatalogIconNode },
      { name: 'Mail', node: mail as CatalogIconNode },
      { name: 'Phone', node: phone as CatalogIconNode },
      { name: 'Share2', node: share as CatalogIconNode },
      { name: 'Globe', node: globe as CatalogIconNode },
      { name: 'Hash', node: hash as CatalogIconNode },
      { name: 'Users', node: users as CatalogIconNode },
      { name: 'User', node: user as CatalogIconNode },
      { name: 'Smile', node: smile as CatalogIconNode },
      { name: 'Eye', node: eye as CatalogIconNode },
      { name: 'Bell', node: bell as CatalogIconNode },
    ],
  },
  {
    name: 'Edukasi & Kreatif',
    icons: [
      { name: 'Lightbulb', node: lightbulb as CatalogIconNode },
      { name: 'Brain', node: brain as CatalogIconNode },
      { name: 'BookOpen', node: bookOpen as CatalogIconNode },
      { name: 'GraduationCap', node: graduationCap as CatalogIconNode },
      { name: 'Pencil', node: pencil as CatalogIconNode },
      { name: 'Camera', node: camera as CatalogIconNode },
      { name: 'Image', node: image as CatalogIconNode },
      { name: 'Music', node: music as CatalogIconNode },
      { name: 'Play', node: play as CatalogIconNode },
      { name: 'Video', node: video as CatalogIconNode },
      { name: 'Mic', node: mic as CatalogIconNode },
      { name: 'Code', node: code as CatalogIconNode },
    ],
  },
  {
    name: 'Lainnya',
    icons: [
      { name: 'Calendar', node: calendar as CatalogIconNode },
      { name: 'Clock', node: clock as CatalogIconNode },
      { name: 'Timer', node: timer as CatalogIconNode },
      { name: 'MapPin', node: mapPin as CatalogIconNode },
      { name: 'Coffee', node: coffee as CatalogIconNode },
      { name: 'Sun', node: sun as CatalogIconNode },
      { name: 'Moon', node: moon as CatalogIconNode },
      { name: 'Cloud', node: cloud as CatalogIconNode },
      { name: 'Leaf', node: leaf as CatalogIconNode },
      { name: 'ShieldCheck', node: shield as CatalogIconNode },
      { name: 'Lock', node: lock as CatalogIconNode },
      { name: 'Key', node: key as CatalogIconNode },
      { name: 'Settings', node: settings as CatalogIconNode },
      { name: 'Wrench', node: wrench as CatalogIconNode },
      { name: 'Bookmark', node: bookmark as CatalogIconNode },
      { name: 'Pin', node: pin as CatalogIconNode },
      { name: 'Smartphone', node: smartphone as CatalogIconNode },
      { name: 'Laptop', node: laptop as CatalogIconNode },
      { name: 'Package', node: package_ as CatalogIconNode },
      { name: 'Layers', node: layers as CatalogIconNode },
      { name: 'Puzzle', node: puzzle as CatalogIconNode },
    ],
  },
]

export const CATALOG_ICON_NODES: Record<string, CatalogIconNode> = Object.fromEntries(
  ICON_CATEGORIES.flatMap((c) => c.icons.map((i) => [i.name, i.node]))
)

// The full valid IconNode.name list — write-boundary validation for
// slide_documents checks against THIS (superset of the legacy 5 in
// lib/icons.tsx, which stay for pickSlideIcon/back-compat).
export const CATALOG_ICON_NAMES: string[] = Object.keys(CATALOG_ICON_NODES)
