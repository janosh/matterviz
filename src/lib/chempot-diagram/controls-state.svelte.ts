// Reactive state shared by ChemPotDiagram2D and ChemPotDiagram3D: per-key control overrides,
// the temperature slice of the entries, the worker computation and the domain colouring
import { get_electro_neg_formula } from '#lib/composition/format.js'
import { parse_formula } from '#lib/composition/parse.js'
import { get_valid_temperature } from '#lib/convex-hull/helpers.js'
import type { PhaseData } from '#lib/convex-hull/types.js'
import { clamp } from '#lib/math.js'
import type { Point2D, Vec2 } from '#lib/math.js'
import { to_color_scale_config } from '#lib/plot/core/scales.js'
import type { ColorScaleConfig } from '#lib/plot/core/types.js'
import { to_error } from 'svelte-widgets/utils'
import { getAbortSignal, untrack } from 'svelte'
import { compute_chempot_async } from './async-compute.svelte'
import { get_domain_color_data } from './color'
import {
  chempot_axes,
  entry_elements,
  formula_key_from_composition,
  get_energy_stats_by_formula,
  get_min_entries_and_el_refs,
  section_chempot_system,
  section_measure_curves,
  slice_range,
} from './compute'
import { get_temp_filter_payload } from './temperature'
import {
  CHEMPOT_DEFAULTS,
  type ChemPotColorMode,
  type ChemPotDiagramConfig,
  type ChemPotDiagramData,
  type ChemPotSystem,
} from './types'

// Per-key user overrides with `override ?? config ?? default` resolution; `reset()`
// clears all overrides (the panes' "Clear overrides" buttons). Defaults come from
// CHEMPOT_DEFAULTS unless overridden via custom_defaults; keys without either throw upfront.
export function create_chempot_overrides<Key extends keyof ChemPotDiagramConfig>(
  config: () => ChemPotDiagramConfig,
  keys: readonly Key[],
  custom_defaults: { [P in Key]?: NonNullable<ChemPotDiagramConfig[P]> } = {},
) {
  const defaults = Object.fromEntries(
    keys.map((key) => {
      const fallback =
        custom_defaults[key] ?? CHEMPOT_DEFAULTS[key as keyof typeof CHEMPOT_DEFAULTS]
      if (fallback === undefined) {
        throw new Error(
          `create_chempot_overrides: key '${key}' is missing from both custom_defaults and CHEMPOT_DEFAULTS`,
        )
      }
      return [key, fallback]
    }),
  ) as { [P in Key]: NonNullable<ChemPotDiagramConfig[P]> }
  let overrides = $state<{ [P in Key]?: NonNullable<ChemPotDiagramConfig[P]> }>({})
  return {
    resolve: <P extends Key>(key: P): NonNullable<ChemPotDiagramConfig[P]> =>
      overrides[key] ?? config()[key] ?? defaults[key],
    set: <P extends Key>(key: P, value: NonNullable<ChemPotDiagramConfig[P]>): void => {
      overrides[key] = value
    },
    reset: (): void => {
      overrides = {}
    },
    get changed_keys(): Key[] {
      return Object.keys(overrides) as Key[]
    },
  }
}

// The controls both panes expose (ChemPotControls.svelte renders them)
const CHEMPOT_CONTROL_KEYS = [
  `formal_chempots`,
  `label_stable`,
  `element_padding`,
  `default_min_limit`,
  `color_mode`,
  `color_scale`,
  `slice_chempots`,
] as const
export type ChemPotControlKey = (typeof CHEMPOT_CONTROL_KEYS)[number]
// The resolved values ChemPotControls reads, color_scale as a full config
export type ChemPotControlValues = {
  [Key in ChemPotControlKey]: Key extends `color_scale`
    ? ColorScaleConfig
    : NonNullable<ChemPotDiagramConfig[Key]>
}

