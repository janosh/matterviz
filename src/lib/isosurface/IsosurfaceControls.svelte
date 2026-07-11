<script lang="ts">
  // Controls panel for isosurface visualization settings (isovalue, opacity, colors, etc.)
  // Single-isovalue mode preserves the classic UI; explicit-layers mode groups
  // surfaces under their geometry-source volume and exposes cross-volume scalar
  // coloring (color source, colormap, value range) per surface.
  import type { D3InterpolateName } from '$lib/colors'
  import { format_num } from '$lib/labels'
  import { SettingsSection } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import { ColorBar } from '$lib/plot'
  import { tooltip } from 'svelte-multiselect/attachments'
  import { auto_color_config, DEFAULT_ISO_COLORMAP, ISO_COLORMAPS } from './coloring'
  import type { DisplayRange } from './sampling'
  import { compare_volume_grids } from './sampling'
  import type { IsosurfaceLayer, IsosurfaceSettings, VolumetricData } from './types'
  import {
    auto_volume_layer,
    DEFAULT_ISOSURFACE_SETTINGS,
    generate_layers,
    materialize_layers,
    remove_volume,
  } from './types'

  let {
    settings = $bindable({ ...DEFAULT_ISOSURFACE_SETTINGS }),
    volumes = $bindable([]),
    active_volume_idx = $bindable(0),
  }: {
    settings?: IsosurfaceSettings
    volumes?: VolumetricData[]
    active_volume_idx?: number
  } = $props()

  // Clamp active_volume_idx when volumes list changes (e.g. dataset swap)
  $effect(() => {
    if (volumes.length > 0 && active_volume_idx >= volumes.length) {
      active_volume_idx = 0
    }
  })

  // Use precomputed data_range from the active volume
  let data_range = $derived(
    volumes[active_volume_idx]?.data_range ?? { min: 0, max: 1, abs_max: 1, mean: 0 },
  )

  let slider_max = $derived(Math.max(data_range.abs_max, 0.001))
  let step = $derived(slider_max / 200)
  // Explicit layers mode is active whenever layers is set — an empty array means
  // "zero surfaces" (all removed), NOT a fallback to implicit single-surface mode
  let is_multi_layer = $derived(settings.layers != null)
  let n_layers = $derived(settings.layers?.length ?? 1)

  const vol_label = (idx: number): string => volumes[idx]?.label ?? `Volume ${idx + 1}`

  // Resolve a layer's geometry volume the same way for grouping, warnings, and
  // data ranges (out-of-range indices clamp so stale layers stay editable/removable)
  const resolve_geo_idx = (layer: IsosurfaceLayer): number =>
    Math.min(Math.max(layer.volume_idx ?? active_volume_idx, 0), volumes.length - 1)

  // The layer's scalar-color-source volume, if any
  const color_vol_of = (layer: IsosurfaceLayer): VolumetricData | undefined =>
    layer.color_volume_idx != null ? volumes[layer.color_volume_idx] : undefined

  function set_layer_count(count: number) {
    if (count <= 1) {
      settings.layers = undefined
    } else {
      settings.layers = generate_layers(data_range, count)
    }
  }

  function update_layer(idx: number, updates: Partial<IsosurfaceLayer>) {
    if (!settings.layers) return
    settings.layers = settings.layers.map((layer, layer_idx) =>
      layer_idx === idx ? { ...layer, ...updates } : layer,
    )
  }

  function remove_layer(idx: number) {
    if (!settings.layers) return
    settings.layers = settings.layers.filter((_layer, layer_idx) => layer_idx !== idx)
  }

  function add_surface(vol_idx: number) {
    const vol = volumes[vol_idx]
    if (!vol) return
    const layers = materialize_layers(settings, active_volume_idx)
    layers.push(auto_volume_layer(vol, vol_idx, layers.length))
    settings.layers = layers
    active_volume_idx = vol_idx
  }

  function handle_remove_volume(vol_idx: number) {
    const layers = materialize_layers(settings, active_volume_idx)
    const result = remove_volume(volumes, layers, vol_idx, active_volume_idx)
    volumes = result.volumes
    settings.layers = result.layers
    // Keep the active volume pointing at the same physical volume (indices shift)
    if (active_volume_idx > vol_idx) active_volume_idx -= 1
    if (active_volume_idx >= result.volumes.length) active_volume_idx = 0
  }

  // Set (or clear) a layer's scalar-color source. The colormap is auto-picked
  // from the color volume's data; color_range stays unset so the renderer fits
  // it to the scalar values actually present on the surface.
  function set_color_source(layer_idx: number, color_idx: number | null) {
    if (color_idx === null) {
      update_layer(layer_idx, {
        color_volume_idx: undefined,
        colormap: undefined,
        color_range: undefined,
      })
      return
    }
    const color_vol = volumes[color_idx]
    if (!color_vol) return
    update_layer(layer_idx, {
      color_volume_idx: color_idx,
      colormap: auto_color_config(color_vol.data_range).colormap,
      color_range: undefined,
    })
  }

  // Picking a color source in single-isovalue mode materializes explicit layers
  function set_single_color_source(color_idx: number | null) {
    if (color_idx === null) return
    settings.layers = materialize_layers(settings, active_volume_idx)
    set_color_source(0, color_idx)
  }

  // Update one bound of a layer's color range. An empty input resets the whole
  // range to auto-fit (renderer fits it to the values sampled on the surface).
  // Typing into an auto range seeds the other bound from the color volume's
  // full data range as a starting point.
  function update_color_range(layer_idx: number, bound: 0 | 1, raw_value: string) {
    const layer = settings.layers?.[layer_idx]
    if (!layer) return
    if (raw_value.trim() === ``) {
      update_layer(layer_idx, { color_range: undefined })
      return
    }
    const value = Number(raw_value)
    if (Number.isNaN(value)) return
    const color_vol = color_vol_of(layer)
    const current: Vec2 =
      layer.color_range ??
      (color_vol ? auto_color_config(color_vol.data_range).color_range : [0, 1])
    const next: Vec2 = bound === 0 ? [value, current[1]] : [current[0], value]
    update_layer(layer_idx, { color_range: next })
  }

  // Grid-compatibility note for a surface/color volume pair. Strictly matching
  // grids sample exactly; otherwise values are resampled in shared coordinates.
  function compat_warning(layer: IsosurfaceLayer): string | null {
    const geo_vol = volumes[resolve_geo_idx(layer)]
    const color_vol = color_vol_of(layer)
    if (!geo_vol || !color_vol || geo_vol === color_vol) return null
    const compat = compare_volume_grids(geo_vol, color_vol)
    return compat.ok ? null : (compat.reason ?? `grids differ`)
  }

  // Layers grouped by geometry-source volume for the tree-style multi-layer UI
  let grouped_layers = $derived.by(() => {
    const groups = volumes.map((_vol, vol_idx) => ({
      vol_idx,
      entries: [] as { layer: IsosurfaceLayer; layer_idx: number }[],
    }))
    for (const [layer_idx, layer] of (settings.layers ?? []).entries()) {
      const vol_idx = resolve_geo_idx(layer)
      if (vol_idx >= 0) groups[vol_idx].entries.push({ layer, layer_idx })
    }
    return groups
  })

  // Halo pads geometry volumes only, so gate on volumes that actually render
  // surfaces (color-source-only volumes don't count)
  let any_periodic = $derived.by(() => {
    if (settings.layers) {
      return settings.layers.some((layer) => volumes[resolve_geo_idx(layer)]?.periodic)
    }
    return volumes[active_volume_idx]?.periodic ?? false
  })

  // Update one bound of the fractional display range. Clearing an input resets
  // that bound to its default (0 or 1); a fully default range unsets display_range
  // so surfaces follow the structure's integer supercell again.
  function update_display_range(axis: number, bound: 0 | 1, raw_value: string) {
    const range = (settings.display_range?.map((pair) => [...pair]) ?? [
      [0, 1],
      [0, 1],
      [0, 1],
    ]) as DisplayRange
    const value = raw_value.trim() === `` ? bound : Number(raw_value)
    if (Number.isNaN(value)) return
    range[axis][bound] = value
    const is_default = range.every(([lo, hi]) => lo === 0 && hi === 1)
    settings.display_range = is_default ? undefined : range
  }

  const colormap_name = (name: string): string => name.replace(/^interpolate/, ``)
