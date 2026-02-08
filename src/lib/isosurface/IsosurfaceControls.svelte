<script lang="ts">
  // Controls panel for isosurface visualization settings (isovalue, opacity, colors, etc.)
  import { format_num } from '$lib/labels'
  import { SettingsSection } from '$lib/layout'
  import type { IsosurfaceSettings, VolumetricData } from './types'
  import { DEFAULT_ISOSURFACE_SETTINGS } from './types'

  let {
    settings = $bindable({ ...DEFAULT_ISOSURFACE_SETTINGS }),
    volumes = [],
    active_volume_idx = $bindable(0),
  }: {
    settings?: IsosurfaceSettings
    volumes?: VolumetricData[]
    active_volume_idx?: number
  } = $props()

  // Use precomputed data_range from the active volume
  let data_range = $derived(
    volumes[active_volume_idx]?.data_range ?? { min: 0, max: 1, abs_max: 1, mean: 0 },
  )

  // Reasonable step size based on data range
  let step = $derived(data_range.abs_max > 0 ? data_range.abs_max / 200 : 0.001)
</script>

<SettingsSection
  title="Isosurface"
  current_values={{
    isovalue: settings.isovalue,
    opacity: settings.opacity,
    show_negative: settings.show_negative,
    wireframe: settings.wireframe,
  }}
  on_reset={() => {
    settings = { ...DEFAULT_ISOSURFACE_SETTINGS }
  }}
>
  {#if volumes.length > 1}
    <label>
      <span>Volume:</span>
      <select bind:value={active_volume_idx}>
        {#each volumes as vol, idx (idx)}
          <option value={idx}>{vol.label ?? `Volume ${idx + 1}`}</option>
        {/each}
      </select>
    </label>
  {/if}

  <label>
    <span>Isovalue:</span>
    <input
      type="range"
      min={step}
      max={data_range.abs_max}
      {step}
      bind:value={settings.isovalue}
    />
    <span class="value">{format_num(settings.isovalue, `.4~g`)}</span>
  </label>

  <label>
    <span>Opacity:</span>
    <input type="range" min={0.1} max={1} step={0.05} bind:value={settings.opacity} />
    <span class="value">{format_num(settings.opacity, `.2f`)}</span>
  </label>

  <label>
    <span>+ Color:</span>
    <input type="color" bind:value={settings.positive_color} />
  </label>

  <label>
    <span>Show &minus; lobe:</span>
    <input type="checkbox" bind:checked={settings.show_negative} />
  </label>

  {#if settings.show_negative}
    <label>
      <span>&minus; Color:</span>
      <input type="color" bind:value={settings.negative_color} />
    </label>
  {/if}

  <label>
    <span>Wireframe:</span>
    <input type="checkbox" bind:checked={settings.wireframe} />
  </label>

  {#if volumes[active_volume_idx]}
    <div class="grid-info">
      Grid: {volumes[active_volume_idx].grid_dims.join(` × `)}
      &nbsp;|&nbsp; Range: [{format_num(data_range.min, `.3~g`)}, {
        format_num(data_range.max, `.3~g`)
      }]
    </div>
  {/if}
</SettingsSection>

<style>
  .grid-info {
    font-size: 0.75em;
    opacity: 0.7;
    padding: 2px 0;
  }
</style>
