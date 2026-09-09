// Shared reactive data pipeline (runes-in-closure factory) for ConvexHull2D/3D/4D:
// temperature → gas corrections → formation energies → plot coordinates → lower hull →
// energy above hull → thresholds/visibility. Components only render.
import { DEFAULTS } from '$lib/settings'
import { to_error } from '$lib/utils'
import { analyze_gas_data, apply_gas_corrections } from './gas-thermodynamics'
import * as helpers from './helpers'
import * as thermo from './thermodynamics'
import {
  apply_formation_energies,
  build_hull_model,
  compute_energy_mode_info,
  type EnergySourceMode,
} from './model'
import type {
  EntryCategoryConfig,
  GasAnalysis,
  GasSpecies,
  GasThermodynamicsConfig,
  PhaseData,
} from './types'
import { DEFAULT_GAS_TEMP } from './types'

const DIM_TO_KIND = { 2: `binary`, 3: `ternary`, 4: `quaternary` } as const
// Capitalised kind for user-facing text (error messages, aria labels)
export const KIND_LABEL = {
  binary: `Binary`,
  ternary: `Ternary`,
  quaternary: `Quaternary`,
} as const satisfies Record<(typeof DIM_TO_KIND)[keyof typeof DIM_TO_KIND], string>

interface HullDataPipelineInputs {
  dim: 2 | 3 | 4 // diagram arity (static)
  // Reactive getters
  entries: () => PhaseData[]
  temperature: () => number | undefined
  interpolate_temperature: () => boolean
  max_interpolation_gap: () => number
  gas_config: () => GasThermodynamicsConfig | undefined
  gas_pressures: () => Partial<Record<GasSpecies, number>>
  energy_source_mode: () => EnergySourceMode
  // Pseudo-component keys (e.g. precursor formulas) in place of element symbols
  components?: () => readonly string[] | undefined
  max_hull_dist_show_phases: () => number
  show_stable: () => boolean
  show_unstable: () => boolean
  // Categorical classification (marker shapes + filter toggles), null to disable
  entry_category: () => EntryCategoryConfig | null
  // Category values whose entries are hidden from the plot (view predicate)
  hidden_categories: () => readonly string[]
  label_threshold: () => number // datasets larger than this start with labels hidden
  // Setters for bindable props written by pipeline effects
  set_temperature: (temperature: number) => void
  set_max_hull_dist_show_phases: (value: number) => void
  hide_labels: () => void
}

// Merge gas_pressures into gas_config.pressures and apply chemical-potential corrections when
// the system contains gas-derived elements; otherwise entries pass through untouched.
function get_gas_corrected_entries(
  entries: PhaseData[],
  gas_config: GasThermodynamicsConfig | undefined,
  gas_pressures: Partial<Record<string, number>>,
  temperature: number,
): { entries: PhaseData[]; analysis: GasAnalysis; merged_config?: GasThermodynamicsConfig } {
  if (!gas_config?.enabled_gases?.length) {
    const analysis = {
      has_gas_dependent_elements: false,
      gas_elements: [],
      relevant_gases: [],
    }
    return { entries, analysis }
  }
  const merged_config = {
    ...gas_config,
    pressures: { ...gas_config.pressures, ...gas_pressures },
  }
  const analysis = analyze_gas_data(entries, merged_config)
  if (!analysis.has_gas_dependent_elements) return { entries, analysis, merged_config }
  return {
    entries: apply_gas_corrections(entries, merged_config, temperature),
    analysis,
    merged_config,
  }
}

