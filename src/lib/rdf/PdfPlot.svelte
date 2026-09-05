<script lang="ts">
  import { plot_color } from '$lib/colors'
  import { get_electro_neg_formula } from '$lib/composition'
  import { StatusMessage } from 'svelte-widgets'
  import { format_num } from '$lib/labels'
  import type { DataSeries, RefLine } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import type { RadiationType } from '$lib/scattering'
  import type { Crystal, Pbc } from '$lib/structure'
  import { strip_html, to_error } from '$lib/utils'
  import type { ComponentProps } from 'svelte'
  import {
    calculate_total_pdf,
    label_structures,
    PDF_DEFAULT_CUTOFF,
    PDF_DEFAULT_N_BINS,
    rdf_baseline,
  } from './index'
  import type { PdfPattern, TotalPdfPattern } from './index'

  const RADIATIONS = [
    [`xray`, `X-ray`],
    [`neutron`, `Neutron`],
    [`electron`, `Electron`],
  ] as const

  let {
    structures,
    quantity = $bindable(`reduced_g_r`),
    radiation = $bindable(`xray`),
    cutoff = $bindable(PDF_DEFAULT_CUTOFF),
    n_bins = $bindable(PDF_DEFAULT_N_BINS),
    show_partials = $bindable(false),
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    pbc,
    error_msg = $bindable(),
    x_axis = {},
    y_axis = {},
    ...rest
  }: {
    structures?: Crystal | Crystal[] | Record<string, Crystal>
    // g(r) is the scattering-weighted total pair distribution function, reduced_g_r is
    // G(r) = 4*pi*r*rho_0*(g(r) - 1), the form PDF refinement codes plot
    quantity?: `g_r` | `reduced_g_r`
    radiation?: RadiationType
    cutoff?: number
    n_bins?: number
    show_partials?: boolean
    show_controls?: boolean
    pbc?: Pbc
    error_msg?: string
  } & ComponentProps<typeof ScatterPlot> = $props()

  const struct_list = $derived(
    label_structures(structures).map(({ struct, label }) => ({
      struct,
      label: label || get_electro_neg_formula(struct),
    })),
  )

  // Recomputed whenever radiation/cutoff/n_bins change. A missing scattering length or a
  // null-matrix composition throws out of $lib/scattering; surface it instead of blanking the
  // plot. The failure rides back with the results because writing to state — or to a prop —
  // from inside a $derived is state_unsafe_mutation, a hard error in Svelte 5.
  const computed = $derived.by(() => {
    const totals: { label: string; total: TotalPdfPattern }[] = []
    let failure: string | undefined
    for (const { struct, label } of struct_list) {
      try {
        totals.push({
          label,
          total: calculate_total_pdf(struct, { radiation, cutoff, n_bins, pbc }),
        })
      } catch (exc) {
        failure = to_error(exc).message
      }
    }
    return { totals, failure }
  })
  // ...so the hop from derived value to bindable prop happens here, which is what $effect is for
  $effect(() => {
    error_msg = computed.failure
  })

  const ref_lines = $derived<RefLine[]>([rdf_baseline(quantity), ...(rest.ref_lines ?? [])])

  const series = $derived<DataSeries[]>(
    computed.totals.flatMap(({ label, total }, struct_idx) => {
      const curves: [string, PdfPattern][] = [
        [label, total],
        ...(show_partials ? total.partials : []).map((partial): [string, PdfPattern] => [
          `${label} ${partial.element_pair?.join(`-`) ?? `partial`}`,
          partial,
        ]),
      ]
      return curves.map(([curve_label, pattern], curve_idx) => ({
        x: pattern.r,
        y: pattern[quantity],
        label: curve_label,
        legend_group: label,
        markers: `line` as const,
        line_style: {
          stroke: plot_color(struct_idx * 7 + curve_idx),
          stroke_width: curve_idx === 0 ? 2 : 1,
        },
      }))
    }),
  )

  // get_electro_neg_formula returns <sub>-tagged markup, which the legend renders but a plain
  // text caption would show verbatim. strip_html rather than {@html}, since dictionary keys
  // passed as structure labels are caller-supplied strings.
  const weight_summary = $derived(
    computed.totals
      .map(({ label, total }) =>
        [
          `${strip_html(label)} ⟨b⟩ = ${format_num(total.mean_scattering_length, `.4~f`)}`,
          ...Object.entries(total.pair_weights).map(
            ([pair, weight]) => `w(${pair}) = ${format_num(weight, `.4~f`)}`,
          ),
        ].join(`, `),
      )
      .join(` | `),
  )
</script>

<StatusMessage bind:message={error_msg} type="error" dismissible />

{#if show_controls}
  <div class="pdf-controls">
    {#each [[`g_r`, `g(r)`], [`reduced_g_r`, `G(r)`]] as const as [key, label] (key)}
      <button class:active={quantity === key} onclick={() => (quantity = key)}>{label}</button>
    {/each}
    <span class="separator">|</span>
    {#each RADIATIONS as [key, label] (key)}
      <button class:active={radiation === key} onclick={() => (radiation = key)}
        >{label}</button
      >
    {/each}
    <span class="separator">|</span>
    <label>
      Cutoff: <input type="range" min="5" max="40" step="1" bind:value={cutoff} />
      {format_num(cutoff, `.0~f`)} Å
    </label>
    <label>
      Bins: <input type="range" min="100" max="3000" step="100" bind:value={n_bins} />
      {n_bins} ({format_num(cutoff / n_bins, `.3~f`)} Å)
    </label>
    <label>
      <input type="checkbox" bind:checked={show_partials} /> Partials
    </label>
  </div>
{/if}

<!-- gated on struct_list, not series: with structures supplied but failing, the error above is
the whole story and claiming there was nothing to plot would contradict it -->
{#if struct_list.length === 0}
  <StatusMessage message="No structures to compute a PDF for" style="border: none" />
{:else if series.length > 0}
  <ScatterPlot
    {...rest}
    bind:show_controls
    bind:controls_open
    {series}
    {ref_lines}
    x_axis={{ label: `r (Å)`, range: [0, cutoff], ...x_axis }}
    y_axis={{ label: quantity === `reduced_g_r` ? `G(r) (Å⁻²)` : `g(r)`, ...y_axis }}
    styles={{ show_lines: true, show_points: false }}
    style={rest.style ?? `height: 450px;`}
  />
  {#if weight_summary}
    <p class="weights">{weight_summary}</p>
  {/if}
{/if}

<style>
  .pdf-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    place-content: center;
    margin: 0 0 1ex;
  }
  button {
    padding: 2px 10px;
    border: 1px solid var(--border-color, #999);
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    &:hover,
    &.active {
      border-color: var(--accent-color, #4e79a7);
    }
    &.active {
      border-width: 2px;
    }
  }
  .separator {
    color: var(--border-color, #ccc);
    user-select: none;
  }
  .weights {
    margin: 0.5ex 0 0;
    font-size: 0.75em;
    text-align: center;
    opacity: 0.7;
  }
</style>
