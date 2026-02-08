<script lang="ts">
  // Controls panel for isosurface visualization settings (isovalue, opacity, colors, etc.)
  // Supports both single-isovalue mode and multi-layer mode.
  import { format_num } from '$lib/labels'
  import { SettingsSection } from '$lib/layout'
  import type { IsosurfaceLayer, IsosurfaceSettings, VolumetricData } from './types'
  import { DEFAULT_ISOSURFACE_SETTINGS, generate_layers } from './types'

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

  let step = $derived(data_range.abs_max > 0 ? data_range.abs_max / 200 : 0.001)
  let is_multi_layer = $derived((settings.layers?.length ?? 0) > 0)
  let n_layers = $derived(settings.layers?.length ?? 1)

  function set_layer_count(count: number) {
    if (count <= 1) {
      // Switch back to single-layer mode
      settings.layers = undefined
    } else {
      settings.layers = generate_layers(data_range, count)
    }
  }

  function update_layer(idx: number, updates: Partial<IsosurfaceLayer>) {
    if (!settings.layers) return
    settings.layers = settings.layers.map((layer, layer_idx) =>
      layer_idx === idx ? { ...layer, ...updates } : layer
    )
  }
</script>

<SettingsSection
  title="Isosurface"
  current_values={{
    isovalue: settings.isovalue,
    opacity: settings.opacity,
    show_negative: settings.show_negative,
    wireframe: settings.wireframe,
    layers: n_layers,
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

  <!-- Layer count selector -->
  <label>
    <span>Layers:</span>
    <select
      value={n_layers}
      onchange={(event) =>
      set_layer_count(Number((event.target as HTMLSelectElement).value))}
    >
      {#each [1, 2, 3, 4, 5] as count (count)}
        <option value={count}>{count}</option>
      {/each}
    </select>
  </label>

  {#if is_multi_layer && settings.layers}
    <!-- Multi-layer controls -->
    {#each settings.layers as layer, idx (idx)}
      <div class="layer-row">
        <input
          type="checkbox"
          checked={layer.visible}
          onchange={() => update_layer(idx, { visible: !layer.visible })}
        />
        <input
          type="color"
          value={layer.color}
          onchange={(event) =>
          update_layer(idx, { color: (event.target as HTMLInputElement).value })}
        />
        <input
          type="range"
          min={step}
          max={data_range.abs_max}
          {step}
          value={layer.isovalue}
          oninput={(event) =>
          update_layer(idx, {
            isovalue: Number((event.target as HTMLInputElement).value),
          })}
          style="flex: 1; min-width: 60px"
        />
        <span class="layer-value">{format_num(layer.isovalue, `.3~g`)}</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={layer.opacity}
          oninput={(event) =>
          update_layer(idx, {
            opacity: Number((event.target as HTMLInputElement).value),
          })}
          style="width: 50px"
          title="Opacity: {format_num(layer.opacity, `.2f`)}"
        />
      </div>
    {/each}
  {:else}
    <!-- Single-layer controls (backward compatible) -->
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
  {/if}

  <label>
    <span>Show &minus; lobe:</span>
    <input
      type="checkbox"
      checked={is_multi_layer
      ? settings.layers?.some((layer) => layer.show_negative) ?? false
      : settings.show_negative}
      onchange={(event) => {
        const checked = (event.target as HTMLInputElement).checked
        settings.show_negative = checked
        // In multi-layer mode, propagate to all layers
        if (settings.layers) {
          settings.layers = settings.layers.map((layer) => ({
            ...layer,
            show_negative: checked,
          }))
        }
      }}
    />
  </label>

  {#if settings.show_negative && !is_multi_layer}
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
  .layer-row {
    display: flex;
    align-items: center;
    gap: 0.3em;
    font-size: 0.85em;
    input[type='color'] {
      width: 24px;
      height: 20px;
      padding: 0;
      border: 1px solid var(--border-color, #ccc);
      border-radius: 3px;
      box-sizing: border-box;
      cursor: pointer;
    }
    input[type='checkbox'] {
      margin: 0;
    }
  }
  .layer-value {
    font-family: monospace;
    font-size: 0.85em;
    min-width: 3.5em;
    text-align: right;
  }
</style>
