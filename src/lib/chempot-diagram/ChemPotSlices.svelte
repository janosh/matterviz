<script module lang="ts">
  export { slice_label }
</script>

<script lang="ts">
  // Controls for the data elements beyond the display axes: each is shadow-projected or
  // fixed at a chemical potential, set by slider, number or a click on the plot of every
  // domain's section measure against that potential (where each phase appears, peaks, ends).
  import { format_num } from '#lib/labels.js'
  import type { Vec2 } from '#lib/math.js'
  import { clamp } from '#lib/math.js'
  import type { DataSeries } from '#lib/plot/index.js'
  import { ScatterPlot } from '#lib/plot/index.js'
  import { domain_formula_text } from './controls-state.svelte'

  let {
    elements,
    slices,
    ranges,
    curves,
    set_slice,
    measure_label,
    formal_chempots,
    colors,
    formulas = [],
  }: {
    elements: string[]
    slices: Record<string, number>
    ranges: Record<string, Vec2>
    // Per sliced element, [mu, measure] curves keyed by domain; null when undefined
    curves: Record<string, Map<string, Vec2[]> | null>
    set_slice: (element: string, value: number | undefined) => void
    measure_label: string
    formal_chempots: boolean // label axes Δμ (relative to the elemental references)
    colors: (formula: string) => string | undefined
    // Domains to plot; empty plots all
    formulas?: string[]
  } = $props()

  const curve_series = (curve_map: Map<string, Vec2[]>): DataSeries[] =>
    [...curve_map]
      .filter(([formula]) => formulas.length === 0 || formulas.includes(formula))
      .map(([formula, curve]) => ({
        x: curve.map(([mu]) => mu),
        y: curve.map(([, measure]) => measure),
        markers: `line`,
        label: domain_formula_text(formula),
        line_style: {
          stroke: colors(formula) ?? `currentColor`,
          stroke_width: 1.5,
          curve: `linear`,
        },
      }))
  const mu = $derived(formal_chempots ? `Δμ` : `μ`)
  const commit = (element: string, value: number): void => {
    const [lower, upper] = ranges[element]
    if (Number.isFinite(value)) set_slice(element, clamp(value, lower, upper))
  }
</script>

<!-- "Δμ_S = -3 eV, ..." caption of the active slices, overlaid on a diagram -->
{#snippet slice_label(slices: Record<string, number>, formal_chempots: boolean)}
  {#if Object.keys(slices).length > 0}
    <p class="slice-label">
      {#each Object.entries(slices) as [element, value], idx (element)}
        {idx > 0 ? `, ` : ``}{formal_chempots ? `Δ` : ``}μ<sub>{element}</sub> = {format_num(
          value,
          `.3~f`,
        )} eV
      {/each}
    </p>
  {/if}
{/snippet}

{#each elements as element (element)}
  {@const value = slices[element]}
  {@const [lower, upper] = ranges[element]}
  {@const curve_map = curves[element]}
  <section class="chempot-slice">
    <label>
      <input
        type="checkbox"
        checked={value !== undefined}
        onchange={() => set_slice(element, value === undefined ? upper : undefined)}
      />
      Slice at fixed {mu}<sub>{element}</sub>
      {#if value === undefined}<small>(projected)</small>{/if}
    </label>
    {#if value !== undefined}
      <label>
        <input
          type="range"
          min={lower}
          max={upper}
          step={(upper - lower) / 500 || 0.01}
          {value}
          oninput={(event) => commit(element, event.currentTarget.valueAsNumber)}
          aria-label="Chemical potential of {element} (eV)"
        />
        <input
          type="number"
          min={lower}
          max={upper}
          step="0.01"
          value={Number(value.toFixed(3))}
          onchange={(event) => {
            commit(element, event.currentTarget.valueAsNumber)
            // Svelte skips rewriting an unchanged value: re-sync rejected or clamped-to-same text
            event.currentTarget.value = String(Number(value.toFixed(3)))
          }}
          aria-label="Chemical potential of {element} (eV), exact"
        />
        eV
      </label>
      <small>range {format_num(lower, `.3~f`)} to {format_num(upper, `.3~f`)} eV</small>
      {#if curve_map && curve_map.size > 0}
        <ScatterPlot
          series={curve_series(curve_map)}
          x_axis={{ label: `${mu}<sub>${element}</sub> (eV)`, range: [lower, upper] }}
          y_axis={{ label: measure_label, range: [0, null] }}
          ref_lines={[{ type: `vertical`, x: value, style: { dash: `4 3` } }]}
          on_plot_click={({ x }) => commit(element, x)}
          style="height: 200px"
        />
      {/if}
    {/if}
  </section>
{/each}

<style>
  /* centered on top, clear of the 2D y-axis ticks and the 3D toolbar */
  .slice-label {
    position: absolute;
    top: 1ex;
    left: 50%;
    translate: -50%;
    padding: 0 4pt;
    background: var(--page-bg, Canvas);
    margin: 0;
    font-size: 0.9em;
    pointer-events: none;
  }
  .chempot-slice {
    display: grid;
    gap: 4pt;
    min-width: 18em;
    label {
      display: flex;
      align-items: center;
      gap: 4pt;
    }
    input[type='range'] {
      flex: 1;
    }
    input[type='number'] {
      width: 5.5em;
    }
    small {
      opacity: 0.7;
    }
  }
</style>
