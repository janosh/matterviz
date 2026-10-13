<script lang="ts">
  import type { ScatterPlotOptions, DataSeries } from '#lib/plot/index.js'
  // Energy–volume scan with one or more fitted equations of state drawn through it and the
  // fitted E0, V0, B0, B0' listed under each fit's legend entry, so ScatterPlot's legend
  // placement keeps them clear of the data and the corner controls. Fitting happens here, so
  // callers pass raw (volumes, energies) and read the results back through the bindable `fits`.
  import { plot_color } from '#lib/colors/index.js'
  import { EV_PER_A3_TO_GPA } from '#lib/constants.js'
  import ViewerError from '#lib/layout/ViewerError.svelte'
  import { format_num } from '#lib/labels.js'
  import { array_extent } from '#lib/math.js'
  import { ScatterPlot } from '#lib/plot/index.js'
  import { to_error } from '#lib/utils.js'
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

  // Fit name plus (unless disabled) its parameters as extra lines of the legend label
  const fit_label = (fit: EosFit): string => {
    const name = `${EOS_KIND_LABELS[fit.kind]} fit`
    if (!show_fit_params) return name
    const params = [
      `E<sub>0</sub> = ${format_num(fit.e0, `.4f`)} eV`,
      `V<sub>0</sub> = ${format_num(fit.v0, `.3f`)} Å³`,
      `B<sub>0</sub> = ${format_num(fit.b0 * EV_PER_A3_TO_GPA, `.1f`)} GPa`,
      `B<sub>0</sub>' = ${format_num(fit.b0_prime, `.2f`)}`,
      `RMSE = ${format_num(fit.rmse * 1e3, `.2f`)} meV`,
    ]
    return `${name}<br><small>${params.join(`<br>`)}</small>`
  }

  // ScatterPlot throws on x/y length mismatch, so leave the points out and let the fit error
  // (which names both lengths) explain the empty plot
  const series = $derived.by((): DataSeries[] => {
    const fit_series: DataSeries[] = fit_result.fits.map((fit, idx) => ({
      x: curve_volumes,
      y: curve_volumes.map((vol) => eos_energy(fit.kind, fit, vol)),
      label: fit_label(fit),
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

  // Fits side by side (a column each) with compact lines and the swatch level with the fit
  // name rather than centered on its params block; legend={null} still hides it
  const legend = $derived(
    rest.legend === null
      ? null
      : {
          layout: `horizontal` as const,
          layout_tracks: `auto` as const,
          item_style: `align-items: flex-start; line-height: 1.3;`,
          ...rest.legend,
        },
  )
</script>

<!-- one positioned root: the error floats over the plot instead of taking a grid cell
     or pushing it down -->
<div style="position: relative; height: 100%">
  <ScatterPlot
    {...rest}
    {series}
    x_axis={{ label: `V (Å³)`, ...rest.x_axis }}
    y_axis={{ label: `E (eV)`, ...rest.y_axis }}
    {legend}
    style={rest.style ?? `height: 400px;`}
  />
  <ViewerError bind:message={error_msg} dismissible placement="top" />
</div>
