<script lang="ts">
  // Table of Miller families with a surface-energy slider and number input each, their share
  // of the Wulff shape, and a row to add a family or remove one. Bind `facets` to a WulffShape's.
  // With `default_facets`, a reset icon in the header restores them once `facets` differ. With
  // `delta_mu_range`, a Δμ slider above sets `delta_mu` and the γ inputs set γ at Δμ = 0.
  import type { Vec2, Vec3 } from '#lib/math.js'
  import MillerIndexInput from '#lib/MillerIndexInput.svelte'
  import Icon from 'svelte-widgets/Icon.svelte'
  import { format_num } from 'svelte-widgets/format'
  import { Close, Reset } from 'svelte-widgets/icons'
  import { family_colors, family_label, format_fraction } from './format'
  import type { WulffFacetInput, WulffShapeData } from './types'

  let {
    facets = $bindable([]),
    wulff_data = null,
    energy_range = [0.1, 5],
    default_facets,
    delta_mu = $bindable(0),
    delta_mu_range,
  }: {
    facets?: WulffFacetInput[]
    // the shape computed from `facets` (WulffShape's bindable output), for the area column.
    // A family equivalent to a listed one is left for compute_wulff_shape to report.
    wulff_data?: WulffShapeData | null
    energy_range?: Vec2 // slider bounds in J/m²
    default_facets?: WulffFacetInput[]
    delta_mu?: number // eV, chemical potential of families with a slope
    delta_mu_range?: Vec2 // Δμ slider bounds in eV, no slider without them
  } = $props()

  const colors = $derived(family_colors(facets))
  let new_miller = $state<Vec3>([1, 1, 0])
  let new_energy = $state(2)

  // a non-positive or empty γ is refused and the input shows the kept value again (to 4 digits)
  const set_energy = (idx: number, input: HTMLInputElement) => {
    const energy = input.valueAsNumber
    if (Number.isFinite(energy) && energy > 0) {
      facets = facets.with(idx, { ...facets[idx], energy })
    } else input.value = String(Number(facets[idx].energy.toPrecision(4)))
  }
  // the typed facet is listed already (an equivalent one is compute_wulff_shape's to report)
  const listed = $derived(
    facets.some(({ miller }) => miller.join(`,`) === new_miller.join(`,`)),
  )
  const can_add = $derived(Number.isFinite(new_energy) && new_energy > 0 && !listed)
</script>

<div class="wulff-facet-editor">
  {#if delta_mu_range}
    <label class="delta-mu">
      Δμ (eV)
      <input
        type="range"
        min={delta_mu_range[0]}
        max={delta_mu_range[1]}
        step="0.01"
        bind:value={delta_mu}
      />
      <span>{format_num(delta_mu, `.2f`)}</span>
    </label>
  {/if}
  <!-- fixed layout: only the slider column flexes, so changing percentages or a
  wider family label never resize the slider under the cursor mid-drag -->
  <table>
    <colgroup>
      <col style="width: 5em" />
      <col />
      <col style="width: 4.8em" />
      <col style="width: 4em" />
      <col style="width: 1.6em" />
    </colgroup>
    <thead>
      <tr>
        <th>Family</th>
        <th colspan="2">{delta_mu_range ? `γ at Δμ = 0` : `γ`} (J/m²)</th>
        <th class="area" title="Share of the shape's surface">Area</th>
        <th>
          {#if default_facets && JSON.stringify(facets) !== JSON.stringify(default_facets)}
            <button
              type="button"
              class="round-icon-btn"
              onclick={() => (facets = $state.snapshot(default_facets))}
              title="Reset surface energies"
            >
              <Icon icon={Reset} />
            </button>
          {/if}
        </th>
      </tr>
    </thead>
    <tbody>
      {#each facets as { miller, energy, slope }, idx (idx)}
        {@const family = wulff_data?.families[idx]}
        <tr class:absent={family?.n_facets === 0}>
          <th scope="row" title={slope ? `dγ/dΔμ = ${slope} J/m² per eV` : undefined}>
            <span class="swatch" style:background={colors[idx]}></span>
            {family_label(miller)}
          </th>
          <td>
            <input
              type="range"
              min={energy_range[0]}
              max={energy_range[1]}
              step="0.001"
              value={energy}
              oninput={(event) => set_energy(idx, event.currentTarget)}
              aria-label="Surface energy of {family_label(miller)}"
            />
          </td>
          <td>
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={Number(energy.toPrecision(4))}
              onchange={(event) => set_energy(idx, event.currentTarget)}
              aria-label="Surface energy of {family_label(miller)} (number)"
            />
          </td>
          <td class="area">{family ? format_fraction(family.area_fraction) : ``}</td>
          <td>
            <button
              type="button"
              class="round-icon-btn"
              disabled={facets.length === 1}
              onclick={() => (facets = facets.toSpliced(idx, 1))}
              title="Remove {family_label(miller)}"
            >
              <Icon icon={Close} />
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <form
    class="add-family"
    onsubmit={(event) => {
      event.preventDefault()
      if (can_add) facets = [...facets, { miller: [...new_miller], energy: new_energy }]
    }}
  >
    <MillerIndexInput bind:value={new_miller} />
    <label
      >γ <input type="number" min="0.001" step="0.001" bind:value={new_energy} /> J/m²</label
    >
    <button
      type="submit"
      disabled={!can_add}
      title={listed ? `Facet (${new_miller.join(` `)}) is already listed` : undefined}
      >Add</button
    >
  </form>
</div>

<style>
  table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
  }
  th,
  td {
    padding: 1px 4px;
    text-align: left;
    white-space: nowrap;
  }
  .area {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  tr.absent {
    opacity: 0.5;
  }
  input[type='range'] {
    width: 100%;
  }
  /* 4 significant digits fit, the stored γ keeps its full precision until edited */
  input[type='number'] {
    width: 3.8em;
    padding-block: 1px;
  }
  /* alone in its cell, which then centers it (inline, it sat on the text baseline) */
  td > input[type='number'] {
    display: block;
  }
  .swatch {
    display: inline-block;
    width: 0.8em;
    height: 0.8em;
    border-radius: 2px;
  }
  .delta-mu {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin-bottom: 0.5em;
    input {
      flex: 1;
    }
    /* fixed-width digits in a fixed box: the slider keeps its length while Δμ changes */
    span {
      min-width: 3em;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  }
  form {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin-top: 0.5em;
  }
</style>
