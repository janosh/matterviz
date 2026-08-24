// Reactive state shared by ChemPotDiagram2D and ChemPotDiagram3D: per-key control overrides,
// the temperature slice of the entries, the worker computation and the domain colouring
import type { PhaseData } from '$lib/convex-hull/types'
import type { Point2D } from '$lib/math'
import { to_error } from '$lib/utils'
import { compute_chempot_async } from './async-compute.svelte'
import { get_domain_color_data } from './color'
import { get_energy_stats_by_formula, get_min_entries_and_el_refs } from './compute'
import { get_temp_filter_payload, get_valid_temperature } from './temperature'
import { CHEMPOT_DEFAULTS, type ChemPotDiagramConfig, type ChemPotDiagramData } from './types'

// Per-key user overrides with `override ?? config ?? default` resolution; `reset()`
// clears all overrides (the panes' "Reset defaults" buttons). Defaults come from
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
    // Every key at its resolved value (a SettingsSection's current_values)
    get values(): { [P in Key]: NonNullable<ChemPotDiagramConfig[P]> } {
      return Object.fromEntries(
        keys.map((key) => [key, overrides[key] ?? config()[key] ?? defaults[key]]),
      ) as { [P in Key]: NonNullable<ChemPotDiagramConfig[P]> }
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
  `reverse_color_scale`,
] as const
export type ChemPotControlKey = (typeof CHEMPOT_CONTROL_KEYS)[number]
export type ChemPotControlValues = {
  [Key in ChemPotControlKey]: NonNullable<ChemPotDiagramConfig[Key]>
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

  const slice = $derived(
    get_temp_filter_payload(opts.entries(), opts.temperature.get(), opts.config()),
  )
  $effect(() => {
    const next = get_valid_temperature(opts.temperature.get(), slice.available_temperatures)
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
  let diagram_data = $state.raw<ChemPotDiagramData | null>(null)
  let computing = $state(false)
  let error = $state<string | null>(null)
  $effect(() => {
    const entries = slice.temp_filtered_entries
    if (entries.length < opts.min_elements) {
      diagram_data = null
      computing = false
      error = null
      return undefined
    }
    let cancelled = false
    computing = true
    compute_chempot_async(entries, compute_config)
      .then((data) => {
        if (cancelled) return
        diagram_data = data.elements.length >= opts.min_elements ? data : null
        error = null
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error(`${opts.label}:`, err)
        diagram_data = null
        error = to_error(err).message
      })
      .finally(() => {
        if (!cancelled) computing = false
      })
    return () => {
      cancelled = true
    }
  })

  // Raw (non-renormalized) elemental references for true DFT formation energies; the
  // formal-chempot pipeline renormalizes its own refs to zero. Memoized apart from the
  // colours so colour toggles don't re-scan the entries.
  const el_refs = $derived(get_min_entries_and_el_refs(slice.temp_filtered_entries).el_refs)
  const energy_stats = $derived(get_energy_stats_by_formula(slice.temp_filtered_entries))
  const color = $derived(
    get_domain_color_data({
      formulas: opts.formulas(),
      color_mode: resolve(`color_mode`),
      color_scale: resolve(`color_scale`),
      reverse_color_scale: resolve(`reverse_color_scale`),
      entries: slice.temp_filtered_entries,
      el_refs,
      energy_stats,
    }),
  )

  const { set, reset } = overrides
  return {
    resolve,
    set,
    reset,
    get values() {
      return overrides.values
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
      return resolve(`color_scale`)
    },
    get reverse_color_scale() {
      return resolve(`reverse_color_scale`)
    },
    get show_tooltip() {
      return opts.config().show_tooltip ?? CHEMPOT_DEFAULTS.show_tooltip
    },
    get tooltip_detail_level() {
      return opts.config().tooltip_detail_level ?? CHEMPOT_DEFAULTS.tooltip_detail_level
    },
    get has_temp_data() {
      return slice.has_temp_data
    },
    get available_temperatures() {
      return slice.available_temperatures
    },
    // Entries evaluated at the current temperature (the computation's input)
    get entries() {
      return slice.temp_filtered_entries
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
    get color_range() {
      return color.color_range
    },
  }
}

// Pointer position relative to `container` (nudged off the cursor) for tooltip placement
export const container_pointer = (
  event: MouseEvent,
  container: HTMLElement | undefined,
): Point2D => {
  const rect = container?.getBoundingClientRect()
  return { x: event.clientX - (rect?.left ?? 0) + 4, y: event.clientY - (rect?.top ?? 0) + 4 }
}

// [value, label] pairs for the color-mode and color-scale <select>s in both panes
export const CHEMPOT_COLOR_MODE_OPTIONS = [
  [`none`, `None`],
  [`energy`, `Energy/atom`],
  [`formation_energy`, `Formation energy`],
  [`arity`, `Element count`],
  [`entries`, `Entry count`],
] as const

export const CHEMPOT_COLOR_SCALE_OPTIONS = [
  [`interpolateViridis`, `Viridis`],
  [`interpolatePlasma`, `Plasma`],
  [`interpolateInferno`, `Inferno`],
  [`interpolateMagma`, `Magma`],
  [`interpolateCividis`, `Cividis`],
  [`interpolateTurbo`, `Turbo`],
  [`interpolateRdYlBu`, `RdYlBu`],
  [`interpolateSpectral`, `Spectral`],
] as const
