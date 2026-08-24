<script lang="ts">
  // Frequency-unit selector shared by the Bands, Dos and IrRamanSpectrum control panes. The
  // bound `units` may arrive in a spelling found in the wild (`cm-1`, `cm⁻¹`); the select
  // shows the canonical unit and writes the canonical spelling back.
  import {
    FREQUENCY_UNITS,
    type FrequencyUnit,
    frequency_unit_label,
    parse_frequency_unit,
  } from './frequency-units'

  let { units = $bindable(), id }: { units: FrequencyUnit; id: string } = $props()
  const unit = $derived(parse_frequency_unit(units) ?? units)
</script>

<label>
  <span>Frequency</span>
  <select
    {id}
    value={unit}
    onchange={(event) => (units = parse_frequency_unit(event.currentTarget.value) ?? unit)}
  >
    {#each FREQUENCY_UNITS as option (option)}
      <option value={option}>{frequency_unit_label(option)}</option>
    {/each}
  </select>
</label>
