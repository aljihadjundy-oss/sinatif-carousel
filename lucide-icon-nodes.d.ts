// lucide-react's individual icon modules export a raw __iconNode path-data
// array alongside the forwardRef-wrapped component; see lib/icons.tsx for
// why we import the raw data instead of the component. These files ship
// with the package but aren't covered by lucide-react's own type exports.
declare module 'lucide-react/dist/esm/icons/*.mjs' {
  export const __iconNode: [string, Record<string, string>][]
  const Icon: unknown
  export default Icon
}
