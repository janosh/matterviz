<script lang="ts">
  // Free energy, internal energy, entropy and heat capacity vs temperature from a phonon DOS.
  // Energies (F, U) on the left axis, S and C_v on the right one since they differ by a factor
  // of ~T. Defaults to phonopy's kJ/mol and J/(K·mol) so plots compare directly.
  import { plot_color } from '$lib/colors'
  import { EV_TO_KJ_PER_MOL } from '$lib/constants'
  import { StatusMessage } from '$lib/feedback'
  import type { DataSeries } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import { to_error } from '$lib/utils'
  import type { ComponentProps } from 'svelte'
  import type { FrequencyUnit } from './frequency-units'
  import type { ThermalProperties } from './thermal'
  import { thermal_properties } from './thermal'
  import type { PhononDos } from './types'

  // all four quantities are always plotted; the legend toggles hide individual ones
  const QUANTITIES = [
    { key: `free_energy`, label: `Free energy F`, axis: `y1` },
    { key: `internal_energy`, label: `Internal energy U`, axis: `y1` },
    { key: `entropy`, label: `Entropy S`, axis: `y2` },
    { key: `heat_capacity`, label: `Heat capacity C<sub>v</sub>`, axis: `y2` },
  ] as const

  let {
    dos,
    temperatures = Array.from({ length: 101 }, (_, idx) => 10 * idx),
    units = `THz`,
    energy_unit = `kJ/mol`,
    thermal = $bindable(),
    x_axis = {},
    y_axis = {},
    y2_axis = {},
    ...rest
  }: {
    dos: PhononDos
    temperatures?: number[] // K
    units?: FrequencyUnit // of dos.frequencies, named as in Dos.svelte
    energy_unit?: `eV` | `kJ/mol` // eV and meV/K, or kJ/mol and J/(K·mol); named as in NebPlot
    thermal?: ThermalProperties | null // read-only output, always in eV and eV/K; null on error
  } & Omit<ComponentProps<typeof ScatterPlot>, `series`> = $props()

  // Invalid input (mismatched DOS arrays, negative temperatures, no positive frequencies) is
  // shown as a dismissible error over an empty plot rather than taking the component down
  const result = $derived.by(() => {
    try {
      return { computed: thermal_properties(dos, temperatures, units), error_msg: undefined }
    } catch (exc) {
      return { computed: null, error_msg: to_error(exc).message }
    }
  })
  $effect(() => {
    thermal = result.computed
  })
  let error_msg = $derived(result.error_msg)

  // scale factors from eV and eV/K to the displayed units, per axis
  const axis_units = $derived(
    energy_unit === `kJ/mol`
      ? {
          y1: { scale: EV_TO_KJ_PER_MOL, label: `kJ/mol` },
          y2: { scale: EV_TO_KJ_PER_MOL * 1000, label: `J/(K·mol)` },
        }
      : { y1: { scale: 1, label: `eV` }, y2: { scale: 1000, label: `meV/K` } },
  )

  const series = $derived.by((): DataSeries[] => {
    const { computed } = result
    if (!computed) return []
    return QUANTITIES.map(({ key, label, axis }, idx) => ({
      x: computed.temperatures,
      y: computed[key].map((val) => val * axis_units[axis].scale),
      label,
      unit: axis_units[axis].label,
      y_axis: axis,
      markers: `line`,
      line_style: { stroke: plot_color(idx), stroke_width: 2 },
    }))
  })
</script>

<StatusMessage bind:message={error_msg} type="error" dismissible />

<ScatterPlot
  {...rest}
  {series}
  x_axis={{ label: `T (K)`, ...x_axis }}
  y_axis={{ label: `F, U (${axis_units.y1.label})`, ...y_axis }}
  y2_axis={{ label: `S, C<sub>v</sub> (${axis_units.y2.label})`, ...y2_axis }}
  style={rest.style ?? `height: 400px;`}
/>