export function create_chempot_state<Extra extends keyof ChemPotDiagramConfig = never>(opts: {
  entries: () => PhaseData[]
  config: () => ChemPotDiagramConfig
  // The bound temperature; snapped into the data's range once the payload is known
  temperature: { get: () => number | undefined; set: (value: number | undefined) => void }
  // Fewer entries than this skip the computation; a result with fewer axes is dropped
  min_elements: number
  // Display axes (3D projection picker); undefined leaves them to the config and the data
  elements?: () => string[] | undefined
  // Domains currently drawn: they set the colour-scale range and the arity legend rows
  formulas: () => string[]
  extra_keys?: readonly Extra[]
  custom_defaults?: { [P in ChemPotControlKey | Extra]?: NonNullable<ChemPotDiagramConfig[P]> }
  label: string // error-log prefix
}) {
  const keys: readonly (ChemPotControlKey | Extra)[] = [
    ...CHEMPOT_CONTROL_KEYS,
    ...(opts.extra_keys ?? []),
  ]
  const overrides = create_chempot_overrides(opts.config, keys, opts.custom_defaults)
  const { resolve } = overrides

  // Primitives, so a fresh config object doesn't re-slice the entries (and re-run the worker)
  const interpolate_temperature = $derived(opts.config().interpolate_temperature)
  const max_interpolation_gap = $derived(opts.config().max_interpolation_gap)
  const temp_payload = $derived(
    get_temp_filter_payload(opts.entries(), opts.temperature.get(), {
      interpolate_temperature,
      max_interpolation_gap,
    }),
  )
  $effect(() => {
    const next = get_valid_temperature(
      opts.temperature.get(),
      temp_payload.available_temperatures,
      interpolate_temperature ?? CHEMPOT_DEFAULTS.interpolate_temperature,
    )
    if (next !== opts.temperature.get()) opts.temperature.set(next)
  })

  const axes = $derived(
    chempot_axes(
      entry_elements(temp_payload.temp_filtered_entries),
      opts.elements?.() ?? opts.config().elements,
    ),
  )
  // Only what compute_chempot_system reads, so display toggles (labels, padding, overlays),
  // projection axes and slices never re-run the worker; the previous diagram stays on screen
  // while a replacement computes
  const compute_config = $derived<ChemPotDiagramConfig>({
    formal_chempots: resolve(`formal_chempots`),
    default_min_limit: resolve(`default_min_limit`),
    limits: opts.config().limits,
    elements: axes.compute,
  })
  // A recreated but equal config must not recompute
  const compute_key = $derived(JSON.stringify(compute_config))
  let system = $state.raw<ChemPotSystem | null>(null)
  let computing = $state(false)
  let worker_error = $state<string | null>(null)
  $effect(() => {
    const entries = temp_payload.temp_filtered_entries
    void compute_key
    const config = untrack(() => compute_config)
    if (entries.length < opts.min_elements) {
      system = null
      computing = false
      worker_error = null
      return
    }
    const signal = getAbortSignal()
    computing = true
    compute_chempot_async(entries, config, { signal })
      .then((result) => {
        if (signal.aborted) return
        system = result
        worker_error = null
      })
      .catch((err: unknown) => {
        if (signal.aborted) return
        console.error(`${opts.label}:`, err)
        system = null
        worker_error = to_error(err).message
      })
      .finally(() => {
        if (!signal.aborted) computing = false
      })
  })
  $effect(() => () => compute_chempot_async.release())

  // A system computed on other axes is stale (the worker is still on its replacement)
  const stale = $derived(system?.elements.join(`|`) !== axes.compute.join(`|`))
  // Axes beyond the display ones, each sliced at a fixed mu or else shadow-projected. Slices
  // of axes now displayed (or gone from the data) are kept but inactive. None while stale, so
  // no slider offers ranges of the old system.
  const slice_elements = $derived(
    stale || !system
      ? []
      : system.elements.filter((element) => !axes.display.includes(element)),
  )
  const padding = $derived(resolve(`element_padding`))
  const min_limit = $derived(resolve(`default_min_limit`))
  // A non-finite slice value is a config error, shown instead of a diagram (controls stay
  // editable); the clamping below skips it so every range computation stays finite
  const slice_error = $derived.by((): string | null => {
    const [element, value] =
      Object.entries(resolve(`slice_chempots`)).find(
        ([, val]) => val !== undefined && !Number.isFinite(val),
      ) ?? []
    return element ? `slice_chempots.${element} must be finite, got ${value}` : null
  })
  // Requested slices clamped in element order, each into the range the ones before it leave
  // feasible, so no combination empties the region (e.g. a value above the element's
  // reference in absolute chempots, or two jointly above a compound of just those elements)
  const slices = $derived.by((): Record<string, number> => {
    const [sys, requested] = [system, resolve(`slice_chempots`)]
    const clamped: Record<string, number> = {}
    if (!sys) return clamped
    for (const element of slice_elements) {
      const value = requested[element]
      if (value === undefined || !Number.isFinite(value)) continue
      const [lower, upper] = slice_range(sys, element, padding, min_limit, clamped)
      clamped[element] = clamp(value, lower, upper)
    }
    return clamped
  })
  // Each slider's range given all other slices
  const slice_ranges = $derived.by((): Record<string, Vec2> => {
    const sys = system
    if (!sys) return {}
    return Object.fromEntries(
      slice_elements.map((element) => [
        element,
        slice_range(sys, element, padding, min_limit, slices),
      ]),
    )
  })
  // Sectioning is a vertex enumeration on the display axes, cheap enough to follow a slider.
  // While the system is stale the last section stays on screen.
  type Section = { data: ChemPotDiagramData | null; error: string | null }
  let last_section: Section = { data: null, error: null }
  const section = $derived.by((): Section => {
    if (!system) return (last_section = { data: null, error: null })
    if (slice_error) return (last_section = { data: null, error: slice_error })
    if (stale) return last_section
    try {
      const data = section_chempot_system(system, axes.display, slices)
      const enough = data.elements.length >= opts.min_elements
      return (last_section = { data: enough ? data : null, error: null })
    } catch (err) {
      return (last_section = { data: null, error: to_error(err).message })
    }
  })
  // Unsliced shadow projection while slicing: it bounds every section, so views frame on it.
  // Keyed on a boolean, so a slider sweep doesn't rebuild it.
  const slicing = $derived(Object.keys(slices).length > 0)
  const frame_data = $derived(
    system && slicing && !stale ? section_chempot_system(system, axes.display) : null,
  )
  // Each slice's measure curves ignore its own value, so dragging its slider reuses them. One
  // entry per element: dragging another slider replaces it. Skipped if the section fails,
  // where the curves (sections of a subset of the slices) could fail too.
  const curve_cache = new Map<
    string,
    { system: ChemPotSystem; key: string; curves: Map<string, Vec2[]> | null }
  >()
  const slice_curves = $derived.by((): Record<string, Map<string, Vec2[]> | null> => {
    if (!system || stale || section.error) return {}
    const sys = system
    return Object.fromEntries(
      Object.keys(slices).map((element) => {
        const range = slice_ranges[element]
        // JSON drops the undefined value: the key holds only the other slices
        const key = JSON.stringify([{ ...slices, [element]: undefined }, range, axes.display])
        let cached = curve_cache.get(element)
        if (cached?.system !== sys || cached.key !== key) {
          const curves = section_measure_curves(sys, axes.display, slices, element, range)
          cached = { system: sys, key, curves }
          curve_cache.set(element, cached)
        }
        return [element, cached.curves]
      }),
    )
  })
  // undefined switches the element back to shadow projection
  const set_slice = (element: string, value: number | undefined): void => {
    const { [element]: _dropped, ...rest } = resolve(`slice_chempots`)
    overrides.set(`slice_chempots`, value === undefined ? rest : { ...rest, [element]: value })
  }

  // Raw (non-renormalized) elemental references for true formation energies; the
  // formal-chempot pipeline renormalizes its own refs to zero. Memoized apart from the
  // colours so colour toggles don't re-scan the entries.
  const el_refs = $derived(
    get_min_entries_and_el_refs(temp_payload.temp_filtered_entries).el_refs,
  )
  const energy_stats = $derived(
    get_energy_stats_by_formula(temp_payload.temp_filtered_entries),
  )
  // Field-wise defaults, so a bare scheme name keeps the default reversed palette_range
  const color_scale = $derived({
    ...CHEMPOT_DEFAULTS.color_scale,
    ...to_color_scale_config(resolve(`color_scale`)),
  })
  const color = $derived(
    get_domain_color_data({
      formulas: opts.formulas(),
      color_mode: resolve(`color_mode`),
      color_scale,
      entries: temp_payload.temp_filtered_entries,
      el_refs,
      energy_stats,
    }),
  )
  // The active numeric mode's title and color scale under the user's ColorBar props; null in
  // the categorical modes or when config.color_bar is null (hidden)
  const color_bar = $derived.by(() => {
    const user_props = opts.config().color_bar
    return color.color_bar && user_props !== null
      ? { ...color.color_bar, ...user_props }
      : null
  })

  const { set, reset } = overrides
  return {
    resolve,
    set,
    reset,
    get changed_keys() {
      return overrides.changed_keys
    },
    get formal_chempots() {
      return resolve(`formal_chempots`)
    },
    get label_stable() {
      return resolve(`label_stable`)
    },
    get element_padding() {
      return resolve(`element_padding`)
    },
    get default_min_limit() {
      return resolve(`default_min_limit`)
    },
    get color_mode() {
      return resolve(`color_mode`)
    },
    get color_scale() {
      return color_scale
    },
    get slice_chempots() {
      return resolve(`slice_chempots`)
    },
    get has_temp_data() {
      return temp_payload.has_temp_data
    },
    get available_temperatures() {
      return temp_payload.available_temperatures
    },
    get diagram_data() {
      return section.data
    },
    get computing() {
      return computing
    },
    get error() {
      return worker_error ?? section.error
    },
    get slice_elements() {
      return slice_elements
    },
    get slices() {
      return slices
    },
    get slice_ranges() {
      return slice_ranges
    },
    get slice_curves() {
      return slice_curves
    },
    get frame_data() {
      return frame_data
    },
    set_slice,
    get energy_stats() {
      return energy_stats
    },
    get domain_colors() {
      return color.colors
    },
    get color_bar() {
      return color_bar
    },
  }
}

