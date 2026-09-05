<script lang="ts">
  // Energy–volume scan with one or more fitted equations of state drawn through it and the
  // fitted E0, V0, B0, B0' shown in a corner. Fitting happens here, so callers pass raw
  // (volumes, energies) and read the results back through the bindable `fits`.
  import { plot_color } from '$lib/colors'
  import { EV_PER_A3_TO_GPA } from '$lib/constants'
  import { StatusMessage } from 'svelte-widgets'
  import { format_num } from '$lib/labels'
  import type { DataSeries } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import { to_error } from '$lib/utils'
  import type { ComponentProps } from 'svelte'
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
    show_fit_params?: boolean
    data_label?: string
  } & Omit<ComponentProps<typeof ScatterPlot>, `series` | `children`> = $props()

  // Fit every requested form; a failed fit (no minimum, diverged) is shown as a dismissible
  // error and leaves the data points on the plot
  const fit_result = $derived.by(() => {
    const ok: EosFit[] = []
    const errors: string[] = []
    for (const kind of new Set(kinds)) {
      try {
        ok.push(fit_eos(volumes, energies, kind))
      } catch (exc) {
        errors.push(to_error(exc).message)
      }
    }
    return { fits: ok, error_msg: errors.join(`; `) || undefined }
  })
  $effect(() => {
    fits = fit_result.fits
  })
  let error_msg = $derived(fit_result.error_msg)

  // 200 points from 5% below the smallest to 5% above the largest volume so the fitted curve
  // visibly extrapolates past the scanned points
  const curve_volumes = $derived.by(() => {
    const [v_min, v_max] = [Math.min(...volumes), Math.max(...volumes)]
    const [start, span] = [v_min - 0.05 * (v_max - v_min), 1.1 * (v_max - v_min)]
    return Array.from({ length: 200 }, (_, idx) => start + (span * idx) / 199)
  })

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
</script>

<StatusMessage bind:message={error_msg} type="error" dismissible />

<ScatterPlot
  {...rest}
  {series}
  x_axis={{ label: `V (Å³)`, ...rest.x_axis }}
  y_axis={{ label: `E (eV)`, ...rest.y_axis }}
  show_legend={rest.show_legend ?? !(show_fit_params && fit_result.fits.length > 0)}
  style={rest.style ?? `height: 400px;`}
>
  <!-- the params box doubles as the legend (names in series colours) so the two never overlap -->
  {#if show_fit_params && fit_result.fits.length > 0}
    <div class="eos-fit-params">
      <strong style:color={plot_color(0)}>● {data_label}</strong>
      {#each fit_result.fits as fit, idx (fit.kind)}
        <div style:color={plot_color(idx + 1)}>
          <strong>— {EOS_KIND_LABELS[fit.kind]} fit</strong>
          <span>E<sub>0</sub> = {format_num(fit.e0, `.4f`)} eV</span>
          <span>V<sub>0</sub> = {format_num(fit.v0, `.3f`)} Å³</span>
          <span>B<sub>0</sub> = {format_num(fit.b0 * EV_PER_A3_TO_GPA, `.1f`)} GPa</span>
          <span>B<sub>0</sub>' = {format_num(fit.b0_prime, `.2f`)}</span>
          <span>RMSE = {format_num(fit.rmse * 1e3, `.2f`)} meV</span>
        </div>
      {/each}
    </div>
  {/if}
</ScatterPlot>

<style>
  .eos-fit-params {
    position: absolute;
    top: 1ex;
    right: 1em;
    display: flex;
    flex-direction: column;
    gap: 1ex;
    padding: 0.5em 0.8em;
    font-size: 0.85em;
    font-family: monospace;
    background: var(--surface-bg, rgba(128, 128, 128, 0.1));
    border-radius: var(--border-radius, 3pt);
    pointer-events: none;
    div {
      display: flex;
      flex-direction: column;
    }
  }
</style>