export function create_hull_data_pipeline(inputs: HullDataPipelineInputs) {
  const { dim } = inputs
  const kind = DIM_TO_KIND[dim]
  const default_threshold = DEFAULTS.convex_hull[kind].max_hull_dist_show_phases

  // Composition keys are normalized once here ("Fe3+" → Fe) so every later stage, including
  // the unary-reference lookup, sees plain element symbols. Unrecognized keys ("Fe2O3") come
  // straight from the entries prop, so the throw is caught and surfaced through `error`
  // instead of propagating out of a $derived mid-render.
  const normalized_source = $derived.by(() => {
    try {
      return {
        ...thermo.process_hull_entries(inputs.entries(), inputs.components?.()),
        error: null,
      }
    } catch (err) {
      return { entries: [], elements: [], error: to_error(err).message }
    }
  })
  const source_entries = $derived(normalized_source.entries)

  // Temperature-dependent free energy support
  const temp_analysis = $derived(helpers.analyze_temperature_data(source_entries))

  // Initialize or reset temperature when it's undefined or no longer valid
  $effect(() => {
    const temperature = inputs.temperature()
    const { has_temp_data, available_temperatures } = temp_analysis
    if (
      has_temp_data &&
      (temperature === undefined ||
        !(inputs.interpolate_temperature()
          ? temperature >= available_temperatures[0] &&
            temperature <= available_temperatures[available_temperatures.length - 1]
          : available_temperatures.includes(temperature)))
    )
      inputs.set_temperature(available_temperatures[0])
  })

  const temp_filtered_entries = $derived.by(() => {
    const temperature = inputs.temperature()
    return temp_analysis.has_temp_data && temperature !== undefined
      ? helpers.filter_entries_at_temperature(source_entries, temperature, {
          interpolate: inputs.interpolate_temperature(),
          max_interpolation_gap: inputs.max_interpolation_gap(),
        })
      : source_entries
  })

  // Gas-dependent chemical potential corrections (T, P); room temperature without T data
  const gas_result = $derived(
    get_gas_corrected_entries(
      temp_filtered_entries,
      inputs.gas_config(),
      inputs.gas_pressures(),
      inputs.temperature() ?? DEFAULT_GAS_TEMP,
    ),
  )

  const energy_info = $derived(
    compute_energy_mode_info(
      gas_result.entries,
      inputs.energy_source_mode(),
      temp_analysis.has_temp_data || gas_result.entries !== temp_filtered_entries,
    ),
  )

  // Formation energies depend only on thermodynamic inputs, never marker styling.
  const effective_entries = $derived(apply_formation_energies(gas_result.entries, energy_info))

  // Pre-compute polymorph stats once for O(1) tooltip lookups
  const polymorph_stats_map = $derived(helpers.compute_all_polymorph_stats(effective_entries))

  // Elements of the entries PROP, before the temperature filter (and gas corrections, which
  // never touch compositions). A selected temperature outside one element's `temperatures`
  // may drop every entry of that element; the diagram then keeps its arity and closes the
  // hull with a synthetic corner (below) instead of unmounting together with the temperature
  // slider the user would need to recover.
  const elements = $derived(normalized_source.elements)

  // Why the entries prop can't be plotted: a rejected composition key, or a dataset whose
  // element count doesn't match the diagram's arity. Empty entries (data still loading) are
  // not an error. Components render this message in place of the plot.
  const error = $derived.by((): string | null => {
    if (normalized_source.error) return normalized_source.error
    if (elements.length === 0 || elements.length === dim) return null
    return `${KIND_LABEL[kind]} convex hull requires exactly ${dim} elements, found ${elements.length}: ${elements.join(`, `)}`
  })

  const model = $derived(
    build_hull_model(effective_entries, elements, dim, energy_info.energy_mode),
  )
  const all_enriched_entries = $derived(model.entries)
  const hull = $derived({
    entries: model.entries.filter((entry) => !entry.exclude_from_hull),
    facet_entries: model.facets.map((facet) =>
      facet.vertex_indices.map((idx) => model.entries[idx]),
    ),
  })

  // Auto threshold: show all for few entries, use default for many, interpolate between
  const max_hull_dist_in_data = $derived(
    helpers.calc_max_hull_dist_in_data(all_enriched_entries),
  )
  const auto_default_threshold = $derived(
    helpers.compute_auto_hull_dist_threshold(
      all_enriched_entries.length,
      max_hull_dist_in_data,
      default_threshold,
    ),
  )

  const next_auto_threshold = helpers.auto_threshold_reset(default_threshold)
  $effect(() => {
    const current = inputs.max_hull_dist_show_phases()
    // Keyed on the enriched entries, not raw entries(), so the auto threshold re-derives when
    // temperature/gas/energy-mode change the hull; the user_changed guard inside
    // auto_threshold_reset still preserves manual adjustments.
    inputs.set_max_hull_dist_show_phases(
      next_auto_threshold(all_enriched_entries, current, auto_default_threshold) ?? current,
    )
  })

  // Large datasets start with labels hidden. Applied once per dataset (keyed on the entries
  // prop) so later entry-count changes from temperature/gas filtering don't clobber toggles.
  let label_defaults_applied_for: PhaseData[] | null = null
  $effect(() => {
    if (label_defaults_applied_for === inputs.entries()) return
    label_defaults_applied_for = inputs.entries()
    if (effective_entries.length > inputs.label_threshold()) inputs.hide_labels()
  })

  // Filter by threshold; visibility is a view predicate, not entry state.
  const plot_entries = $derived(
    helpers.apply_category_markers(
      all_enriched_entries.filter((entry) =>
        helpers.entry_within_hull_dist(entry, inputs.max_hull_dist_show_phases()),
      ),
      inputs.entry_category(),
    ),
  )
  const visible_entries = $derived(
    helpers.visible_entries(
      plot_entries,
      inputs.show_stable(),
      inputs.show_unstable(),
      inputs.entry_category(),
      inputs.hidden_categories(),
    ),
  )

  const stable_entries = $derived(plot_entries.filter(helpers.entry_is_stable))
  const unstable_entries = $derived(
    plot_entries.filter((entry) => !helpers.entry_is_stable(entry)),
  )
  const phase_stats = $derived(
    plot_entries.length === model.entries.length
      ? model.phase_stats
      : thermo.get_convex_hull_stats(plot_entries, elements, dim),
  )

  return {
    get model() {
      return model
    },
    get stable_entries() {
      return stable_entries
    },
    get unstable_entries() {
      return unstable_entries
    },
    get phase_stats() {
      return phase_stats
    },
    get error() {
      return error
    },
    get has_temp_data() {
      return temp_analysis.has_temp_data
    },
    get available_temperatures() {
      return temp_analysis.available_temperatures
    },
    get interpolate_temperature() {
      return inputs.interpolate_temperature()
    },
    get gas_analysis() {
      return gas_result.analysis
    },
    get merged_gas_config() {
      return gas_result.merged_config
    },
    get energy_info() {
      return energy_info
    },
    get polymorph_stats_map() {
      return polymorph_stats_map
    },
    get elements() {
      return elements
    },
    get hull() {
      return hull
    },
    get all_enriched_entries() {
      return all_enriched_entries
    },
    get max_hull_dist_in_data() {
      return max_hull_dist_in_data
    },
    get auto_default_threshold() {
      return auto_default_threshold
    },
    get plot_entries() {
      return plot_entries
    },
    get visible_entries() {
      return visible_entries
    },
  }
}