// The axis range to show when a computed `next` range replaces the one last `applied`: a range
// the user set in between (it no longer matches what was applied) is kept
export const sticky_range = <Range extends readonly (number | null)[] | undefined>(
  current: Range,
  applied: Range,
  next: Range,
): Range => (current?.[0] === applied?.[0] && current?.[1] === applied?.[1] ? next : current)

// Pointer position relative to `container`, for tooltip placement. The true hotspot,
// not a nudged one: PlotTooltip needs it to flip correctly and to size the gap that
// keeps the pointer glyph clear (its `offset`/`avoid_cursor`).
export const container_pointer = (
  event: MouseEvent,
  container: HTMLElement | undefined,
): Point2D => {
  const rect = container?.getBoundingClientRect()
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
}

// Plain-text formula of a domain label (electronegativity order, no delimiters)
export const domain_formula_text = (formula: string): string =>
  get_electro_neg_formula(formula, { plain_text: true, delim: ``, amount_format: `.3~s` })

// Hovered domain, else the domain key (reduced formula) of the host's formula in any spelling
// (Li2O2 → LiO). Not in compute.ts: parsing pulls element data into the worker bundle.
export const highlight_key_of = (hovered?: string, external?: string | null): string | null =>
  hovered ?? (external ? formula_key_from_composition(parse_formula(external)) : null)

// [value, label] pairs for the color-mode <select> in both panes
export const CHEMPOT_COLOR_MODE_OPTIONS = [
  [`none`, `None`],
  [`energy`, `Energy/atom`],
  [`formation_energy`, `Formation energy`],
  [`arity`, `Element count`],
  [`entries`, `Entry count`],
] as const satisfies readonly (readonly [ChemPotColorMode, string])[]
