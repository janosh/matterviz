// Reactive state shared by ChemPotDiagram2D and ChemPotDiagram3D: per-key control overrides,
// the temperature slice of the entries, the worker computation and the domain colouring
import { get_electro_neg_formula } from '#lib/composition/format.js'
import { parse_formula } from '#lib/composition/parse.js'
import { get_valid_temperature } from '#lib/convex-hull/helpers.js'
import type { PhaseData } from '#lib/convex-hull/types.js'
import type { Point2D } from '#lib/math.js'
import { to_color_scale_config } from '#lib/plot/core/scales.js'
import type { ColorScaleConfig } from '#lib/plot/core/types.js'
import { to_error } from '#lib/utils.js'
import { getAbortSignal, untrack } from 'svelte'
import { compute_chempot_async } from './async-compute.svelte'
import { get_domain_color_data } from './color'
import {
  formula_key_from_composition,
  get_energy_stats_by_formula,
  get_min_entries_and_el_refs,
} from './compute'
import { get_temp_filter_payload } from './temperature'
import {
  CHEMPOT_DEFAULTS,
  type ChemPotColorMode,
  type ChemPotDiagramConfig,
  type ChemPotDiagramData,
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
  // The bound temperature; snapped into the data's range once the slice is known
  temperature: { get: () => number | undefined; set: (value: number | undefined) => void }
  // Fewer entries than this skip the computation; a result with fewer axes is dropped
  min_elements: number
  // Axes the computation projects onto (3D projection picker); undefined leaves it to the
  // config and the data
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
  const slice = $derived(
    get_temp_filter_payload(opts.entries(), opts.temperature.get(), {
      interpolate_temperature,
      max_interpolation_gap,
    }),
  )
  $effect(() => {
    const next = get_valid_temperature(
      opts.temperature.get(),
      slice.available_temperatures,
      interpolate_temperature ?? CHEMPOT_DEFAULTS.interpolate_temperature,
    )
    if (next !== opts.temperature.get()) opts.temperature.set(next)
  })

  // Only what compute_chempot_diagram reads, so display toggles (labels, padding, overlays)
  // never re-run the worker; the previous diagram stays on screen while a replacement computes
  const compute_config = $derived<ChemPotDiagramConfig>({
    formal_chempots: resolve(`formal_chempots`),
    default_min_limit: resolve(`default_min_limit`),
    limits: opts.config().limits,
    elements: opts.elements?.() ?? opts.config().elements,
  })
  // A recreated but equal config must not recompute
  const compute_key = $derived(JSON.stringify(compute_config))
  let diagram_data = $state.raw<ChemPotDiagramData | null>(null)
  let computing = $state(false)
  let error = $state<string | null>(null)
  $effect(() => {
    const entries = slice.temp_filtered_entries
    void compute_key
    const config = untrack(() => compute_config)
    if (entries.length < opts.min_elements) {
      diagram_data = null
      computing = false
      error = null
      return
    }
    const signal = getAbortSignal()
    computing = true
    compute_chempot_async(entries, config, { signal })
      .then((data) => {
        if (signal.aborted) return
        diagram_data = data.elements.length >= opts.min_elements ? data : null
        error = null
      })
      .catch((err: unknown) => {
        if (signal.aborted) return
        console.error(`${opts.label}:`, err)
        diagram_data = null
        error = to_error(err).message
      })
      .finally(() => {
        if (!signal.aborted) computing = false
      })
  })
  $effect(() => () => compute_chempot_async.release())

  // Raw (non-renormalized) elemental references for true formation energies; the
  // formal-chempot pipeline renormalizes its own refs to zero. Memoized apart from the
  // colours so colour toggles don't re-scan the entries.
  const el_refs = $derived(get_min_entries_and_el_refs(slice.temp_filtered_entries).el_refs)
  const energy_stats = $derived(get_energy_stats_by_formula(slice.temp_filtered_entries))
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
      entries: slice.temp_filtered_entries,
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
    get has_temp_data() {
      return slice.has_temp_data
    },
    get available_temperatures() {
      return slice.available_temperatures
    },
    get diagram_data() {
      return diagram_data
    },
    get computing() {
      return computing
    },
    get error() {
      return error
    },
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
