<script lang="ts">
  import type { ScatterPlotOptions, DataSeries } from '#lib/plot/index.js'
  import type { ScatterHandlerProps } from '#lib/plot/core/types.js'
  // Energy–volume scan with one or more fitted equations of state drawn through it. Hovering a
  // fit curve shows its E0, V0, B0, B0' and RMSE, which keeps the legend to one line per series.
  // Fitting happens here, so callers pass raw (volumes, energies) and read the results back
  // through the bindable `fits`.
  import { plot_color } from '#lib/colors/index.js'
  import { EV_PER_A3_TO_GPA } from '#lib/constants.js'
  import ViewerNotices from '#lib/layout/ViewerNotices.svelte'
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import { format_num } from '#lib/labels.js'
  import { array_extent } from '#lib/math.js'
  import { ScatterPlot } from '#lib/plot/index.js'
  import { TooltipValue } from '#lib/tooltip/index.js'
  import { to_error } from 'svelte-widgets/utils'
  import type { EosFit, EosKind } from './fit'
  import { EOS_KIND_LABELS, eos_energy, fit_eos } from './fit'

  let {
    volumes,
    energies,
    kinds = [`birch_murnaghan`],
    fits = $bindable([]),
    show_fit_params = true,
    data_label = `E(V) data`,
    ...rest
  }: {
    volumes: number[]
    energies: number[]
    kinds?: EosKind[]
    fits?: EosFit[] // read-only output: the successful fits, in `kinds` order
    show_fit_params?: boolean // E0, V0, B0, B0', RMSE in a fit curve's hover tooltip
    data_label?: string
  } & ScatterPlotOptions = $props()

  // Fit every requested form; a failed fit (no minimum, diverged) is shown as a dismissible
  // error and leaves the data points on the plot
  const fit_result = $derived.by(() => {
    const valid: EosFit[] = []
    const errors: string[] = []
    for (const kind of new Set(kinds)) {
      try {
        valid.push(fit_eos(volumes, energies, kind))
      } catch (exc) {
        errors.push(to_error(exc).message)
      }
    }
    return { fits: valid, error_msg: errors.join(`; `) || undefined }
  })
  $effect(() => {
    fits = fit_result.fits
  })
  let error_msg = $derived(fit_result.error_msg)

  // 200 points from 5% below the smallest to 5% above the largest volume so the fitted curve
  // visibly extrapolates past the scanned points
  const curve_volumes = $derived.by(() => {
    const [v_min, v_max] = array_extent(volumes)
    const [start, span] = [v_min - 0.05 * (v_max - v_min), 1.1 * (v_max - v_min)]
    return Array.from({ length: 200 }, (_, idx) => start + (span * idx) / 199)
  })

  // Tooltip rows for one fit: label (sub/superscript HTML), formatted value, unit
  const fit_param_rows = (fit: EosFit): [string, string, string?][] => [
    [`E<sub>0</sub>`, format_num(fit.e0, `.4f`), `eV`],
    [`V<sub>0</sub>`, format_num(fit.v0, `.3f`), `Å³`],
    [`B<sub>0</sub>`, format_num(fit.b0 * EV_PER_A3_TO_GPA, `.1f`), `GPa`],
    [`B<sub>0</sub>'`, format_num(fit.b0_prime, `.2f`)],
    [`RMSE`, format_num(fit.rmse * 1e3, `.2f`), `meV`],
  ]

  // ScatterPlot throws on x/y length mismatch, so leave the points out and let the fit error
  // (which names both lengths) explain the empty plot
  const series = $derived.by((): DataSeries[] => {
    const fit_series: DataSeries[] = fit_result.fits.map((fit, idx) => ({
      x: curve_volumes,
      y: curve_volumes.map((vol) => eos_energy(fit.kind, fit, vol)),
      label: `${EOS_KIND_LABELS[fit.kind]} fit`,
      markers: `line`,
      line_style: { stroke: plot_color(idx + 1), stroke_width: 2 },
    }))
    if (volumes.length !== energies.length) return fit_series
    const point_style = { fill: plot_color(0), radius: 4 }
    return [
      { x: volumes, y: energies, label: data_label, markers: `points`, point_style },
      ...fit_series,
    ]
  })

  // The data series (when drawn) comes first, so fit idx = series idx - offset
  const fit_offset = $derived(volumes.length === energies.length ? 1 : 0)
</script>

{#snippet eos_tooltip({
  x_formatted,
  y_formatted,
  label,
  series_idx,
  x_axis,
  y_axis,
}: ScatterHandlerProps)}
  {@const fit = fit_result.fits[series_idx - fit_offset]}
  {#if label}<strong>{label}</strong><br />{/if}
  <TooltipValue label={x_axis.label} value={x_formatted} /><br />
  <TooltipValue label={y_axis.label} value={y_formatted} />
  {#if show_fit_params && fit}
    {#each fit_param_rows(fit) as [param_label, value, unit] (param_label)}
      <br /><TooltipValue label={param_label} {value} {unit} />
    {/each}
  {/if}
{/snippet}

<!-- one positioned root: the error floats over the plot instead of taking a grid cell
     or pushing it down -->
<div style="position: relative; height: 100%">
  <ScatterPlot
    {...rest}
    {series}
    x_axis={{ label: `V (Å³)`, ...rest.x_axis }}
    y_axis={{ label: `E (eV)`, ...rest.y_axis }}
    tooltip={rest.tooltip ?? eos_tooltip}
    style={rest.style ?? `height: 400px;`}
  />
  <ViewerNotices>
    <StatusMessage bind:message={error_msg} type="error" dismissible />
  </ViewerNotices>
</div>
