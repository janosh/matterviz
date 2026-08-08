<script lang="ts">
  import { SettingsSection } from '$lib'

  let current_values = $state({ radius: 1, diameter: 2, palette: `warm` })
  let generation = $state(0)
  let input_generation = $state(0)
  let row_key = $state<`radius` | `diameter`>(`radius`)
  let descriptions_open = $state(true)
</script>

<button
  type="button"
  data-testid="change-dimensions"
  onclick={() => {
    current_values.radius = 2
    current_values.diameter = 3
  }}
>
  Change dimensions
</button>
<button type="button" data-testid="replace-row" onclick={() => (generation += 1)}>
  Replace row
</button>
<button type="button" data-testid="replace-input" onclick={() => (input_generation += 1)}>
  Replace input
</button>
<button
  type="button"
  data-testid="change-key"
  onclick={() => (row_key = row_key === `radius` ? `diameter` : `radius`)}
>
  Change key
</button>

<SettingsSection
  title="Atoms"
  {current_values}
  on_reset_key={(key, reference_value) => {
    current_values = { ...current_values, [key]: reference_value }
  }}
  setting_metadata={{
    radius: `Radius of rendered atoms`,
    diameter: `Diameter of rendered atoms`,
    palette: `Palette used for rendered atoms`,
  }}
  bind:descriptions_open
  layout="grid"
>
  {#key generation}
    <label data-key={row_key} data-generation={generation}>
      <span>Radius</span>
      {#key input_generation}
        <input type="range" bind:value={current_values.radius} />
      {/key}
    </label>
  {/key}
  <label data-key="palette">
    <span>Palette</span>
    <select bind:value={current_values.palette}>
      <option value="warm">Warm</option>
      <option value="cool">Cool</option>
    </select>
  </label>
</SettingsSection>
