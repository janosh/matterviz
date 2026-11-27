import { browser } from '$app/env'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { onMount } from 'svelte'
import type { ChemicalElement } from '#lib/element/types'
import type { FileInfo, FileLoadMeta } from '#lib/io/types'
import type { NavGroup as WidgetNavGroup } from 'svelte-widgets'

// Remove adapter-static HTML filenames before SvelteKit client navigation.
export const normalize_static_url = (url: string): string =>
  url.replace(/\/index\.html(?=[?#]|$)/, `/`).replace(/\.html(?=[?#]|$)/, ``)

// Replace URL state without moving focus or scrolling.
export const replace_url = (url: string | URL): Promise<void> =>
  goto(normalize_static_url(String(url)), { replace: true, reset: false })

// `?file=<fixture name>` and the like deep-link the demo pages. Read client-side only:
// url.searchParams is off-limits during prerender (it would 500 the static build).
export const url_param = (key: string): string | null =>
  browser ? page.url.searchParams.get(key) : null

// Write `?key=` (null drops it, e.g. a user-dropped file has no fixture entry to name) on a
// copy of page.url, which is read-only reactive state from $app/state. Writes in one tick share
// that copy and one navigation, so two pickers changed together both land.
let pending_url: URL | undefined
export const set_url_param = (key: string, value: string | null): void => {
  if (!browser) return
  if (!pending_url) {
    const url = new URL(page.url.href)
    pending_url = url
    queueMicrotask(() => {
      pending_url = undefined
      if (url.href !== page.url.href) void replace_url(url)
    })
  }
  if (value) pending_url.searchParams.set(key, value)
  else pending_url.searchParams.delete(key)
}

// A picker's selection mirrored to `?key=`: the URL's value once mounted (when it names one of
// `options`), and every later pick written back. `initial` (default: the first option) leaves
// the param off, so a page's default view keeps a clean URL. picker() gives the FilePicker
// props listing the options as chips of one `type` (no badges), named by `label`.
export const url_selection = <T extends string>(
  key: string,
  options: readonly T[],
  initial: T = options[0],
) => {
  let value = $state(initial)
  onMount(() => {
    const requested = options.find((option) => option === url_param(key))
    if (requested !== undefined) value = requested
  })
  const pick = (next: T) => {
    value = next
    set_url_param(key, next === initial ? null : next)
  }
  return {
    get value() {
      return value
    },
    set value(next: T) {
      pick(next)
    },
    picker: (type: string, label = (option: T): string => option) => ({
      files: options.map((option) => ({ name: label(option), url: option, type })),
      active_files: [label(value)],
      on_click: ({ url }: FileInfo) => pick(url as T),
    }),
  }
}

// The `?file=` fixture a viewer's load can deep-link: a URL load is a site fixture picked or
// dragged from a FilePicker, a dropped local file has none (and re-pointing the viewer's
// `source` at its name would fetch a 404)
export const loaded_fixture = ({
  source_filename,
  source_url,
}: Partial<FileLoadMeta>): string | null => (source_url ? (source_filename ?? null) : null)

// Activating a periodic-table tile in a demo opens that element's page
export const open_element_page = ({ name }: ChemicalElement): void =>
  void goto(`/${name.toLowerCase()}`)

const ROUTE_LABELS: Record<string, string> = {
  '/how-to/hook-up-to-external-api': `Hook up to external API`,
  '/how-to/use-without-svelte': `Use without Svelte`,
  '/neb': `NEB`,
  '/structure/diff': `Structure Diff`,
  '/structure/rdf': `RDF`,
  '/structure/xrd': `XRD`,
  '/structure/wulff': `Wulff Shape`,
  '/spectral/dos': `DOS`,
  '/spectral/bands-and-dos': `Bands + DOS`,
  '/spectral/brillouin-bands-dos': `Brillouin + Bands + DOS`,
  '/spectral/ir-raman': `IR + Raman`,
  '/spectral/phonon-mode-explorer': `Phonon Mode Explorer`,
  '/spectral/cohp': `COHP / COOP / COBI`,
  '/phase-diagram/pressure-temperature': `Pressure–Temperature`,
}

export const routes = Object.keys(import.meta.glob(`../routes/**/+page.{svelte,md}`))
  .filter((filename) => !filename.includes(`/(hide)/`))
  .map((filename) => {
    const parts = filename.split(`/`).filter((part) => !part.startsWith(`(`)) // remove hidden route segments
    return { route: `/${parts.slice(2, -1).join(`/`)}`, filename }
  })

if (routes.length === 0) console.error(`No routes found`)

// `sections` maps a dropdown heading to the prefixes listed under it, in order, ahead of the
// group's plain `prefixes`
export type NavGroup = {
  label: string
  href: string
  prefixes: string[]
  sections?: Record<string, string[]>
}

// Routes under `base`, for listing a section's demos by slug
const under = (base: string, slugs: string[]) => slugs.map((slug) => `${base}/${slug}`)

// Top-level nav dropdowns in display order. A route belongs to the first group whose prefix
// matches it exactly or as a parent path; children keep prefix order, then path order. Where
// the href is itself a page (/structure, /plot) the group label links there, else it's a
// plain heading. Section sizes are picked so two-column dropdowns break between sections.
// oxfmt-ignore
export const NAV_GROUPS: NavGroup[] = [
  { label: `Structure`, href: `/structure`, prefixes: [`/structure`, `/trajectory`, `/neb`], sections: {
    Viewing: under(`/structure`, [`render`, `gallery`, `vectors`, `polyhedra`, `isosurface`,
      `multi-volume`, `host-tool`]),
    Building: under(`/structure`, [`slab`, `interface`, `wulff`]),
    Analysis: under(`/structure`, [`symmetry`, `bond-angles`, `coordination`, `rdf`, `xrd`,
      `diff`]),
    Dynamics: [`/trajectory`, `/neb`],
  } },
  { label: `Thermodynamics`, href: `/thermodynamics`, prefixes: [`/thermodynamics`, `/convex-hull`,
    `/phase-diagram`] },
  // /spectral claims the hub (the label links to it) and new demos, listed last without a heading.
  // Electronic + Phonon (7 items) fill the first of the two dropdown columns, so the column
  // break lands on the shared section's heading
  { label: `Electronic & Phonons`, href: `/spectral`, prefixes: [`/spectral`], sections: {
    Electronic: under(`/spectral`, [`electronic-structure`, `fermi-surface`, `cohp`]),
    Phonon: under(`/spectral`, [`ir-raman`, `phonon-mode-explorer`]),
    'Electronic & phonon': under(`/spectral`, [`brillouin-zone`, `bands`, `dos`, `bands-and-dos`,
      `brillouin-bands-dos`]),
  } },
  { label: `Elements`, href: `/elements`, prefixes: [`/elements`, `/periodic-table`, `/composition`] },
  { label: `Plots`, href: `/plot`, prefixes: [`/plot`], sections: {
    Charts: under(`/plot`, [`scatter-plot`, `scatter-plot-3d`, `binned-scatter`, `ternary`,
      `bar-plot`, `histogram`, `box-plot`, `violin`]),
    'Matrices & grids': under(`/plot`, [`heatmap-matrix`, `heatmap-table`, `facet-grid`]),
    'Hierarchies & flows': under(`/plot`, [`sunburst`, `treemap`, `sankey`]),
    Color: under(`/plot`, [`color-bar`, `color-scales`]),
    Recipes: under(`/plot`, [`linked-brushing`, `data-cleaning`, `eos`, `spacegroup-bar-plot`]),
  } },
  { label: `Guides`, href: `/guides`, prefixes: [`/guides`, `/how-to`, `/acknowledgements`] },
]

// Routes that exist but stay out of the dropdowns: the layout adds `/` as Home itself, the
// rest are reachable via search and direct links only
const HIDDEN_NAV_PREFIXES = [`/`, `/layout`, `/test`, `/404`, `/[slug]`]

const has_prefix = (route: string, prefix: string) =>
  route === prefix || (prefix !== `/` && route.startsWith(`${prefix}/`))

// Sort `nav_routes` into NAV_GROUPS dropdowns. Throws on a route no group claims so a new demo
// directory gets placed deliberately instead of silently disappearing from the nav.
export function group_nav_routes(
  nav_routes: string[],
  groups: NavGroup[] = NAV_GROUPS,
): WidgetNavGroup[] {
  const prefix_idx = (route: string, { prefixes, sections = {} }: NavGroup) =>
    [...Object.values(sections).flat(), ...prefixes].findIndex((prefix) =>
      has_prefix(route, prefix),
    )
  const unclaimed = nav_routes.filter((route) =>
    groups.every((group) => prefix_idx(route, group) === -1),
  )
  if (unclaimed.length > 0) {
    throw new Error(`routes not in any NAV_GROUPS entry: ${unclaimed.join(`, `)}`)
  }
  return groups.flatMap((group) => {
    // first matching group wins, so a prefix repeated across groups claims a route only once
    const children = nav_routes
      .filter((route) => groups.find((other) => prefix_idx(route, other) !== -1) === group)
      .toSorted(
        (route_a, route_b) =>
          prefix_idx(route_a, group) - prefix_idx(route_b, group) ||
          route_a.localeCompare(route_b),
      )
    if (children.length === 0) return []
    return [
      {
        label: group.label,
        ...(children.includes(group.href) ? { href: group.href } : {}),
        children: children
          .filter((href) => href !== group.href)
          .map((href) => ({
            href,
            section: Object.entries(group.sections ?? {}).find(([, prefixes]) =>
              prefixes.some((prefix) => has_prefix(href, prefix)),
            )?.[0],
            label:
              ROUTE_LABELS[href] ??
              href
                .replace(/^.*\//, ``) // last segment
                .replaceAll(`-`, ` `)
                .replaceAll(/\b\w/g, (char) => char.toUpperCase()),
          })),
      },
    ]
  })
}

export const nav_routes = group_nav_routes(
  routes
    .map(({ route }) => route)
    .filter((route) => !HIDDEN_NAV_PREFIXES.some((prefix) => has_prefix(route, prefix))),
)

// Latest-wins guard for async demo loads: write state only while the `is_current()` returned
// by `start()` holds; `cancel()` supersedes every load in flight (e.g. on a file drop)
export const latest_load = () => {
  let latest_id = 0
  return {
    start: (): (() => boolean) => {
      const load_id = ++latest_id
      return () => load_id === latest_id
    },
    cancel: (): void => void latest_id++,
  }
}

// Demo pages whose main components their last route segment doesn't name (PascalCased); []
// for index pages and demos of components from other packages, which get no prop tables
export const PAGE_COMPONENTS: Record<string, string[]> = {
  '/bohr-atoms': [`BohrAtom`],
  '/convex-hull/chempot-diagram': [`ChemPotDiagram`],
  '/convex-hull/synthesis-planning': [`SynthesisPlanner`],
  '/elements': [],
  '/guides': [],
  '/how-to/hook-up-to-external-api': [],
  '/how-to/use-without-svelte': [`Structure`],
  '/icon': [],
  '/layout/json-tree': [],
  '/neb': [`NebViewer`, `NebPlot`],
  '/optimade-[slug]': [],
  '/periodic-table/element-colors': [`PeriodicTable`],
  '/phase-diagram': [`IsobaricBinaryPhaseDiagram`],
  '/phase-diagram/pourbaix': [`PourbaixDiagram`],
  '/phase-diagram/pressure-temperature': [`PressureTemperaturePhaseDiagram`],
  '/phase-diagram/ternary': [`IsobaricTernaryPhaseDiagram`],
  '/plot': [],
  '/plot/binned-scatter': [`BinnedScatterPlot`],
  '/plot/color-scales': [`ColorScaleSelect`],
  '/plot/data-cleaning': [`ScatterPlot`],
  '/plot/eos': [`EosPlot`],
  '/plot/linked-brushing': [`ScatterPlot`, `PeriodicTable`],
  '/plot/scatter-plot-3d': [`ScatterPlot3D`],
  '/plot/ternary': [`TernaryPlot`],
  '/plot/violin': [`BoxPlot`],
  '/spectral': [],
  '/spectral/brillouin-bands-dos': [`BandsAndDos`],
  '/spectral/ir-raman': [`IrRamanSpectrum`],
  '/structure/bond-angles': [`BondAnglePlot`],
  '/structure/coordination': [`CoordinationBarPlot`],
  '/structure/diff': [`StructureDiff`],
  '/structure/gallery': [`StructureGallery`],
  '/structure/host-tool': [`Structure`],
  '/structure/interface': [`InterfaceBuilder`],
  '/structure/multi-volume': [`Structure`],
  '/structure/polyhedra': [`Structure`],
  '/structure/rdf': [`RdfPlot`],
  '/structure/render': [`Structure`],
  '/structure/slab': [`SlabBuilder`],
  '/structure/symmetry': [`SymmetryStats`, `WyckoffTable`],
  '/structure/vectors': [`Structure`],
  '/structure/wulff': [`WulffShape`, `WulffFacetEditor`],
  '/structure/xrd': [`XrdPlot`, `SaedPattern`],
  '/thermodynamics': [],
  '/trajectory/render': [`Trajectory`],
}

// Components a demo page's generated prop tables (the (demos) layout) document, from
// its route id: the PAGE_COMPONENTS entry, else the PascalCased last segment
export const page_components = (route_id: string): string[] => {
  const parts = route_id.split(`/`).filter((part) => !part.startsWith(`(`)) // drop (group) segments
  const pascal = (parts.at(-1) ?? ``).replaceAll(/(?:^|-)\w/g, (match) =>
    match.slice(-1).toUpperCase(),
  )
  return PAGE_COMPONENTS[parts.join(`/`)] ?? [pascal]
}
