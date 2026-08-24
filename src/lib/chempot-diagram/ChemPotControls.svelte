<script lang="ts">
  // The control rows ChemPotDiagram2D and ChemPotDiagram3D both offer: formal/absolute
  // potentials, labels, axis padding and floor, region colouring. `children` renders extra
  // checkboxes next to the built-in ones (the 3D overlay toggles).
  import type { D3InterpolateName } from '$lib/colors'
  import type { Snippet } from 'svelte'
  import {
    CHEMPOT_COLOR_MODE_OPTIONS,
    CHEMPOT_COLOR_SCALE_OPTIONS,
    type ChemPotControlKey,
    type ChemPotControlValues,
  } from './controls-state.svelte'
  import type { ChemPotColorMode } from './types'

  let {
    values,
    set,
    children,
  }: {
    values: ChemPotControlValues
    set: <Key extends ChemPotControlKey>(key: Key, value: ChemPotControlValues[Key]) => void
    children?: Snippet
  } = $props()

  // Partial input (``, `-`) parses to NaN; leave the value alone until the number is complete
  const set_number = (key: `element_padding` | `default_min_limit`, event: Event) => {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber
    if (Number.isFinite(value)) set(key, value)
  }
</script>

<div class="chempot-checks">
  <label>
    <input
      type="checkbox"
      checked={values.formal_chempots}
      onchange={() => set(`formal_chempots`, !values.formal_chempots)}
    /> Formal chempots
  </label>
  <label>
    <input
      type="checkbox"
      checked={values.label_stable}
      onchange={() => set(`label_stable`, !values.label_stable)}
    /> Label stable
  </label>
  {@render children?.()}
</div>
<div class="chempot-nums">
  <label>
    Padding (eV)
    <input
      type="number"
      min="0"
      step="0.1"
      value={values.element_padding}
      oninput={(event) => set_number(`element_padding`, event)}
    />
  </label>
  <label>
    Min limit (eV)
    <input
      type="number"
      max="0"
      step="1"
      value={values.default_min_limit}
      oninput={(event) => set_number(`default_min_limit`, event)}
    />
  </label>
</div>
<label class="pane-row">
  <span>Color mode:</span>
  <select
    value={values.color_mode}
    onchange={(event) => set(`color_mode`, event.currentTarget.value as ChemPotColorMode)}
  >
    {#each CHEMPOT_COLOR_MODE_OPTIONS as [value, label] (value)}
      <option {value}>{label}</option>
    {/each}
  </select>
</label>
{#if values.color_mode !== `none` && values.color_mode !== `arity`}
  <label class="pane-row">
    <span>Color scale:</span>
    <select
      value={values.color_scale}
      onchange={(event) => set(`color_scale`, event.currentTarget.value as D3InterpolateName)}
    >
      {#each CHEMPOT_COLOR_SCALE_OPTIONS as [value, label] (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
    <span class="reverse-scale-toggle">
      <span>Reverse:</span>
      <input
        type="checkbox"
        checked={values.reverse_color_scale}
        onchange={() => set(`reverse_color_scale`, !values.reverse_color_scale)}
      />
    </span>
  </label>
{/if}

<style>
  .chempot-checks,
  .chempot-nums {
    display: flex;
    flex-wrap: wrap;
    gap: 1ex;
  }
  .chempot-nums {
    margin: 4pt 0;
    input {
      width: 5em;
    }
  }
  label,
  .reverse-scale-toggle {
    display: flex;
    align-items: center;
    gap: 4pt;
    font-size: 0.9em;
  }
  .pane-row select {
    flex: 1;
    min-width: 0;
    padding: 2px 4px;
  }
</style>
