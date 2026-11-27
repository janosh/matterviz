<script lang="ts">
  // Pourbaix conditions and display toggles, for the plot's controls pane or standalone
  import { subscript_digits, superscript_digits } from '#lib/labels'
  import { format_num } from 'svelte-widgets/format'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    log_conc = $bindable(),
    temperature = $bindable(),
    show_water_lines = $bindable(),
    show_labels = $bindable(),
    heatmap_formula = $bindable(),
    composition = $bindable(null),
    formulas,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    // log a spans 10^-10..1 and T 0..100 °C, the liquid-water range of the RT-only T model
    log_conc: number
    temperature: number
    show_water_lines: boolean
    show_labels: boolean
    heatmap_formula: string | null
    // amounts of the elements besides H and O (null for equal parts), a slider for two
    composition?: Record<string, number> | null
    formulas: string[] // species offered for the heatmap
  } = $props()

  // elements besides H and O in order of first appearance, as compute_pourbaix_diagram has them
  const elements = $derived(
    [...new Set(formulas.flatMap((formula) => formula.match(/[A-Z][a-z]?/g) ?? []))].filter(
      (el) => el !== `H` && el !== `O`,
    ),
  )
  const [first, second] = $derived(elements)
  const fraction = $derived(
    composition ? composition[first] / (composition[first] + composition[second]) : 0.5,
  )

  // <option> holds plain text only: Fe2O3 → Fe₂O₃, Fe^3+ → Fe³⁺
  const unicode_formula = (formula: string): string => {
    const [neutral, charge = ``] = formula.split(`^`)
    return subscript_digits(neutral) + superscript_digits(charge)
  }
</script>

<div class="pourbaix-controls" {...rest}>
  <label>
    <span>log<sub>10</sub> a<sub>ion</sub></span>
    <input type="range" min="-10" max="0" step="0.5" bind:value={log_conc} />
    <output>{format_num(log_conc, `.1f`)}</output>
  </label>
  <label>
    T
    <input type="range" min="273.15" max="373.15" step="1" bind:value={temperature} />
    <output>{format_num(temperature, `.0f`)} K</output>
  </label>
  {#if elements.length === 2}
    <label>
      <span>x<sub>{first}</sub></span>
      <input
        type="range"
        min="0.05"
        max="0.95"
        step="0.05"
        bind:value={
          () => fraction, (val) => (composition = { [first]: val, [second]: 1 - val })
        }
      />
      <output>{format_num(fraction, `.2f`)}</output>
    </label>
  {/if}
  <label><input type="checkbox" bind:checked={show_water_lines} /> Water lines</label>
  <label><input type="checkbox" bind:checked={show_labels} /> Labels</label>
  <label>
    Stability heatmap
    <select bind:value={heatmap_formula}>
      <option value={null}>None</option>
      {#each formulas as formula (formula)}
        <option value={formula}>{unicode_formula(formula)}</option>
      {/each}
    </select>
  </label>
</div>

<style>
  .pourbaix-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6pt 1.5em;
    font-size: 0.9em;
  }
  label {
    display: flex;
    align-items: center;
    gap: 4pt;
  }
  output {
    min-width: 4em;
    font-variant-numeric: tabular-nums;
  }
</style>
