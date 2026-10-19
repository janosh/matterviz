import type { IconData } from 'svelte-widgets'
import custom_src from '#root/node_modules/svelte-widgets/dist/icons/custom.js?raw'
import generated_src from '#root/node_modules/svelte-widgets/dist/icons/generated.js?raw'

// The gallery needs every glyph, but any namespace import or computed access of
// `svelte-widgets/icons` keeps all ~2000 glyphs in the module the root layout imports for its
// own few icons, adding ~340 KB (gzip) to every route. So the gallery ships the glyph modules'
// source text (its own `?raw` modules) and evaluates them as data: URL modules here.
const import_source = (src: string): Promise<Record<string, unknown>> =>
  import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`)

const is_icon = (value: unknown): value is IconData =>
  typeof value === `object` && value !== null && `viewBox` in value

export const load = async (): Promise<{ icons: Record<string, IconData> }> => {
  const modules = await Promise.all([custom_src, generated_src].map(import_source))
  const icons = Object.fromEntries(
    modules.flatMap((module) =>
      Object.entries(module).filter((entry): entry is [string, IconData] => is_icon(entry[1])),
    ),
  )
  if (!icons.Search) {
    throw new Error(
      `Icon gallery found no svelte-widgets glyphs (${Object.keys(icons).length} exports)`,
    )
  }
  return { icons }
}