</script>

{#snippet color_source_select(
  selected: number,
  on_pick: (idx: number | null) => void,
  tip: string,
)}
  <label {@attach tooltip({ content: tip })}>
    <span>Color by:</span>
    <select
      value={selected}
      onchange={(event) => {
        const idx = Number(event.currentTarget.value)
        on_pick(idx < 0 ? null : idx)
      }}
    >
      <option value={-1}>None (solid)</option>
      {#each volumes as _color_vol, color_idx (color_idx)}
        <option value={color_idx}>{vol_label(color_idx)}</option>
      {/each}
    </select>
  </label>
{/snippet}

{#snippet range_bound_input(layer_idx: number, bound: 0 | 1, explicit_range?: Vec2)}
  <input
    type="number"
    class="range-input"
    step="any"
    placeholder="auto"
    value={explicit_range ? Number(explicit_range[bound].toPrecision(4)) : ``}
    onchange={(event) => update_color_range(layer_idx, bound, event.currentTarget.value)}
    {@attach tooltip({
      content: `Value mapped to the colormap ${
        bound === 0 ? `start` : `end`
      } (empty = auto-fit to surface values)`,
    })}
  />
{/snippet}

<SettingsSection
  title="Isosurface"
  current_values={{
    isovalue: settings.isovalue,
    opacity: settings.opacity,
    show_negative: settings.show_negative,
    wireframe: settings.wireframe,
    halo: settings.halo,
    layers: n_layers,
    display_range: settings.display_range?.flat().join(`,`) ?? ``,
  }}
  on_reset={() => {
    settings = { ...DEFAULT_ISOSURFACE_SETTINGS }
  }}
>
  <!-- Top row: volume selector (single-layer multi-volume) + layer count + toggles -->
  <div class="pane-row compact-row">
    {#if !is_multi_layer && volumes.length > 1}
      <label
        {@attach tooltip({
          content: `Select which volume to display (e.g. charge vs magnetization)`,
        })}
      >
        <span>Volume:</span>
        <select bind:value={active_volume_idx}>
          {#each volumes as _vol, idx (idx)}
            <option value={idx}>{vol_label(idx)}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#if !is_multi_layer}
      <label
        {@attach tooltip({
          content: `Number of isosurface shells at different density thresholds`,
        })}
      >
        <span>Layers:</span>
        <select
          value={n_layers}
          onchange={(event) => set_layer_count(Number(event.currentTarget.value))}
        >
          {#each [1, 2, 3, 4, 5] as count (count)}
            <option value={count}>{count}</option>
          {/each}
        </select>
      </label>
    {/if}
    <!-- Sync both settings.show_negative (single-layer fallback) and all layer entries
    so the toggle works consistently regardless of which mode is active -->
    <label
      {@attach tooltip({
        content: `Show negative lobe at −isovalue (for orbitals, ESP, magnetization)`,
      })}
    >
      <span>Neg. lobe</span>
      <input
        type="checkbox"
        checked={is_multi_layer
          ? (settings.layers?.some((layer) => layer.show_negative) ?? false)
          : settings.show_negative}
        onchange={(event) => {
          const checked = event.currentTarget.checked
          settings.show_negative = checked
          if (settings.layers) {
            settings.layers = settings.layers.map((layer) => ({
              ...layer,
              show_negative: checked,
            }))
          }
        }}
      />
    </label>
    <label {@attach tooltip({ content: `Render as wireframe mesh instead of solid surface` })}>
      <span>Wireframe</span>
      <input type="checkbox" bind:checked={settings.wireframe} />
    </label>
  </div>

  {#if is_multi_layer && settings.layers}
    <!-- Multi-layer mode: surfaces grouped under their geometry-source volume -->
    {#each grouped_layers as { vol_idx, entries } (vol_idx)}
      {@const vol = volumes[vol_idx]}
      <div class="volume-group">
        <div class="volume-header">
          <span class="volume-label" title={vol_label(vol_idx)}>{vol_label(vol_idx)}</span>
          <span class="volume-dims">{vol.grid_dims.join(`×`)}</span>
          {#if entries.length === 0}
            <span
              class="volume-note"
              {@attach tooltip({
                content: `No surfaces — this volume is still available as a color source for other surfaces`,
              })}>color source only</span
            >
          {/if}
          <button
            type="button"
            class="icon-btn"
            onclick={() => add_surface(vol_idx)}
            aria-label="Add surface for {vol_label(vol_idx)}"
            {@attach tooltip({ content: `Add an isosurface from this volume` })}>+</button
          >
          {#if volumes.length > 1}
            <button
              type="button"
              class="icon-btn"
              onclick={() => handle_remove_volume(vol_idx)}
              aria-label="Remove volume {vol_label(vol_idx)}"
              {@attach tooltip({ content: `Remove this volume and its surfaces` })}>×</button
            >
          {/if}
        </div>

        {#each entries as { layer, layer_idx } (layer_idx)}
          {@const layer_abs_max = Math.max(vol.data_range.abs_max, 0.001)}
          {@const layer_step = layer_abs_max / 200}
          {@const warning = compat_warning(layer)}
          <div class="layer-row">
            <input
              type="checkbox"
              checked={layer.visible}
              onchange={() => update_layer(layer_idx, { visible: !layer.visible })}
              {@attach tooltip({ content: `Toggle surface visibility` })}
            />
            <input
              type="color"
              value={layer.color}
              onchange={(event) =>
                update_layer(layer_idx, { color: event.currentTarget.value })}
              {@attach tooltip({
                content:
                  layer.color_volume_idx != null
                    ? `Fallback color (surface uses colormap)`
                    : `Surface color`,
              })}
            />
            <input
              type="range"
              min={layer_step}
              max={layer_abs_max}
              step={layer_step}
              value={layer.isovalue}
              oninput={(event) =>
                update_layer(layer_idx, { isovalue: Number(event.currentTarget.value) })}
              style="flex: 1; min-width: 50px"
            />
            <span class="layer-value">{format_num(layer.isovalue, `.3~g`)}</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={layer.opacity}
              oninput={(event) =>
                update_layer(layer_idx, { opacity: Number(event.currentTarget.value) })}
              style="width: 40px"
              title="Opacity: {format_num(layer.opacity, `.2f`)}"
            />
            <button
              type="button"
              class="icon-btn"
              onclick={() => remove_layer(layer_idx)}
              aria-label="Remove surface"
              {@attach tooltip({ content: `Remove this surface` })}>×</button
            >
          </div>
          <div class="color-row">
            {@render color_source_select(
              layer.color_volume_idx ?? -1,
              (idx) => set_color_source(layer_idx, idx),
              `Color surface by another volume's values`,
            )}
            {#if color_vol_of(layer)}
              {@const explicit_range = layer.color_range}
              <select
                value={layer.colormap ?? DEFAULT_ISO_COLORMAP}
                onchange={(event) =>
                  update_layer(layer_idx, {
                    colormap: event.currentTarget.value as D3InterpolateName,
                  })}
                {@attach tooltip({ content: `Colormap for sampled values` })}
              >
                {#each ISO_COLORMAPS as cmap (cmap)}
                  <option value={cmap}>{colormap_name(cmap)}</option>
                {/each}
              </select>
              {@render range_bound_input(layer_idx, 0, explicit_range)}
              <ColorBar
                color_scale={layer.colormap ?? DEFAULT_ISO_COLORMAP}
                range={explicit_range
                  ? [
                      Math.min(explicit_range[0], explicit_range[1]),
                      Math.max(explicit_range[0], explicit_range[1]),
                    ]
                  : [0, 1]}
                tick_labels={0}
                wrapper_style="flex: 1; min-width: 40px"
                bar_style="height: 10px"
              />
              {@render range_bound_input(layer_idx, 1, explicit_range)}
              <button
                type="button"
                class="icon-btn"
                onclick={() => set_color_source(layer_idx, layer.color_volume_idx ?? null)}
                aria-label="Reset color range"
                {@attach tooltip({ content: `Reset colormap + range to auto-fit` })}>⟲</button
              >
              {#if warning}
                <span
                  class="compat-warning"
                  {@attach tooltip({
                    content: `Grids differ (${warning}) — values are resampled by trilinear interpolation in shared coordinates`,
                  })}>⚠</span
                >
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  {:else}
    <!-- Single-layer: isovalue slider full width -->
    <label
      {@attach tooltip({
        content: `Density threshold — surface is drawn where grid values equal this`,
      })}
    >
      <span>Isovalue:</span>
      <input type="range" min={step} max={slider_max} {step} bind:value={settings.isovalue} />
      <span class="value">{format_num(settings.isovalue, `.3~g`)}</span>
    </label>

    <!-- Opacity + colors on one row -->
    <div class="pane-row compact-row">
      <label
        {@attach tooltip({
          content: `Surface transparency — lower values reveal inner structure`,
        })}
      >
        <span>Opacity:</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          bind:value={settings.opacity}
          style="width: 60px"
        />
        <span class="value">{format_num(settings.opacity, `.2f`)}</span>
      </label>
      <label {@attach tooltip({ content: `Color for the positive isovalue surface` })}>
        <span>+ Color</span>
        <input type="color" bind:value={settings.positive_color} />
      </label>
      {#if settings.show_negative}
        <label {@attach tooltip({ content: `Color for the negative (−isovalue) surface` })}>
          <span>&minus; Color</span>
          <input type="color" bind:value={settings.negative_color} />
        </label>
      {/if}
      {#if volumes.length > 1}
        {@render color_source_select(
          -1,
          set_single_color_source,
          `Color this surface by another volume's values (e.g. density by ESP)`,
        )}
      {/if}
    </div>
  {/if}

  {#if any_periodic}
    <label
      {@attach tooltip({
        content: `Extend isosurface beyond cell boundaries to close partial spheres (fraction of cell)`,
      })}
    >
      Halo: {format_num(settings.halo, `.2f`)}
      <input type="range" min={0} max={0.5} step={0.01} bind:value={settings.halo} />
    </label>
    <div class="pane-row compact-row display-range">
      <span
        {@attach tooltip({
          content: `Fractional display range per lattice vector (VESTA-style): repeats periodic surfaces and clips them exactly at these bounds, e.g. -0.15 to 2.15. Empty = follow the structure supercell.`,
        })}>Range:</span
      >
      {#each [`a`, `b`, `c`] as axis_label, axis (axis)}
        <label class="range-axis">
          {axis_label}
          <input
            type="number"
            step="0.05"
            placeholder="0"
            value={settings.display_range ? settings.display_range[axis][0] : ``}
            onchange={(event) => update_display_range(axis, 0, event.currentTarget.value)}
          />
          <input
            type="number"
            step="0.05"
            placeholder="1"
            value={settings.display_range ? settings.display_range[axis][1] : ``}
            onchange={(event) => update_display_range(axis, 1, event.currentTarget.value)}
          />
        </label>
      {/each}
      {#if settings.display_range}
        <button
          type="button"
          class="icon-btn"
          onclick={() => (settings.display_range = undefined)}
          aria-label="Reset display range"
          {@attach tooltip({ content: `Follow the structure supercell again` })}>⟲</button
        >
      {/if}
    </div>
  {/if}

  {#if !is_multi_layer && volumes[active_volume_idx]}
    <div class="grid-info">
      {volumes[active_volume_idx].grid_dims.join(` × `)} grid &nbsp;|&nbsp; [{format_num(
        data_range.min,
        `.3~g`,
      )}, {format_num(data_range.max, `.3~g`)}]
    </div>
  {/if}
</SettingsSection>

<style>
  .compact-row {
    flex-wrap: wrap;
    gap: 4pt 14pt;
  }
  label {
    gap: 6pt;
  }
  .grid-info {
    font-size: 0.75em;
    opacity: 0.7;
    padding: 2px 0;
  }
  .volume-group {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 3px 0;
    border-top: 1px solid light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.12));
  }
  .volume-header {
    display: flex;
    align-items: center;
    gap: 0.4em;
    font-size: 0.85em;
  }
  .volume-label {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 14em;
  }
  .volume-dims,
  .volume-note {
    font-size: 0.85em;
    opacity: 0.6;
    white-space: nowrap;
  }
  .volume-header .icon-btn:first-of-type {
    margin-left: auto;
  }
  .icon-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0 4px;
    font-size: 1em;
    line-height: 1.2;
    opacity: 0.7;
    border-radius: 3px;
  }
  .icon-btn:hover {
    opacity: 1;
    background: light-dark(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.15));
  }
  .layer-row,
  .color-row {
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
  .color-row {
    padding-left: 1.4em;
    flex-wrap: wrap;
    label {
      display: flex;
      align-items: center;
      gap: 4pt;
    }
    select {
      max-width: 9em;
    }
  }
  .range-input {
    width: 4.5em;
    font-size: 0.9em;
    padding: 1px 2px;
    box-sizing: border-box;
  }
  .display-range {
    font-size: 0.85em;
    gap: 4pt 8pt;
    .range-axis {
      display: flex;
      align-items: center;
      gap: 3pt;
      input {
        width: 3.8em;
        font-size: 0.9em;
        padding: 1px 2px;
        box-sizing: border-box;
      }
    }
  }
  .compat-warning {
    cursor: help;
    color: light-dark(#b45309, #fbbf24);
  }
  .layer-value {
    font-family: monospace;
    font-size: 0.85em;
    min-width: 3.5em;
    text-align: right;
  }
</style>
