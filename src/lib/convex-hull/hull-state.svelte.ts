// Shared reactive data pipeline (runes-in-closure factory) for ConvexHull2D/3D/4D.
import { DEFAULTS } from '$lib/settings'
import * as helpers from './helpers'
import * as thermo from './thermodynamics'
import type {
  EntryCategoryConfig,
  GasSpecies,
  GasThermodynamicsConfig,
  PhaseData,
} from './types'

const DIM_TO_KIND = { 2: `binary`, 3: `ternary`, 4: `quaternary` } as const

export interface HullDataPipelineInputs<Entry extends PhaseData> {
  dim: 2 | 3 | 4 // diagram arity (static)
  // Reactive getters
  entries: () => PhaseData[]
  temperature: () => number | undefined
  interpolate_temperature: () => boolean
  max_interpolation_gap: () => number
  gas_config: () => GasThermodynamicsConfig | undefined
  gas_pressures: () => Partial<Record<GasSpecies, number>>
  energy_source_mode: () => `precomputed` | `on-the-fly`
  // Dimension-specific coordinate entries enriched with e_above_hull (pre-threshold)
  all_enriched_entries: () => Entry[]
  max_hull_dist_show_phases: () => number
  show_stable: () => boolean
  show_unstable: () => boolean
  // Categorical classification (marker shapes + filter toggles), null to disable
  entry_category: () => EntryCategoryConfig | null
  // Category values whose entries are hidden from the plot (view predicate)
  hidden_categories: () => readonly string[]
  // Which entries pass the e_above_hull threshold (predicate differs per dimension)
  keep_plot_entry: (entry: Entry, max_hull_dist: number) => boolean
  // Setters for bindable props written by pipeline effects
  set_temperature: (temperature: number) => void
  set_max_hull_dist_show_phases: (value: number) => void
  set_stable_entries: (value: Entry[]) => void
  set_unstable_entries: (value: Entry[]) => void
}

export function create_hull_data_pipeline<Entry extends PhaseData>(
  inputs: HullDataPipelineInputs<Entry>,
) {
  const kind = DIM_TO_KIND[inputs.dim]
  const default_threshold = DEFAULTS.convex_hull[kind].max_hull_dist_show_phases

  // Temperature-dependent free energy support
  const temp_analysis = $derived(helpers.analyze_temperature_data(inputs.entries()))

  // Initialize or reset temperature when it's undefined or no longer valid
  $effect(() => {
    const temperature = inputs.temperature()
    const { has_temp_data, available_temperatures } = temp_analysis
    if (
      has_temp_data &&
      available_temperatures.length > 0 &&
      (temperature === undefined || !available_temperatures.includes(temperature))
    )
      inputs.set_temperature(available_temperatures[0])
  })

  // Filter entries by temperature when in temperature mode
  const temp_filtered_entries = $derived.by(() => {
    const temperature = inputs.temperature()
    return temp_analysis.has_temp_data && temperature !== undefined
      ? helpers.filter_entries_at_temperature(inputs.entries(), temperature, {
          interpolate: inputs.interpolate_temperature(),
          max_interpolation_gap: inputs.max_interpolation_gap(),
        })
      : inputs.entries()
  })

  // Gas-dependent chemical potential support (corrections based on T, P)
  // defaults to DEFAULT_GAS_TEMP (room temp) when no temperature
  const gas_result = $derived(
    helpers.get_gas_corrected_entries(
      temp_filtered_entries,
      inputs.gas_config(),
      inputs.gas_pressures(),
      inputs.temperature() ?? helpers.DEFAULT_GAS_TEMP,
    ),
  )

  // Compute energy mode information
  const energy_info = $derived(
    helpers.compute_energy_mode_info(
      gas_result.entries,
      thermo.find_lowest_energy_unary_refs,
      inputs.energy_source_mode(),
    ),
  )

  // Assign category marker shapes (no-op when entries lack category data)
  const effective_entries = $derived(
    helpers.apply_category_markers(
      helpers.get_effective_entries(
        gas_result.entries,
        energy_info.energy_mode,
        energy_info.unary_refs,
        thermo.compute_e_form_per_atom,
      ),
      inputs.entry_category(),
    ),
  )

  // Process convex hull data with unified PhaseData interface using effective entries
  const pd_data = $derived(thermo.process_hull_entries(effective_entries))

  // Pre-compute polymorph stats once for O(1) tooltip lookups
  const polymorph_stats_map = $derived(helpers.compute_all_polymorph_stats(effective_entries))

  const elements = $derived.by(() => {
    if (pd_data.elements.length > inputs.dim) {
      console.error(
        `ConvexHull${inputs.dim}D: Dataset contains ${pd_data.elements.length} elements, but ${kind} diagrams require exactly ${inputs.dim}. Found: [${pd_data.elements.join(
          `, `,
        )}]`,
      )
      return []
    }
    return pd_data.elements
  })

  // Auto threshold: show all for few entries, use default for many, interpolate between
  const max_hull_dist_in_data = $derived(
    helpers.calc_max_hull_dist_in_data(inputs.all_enriched_entries()),
  )
  const auto_default_threshold = $derived(
    helpers.compute_auto_hull_dist_threshold(
      inputs.all_enriched_entries().length,
      max_hull_dist_in_data,
      default_threshold,
    ),
  )

  const next_auto_threshold = helpers.auto_threshold_reset(default_threshold)
  $effect(() => {
    const current = inputs.max_hull_dist_show_phases()
    // Key the reset on the enriched (post-processing) entries, not raw entries(), so the
    // auto threshold re-derives when temperature/gas/energy-mode change the hull. The
    // user_changed guard inside auto_threshold_reset still preserves manual adjustments.
    inputs.set_max_hull_dist_show_phases(
      next_auto_threshold(inputs.all_enriched_entries(), current, auto_default_threshold) ??
        current,
    )
  })

  // Filter by threshold; visibility is a view predicate, not entry state.
  const plot_entries = $derived(
    inputs
      .all_enriched_entries()
      .filter((entry) => inputs.keep_plot_entry(entry, inputs.max_hull_dist_show_phases())),
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

  // Update bindable stable/unstable entry arrays when plot_entries change
  $effect(() => {
    const is_stable = (entry: Entry) => helpers.entry_is_stable(entry)
    inputs.set_stable_entries(plot_entries.filter(is_stable))
    inputs.set_unstable_entries(plot_entries.filter((entry) => !is_stable(entry)))
  })

  return {
    get has_temp_data() {
      return temp_analysis.has_temp_data
    },
    get available_temperatures() {
      return temp_analysis.available_temperatures
    },
    get gas_analysis() {
      return gas_result.analysis
    },
    get merged_gas_config() {
      return gas_result.merged_config
    },
    get has_precomputed_e_form() {
      return energy_info.has_precomputed_e_form
    },
    get has_precomputed_hull() {
      return energy_info.has_precomputed_hull
    },
    get can_compute_e_form() {
      return energy_info.can_compute_e_form
    },
    get can_compute_hull() {
      return energy_info.can_compute_hull
    },
    get energy_mode() {
      return energy_info.energy_mode
    },
    get effective_entries() {
      return effective_entries
    },
    get pd_data() {
      return pd_data
    },
    get polymorph_stats_map() {
      return polymorph_stats_map
    },
    get elements() {
      return elements
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
