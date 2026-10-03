<script lang="ts">
  import { track_settings } from '#lib/controls.js'
  // Controls panel for isosurface visualization settings. Surfaces are grouped under their
  // geometry-source volume; each exposes isovalue, opacity, colour and optional cross-volume
  // scalar colouring (color source, colormap, value range).
  import { Icon } from 'svelte-widgets'
  import { Reset } from 'svelte-widgets/icons'
  import { format_num } from '#lib/labels.js'
  import { SettingsSection } from '#lib/layout/index.js'
  import type { Vec2 } from '#lib/math.js'
  import { ColorScaleSelect } from '#lib/plot/index.js'
  import { clamp01 } from '#lib/utils.js'
  import { tooltip } from 'svelte-widgets/attachments'
  import {
    auto_color_config,
    DEFAULT_ISO_COLORMAP,
    ISO_COLORMAP_SELECT_PROPS,
  } from './coloring'
  import type { DisplayRange } from './sampling'
  import { compare_volume_grids } from './sampling'
  import type { IsosurfaceLayer, IsosurfaceSettings, VolumetricData } from './types'
  import {
    auto_isosurface_settings,
    auto_volume_layer,
    DEFAULT_ISOSURFACE_SETTINGS,
    normalize_active_volume_id,
    index_volumes,
    format_data_value,
    isovalue_histogram,
    remove_volume,
    snap_isovalue,
    surface_isovalue_band,
  } from './types'

  let {
    settings = $bindable({ ...DEFAULT_ISOSURFACE_SETTINGS }),
    volumes = $bindable([]),
    active_volume_id = $bindable<string | undefined>(),
  }: {
    settings?: IsosurfaceSettings
    volumes?: VolumetricData[]
    active_volume_id?: string
  } = $props()

  // Preserve the selected field while it exists; select the first remaining field on removal.
  $effect(() => {
    const normalized_id = normalize_active_volume_id(active_volume_id, volumes)
    if (normalized_id !== active_volume_id) active_volume_id = normalized_id
  })

  const vol_label = (idx: number): string => volumes[idx]?.label ?? `Volume ${idx + 1}`

  const volume_by_id = $derived(index_volumes(volumes))
  const resolve_geo_idx = (layer: IsosurfaceLayer): number =>
    volumes.findIndex(({ id: identifier }) => identifier === layer.volume_id)
  const color_vol_of = (layer: IsosurfaceLayer): VolumetricData | undefined =>
    layer.color_volume_id === undefined ? undefined : volume_by_id.get(layer.color_volume_id)
  const update_settings = (updates: Partial<IsosurfaceSettings>) =>
    (settings = { ...settings, ...updates })

  function update_layer(idx: number, updates: Partial<IsosurfaceLayer>) {
    update_settings({
      layers: settings.layers.map((layer, layer_idx) =>
        layer_idx === idx ? { ...layer, ...updates } : layer,
      ),
    })
  }

  function remove_layer(idx: number) {
    update_settings({
      layers: settings.layers.filter((_layer, layer_idx) => layer_idx !== idx),
    })
  }

  function add_surface(vol_idx: number) {
    const vol = volumes[vol_idx]
    if (!vol) return
    const { layers } = settings
    // nth shell of this volume: steps the isovalue/opacity ladder so it never coincides
    // with the surfaces the volume already has
    const shell_idx = layers.filter((layer) => layer.volume_id === vol.id).length
    update_settings({ layers: [...layers, auto_volume_layer(vol, layers.length, shell_idx)] })
    active_volume_id = vol.id
  }

  // Move a surface onto another volume, e.g. from ELF spin up to spin down. The isovalue
  // carries over while the new volume reaches it, so both channels compare at one threshold;
  // otherwise the surface takes the new volume's auto isovalue.
  function set_layer_volume(layer_idx: number, volume_id: string) {
    const layer = settings.layers[layer_idx]
    const volume = volume_by_id.get(volume_id)
    if (!layer || !volume) return
    const { isovalue, show_negative } = auto_volume_layer(volume)
    const keeps_isovalue = Math.abs(layer.isovalue) <= volume.data_range.abs_max
    update_layer(
      layer_idx,
      keeps_isovalue ? { volume_id } : { volume_id, isovalue, show_negative },
    )
    active_volume_id = volume_id
  }

  // Isovalue slider: a drag pressing just past the isovalues that still draw a surface sticks
  // at the last one for a moment (keyboard steps snap once, then pass through)
  const SNAP_REACH = 0.03 // fraction of the slider span
  let isovalue_pointer_down = false
  function set_isovalue(layer_idx: number, input: HTMLInputElement, band: Vec2 | null) {
    const [min, max, step] = [input.min, input.max, input.step].map(Number)
    const value = snap_isovalue(Number(input.value), band, {
      min,
      step,
      reach: SNAP_REACH * (max - min),
      previous: settings.layers[layer_idx]?.isovalue ?? NaN,
      sticky: isovalue_pointer_down,
    })
    if (String(value) !== input.value) input.value = String(value)
    update_layer(layer_idx, { isovalue: value })
  }

  // Log-scaled histogram bars (one unit wide per bin, height ≤ 1) as two SVG paths: bins whose
  // centre draws a surface, and the rest
  function histogram_paths(
    counts: Uint32Array,
    band: Vec2 | null,
    [slider_min, slider_max]: Vec2,
  ): [string, string] {
    const peak = Math.log1p(Math.max(1, ...counts))
    const paths: [string, string] = [``, ``]
    for (const [bin, count] of counts.entries()) {
      if (count === 0) continue
      const center = slider_min + ((bin + 0.5) / counts.length) * (slider_max - slider_min)
      const height = Math.log1p(count) / peak
      paths[band && center > band[0] && center <= band[1] ? 0 : 1] +=
        `M${bin} 1v${-height}h1v${height}z`
    }
    return paths
  }

  // Removed volumes stay restorable with their own surfaces (color links other surfaces had
  // to them are not restored) until the volume set changes from outside, e.g. a new file:
  // a volume of the previous file must not come back onto the new structure.
  type RemovedVolume = { volume: VolumetricData; index: number; layers: IsosurfaceLayer[] }
  let removed_volumes = $state.raw<RemovedVolume[]>([])
  let own_volume_ids = ``
  const volume_ids = (list: VolumetricData[]) => list.map(({ id }) => id).join(`\n`)
  $effect.pre(() => {
    if (volume_ids(volumes) !== own_volume_ids) removed_volumes = []
  })
  const set_volumes = (next: VolumetricData[]) => {
    volumes = next
    own_volume_ids = volume_ids(next)
    active_volume_id = normalize_active_volume_id(active_volume_id, next)
  }

  function handle_remove_volume(vol_idx: number) {
    const volume = volumes[vol_idx]
    if (!volume) return
    const result = remove_volume(volumes, settings.layers, volume.id)
    const layers = settings.layers.filter((layer) => layer.volume_id === volume.id)
    removed_volumes = [...removed_volumes, { volume, index: vol_idx, layers }]
    set_volumes(result.volumes)
    update_settings({ layers: result.layers })
  }

  function restore_volume(removed_idx: number) {
    const entry = removed_volumes[removed_idx]
    if (!entry) return
    set_volumes(volumes.toSpliced(Math.min(entry.index, volumes.length), 0, entry.volume))
    update_settings({ layers: [...settings.layers, ...entry.layers] })
    removed_volumes = removed_volumes.toSpliced(removed_idx, 1)
  }

  // Set (or clear) a layer's scalar-color source. The colormap is auto-picked
  // from the color volume's data; color_range stays unset so the renderer fits
  // it to the scalar values actually present on the surface.
  function set_color_source(layer_idx: number, color_id: string | null) {
    const color_vol = color_id === null ? undefined : volume_by_id.get(color_id)
    if (color_id !== null && !color_vol) return
    update_layer(layer_idx, {
      color_volume_id: color_id ?? undefined,
      colormap: color_vol ? auto_color_config(color_vol.data_range).colormap : undefined,
      color_range: undefined,
    })
  }

  // Update one bound of a layer's color range. An empty input resets the whole
  // range to auto-fit (renderer fits it to the values sampled on the surface).
  // Typing into an auto range seeds the other bound from the color volume's
  // full data range as a starting point.
  function update_color_range(layer_idx: number, bound: 0 | 1, raw_value: string) {
    const layer = settings.layers[layer_idx]
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

  // Layers grouped by geometry-source volume for the tree-style UI
  let grouped_layers = $derived.by(() => {
    const groups = volumes.map((_vol, vol_idx) => ({
      vol_idx,
      entries: [] as { layer: IsosurfaceLayer; layer_idx: number }[],
    }))
    for (const [layer_idx, layer] of settings.layers.entries()) {
      groups[resolve_geo_idx(layer)]?.entries.push({ layer, layer_idx })
    }
    return groups
  })

  // Halo and display range only apply to periodic volumes
  let any_periodic = $derived(volumes.some((vol) => vol.periodic))

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
    const is_default = range.every(([lower, upper]) => lower === 0 && upper === 1)
    update_settings({ display_range: is_default ? undefined : range })
  }

  const default_settings = () =>
    volumes.length > 0
      ? auto_isosurface_settings(volumes[0])
      : { ...DEFAULT_ISOSURFACE_SETTINGS }
  const isosurface_settings = $derived(
    track_settings(() => ({ ...settings }), { ...default_settings() }),
  )
</script>

<!-- Range input over a histogram of the volume's values, with the isovalues that draw a
  surface highlighted and their ends labelled -->
{#snippet isovalue_track(
  layer: IsosurfaceLayer,
  layer_idx: number,
  vol: VolumetricData,
  slider_min: number,
  slider_max: number,
)}
  {@const band = surface_isovalue_band(vol.data_range, layer.show_negative)}
  {@const counts = isovalue_histogram(vol, [slider_min, slider_max], layer.show_negative)}
  {@const fraction = (value: number) =>
    clamp01((value - slider_min) / (slider_max - slider_min))}
  {@const [band_bars, outside_bars] = histogram_paths(counts, band, [slider_min, slider_max])}
  <div class="isovalue-track">
    <svg
      class="isovalue-histogram"
      viewBox="0 0 {counts.length} 1"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {#if band}
        <rect
          class="surface-band"
          x={fraction(band[0]) * counts.length}
          width={(fraction(band[1]) - fraction(band[0])) * counts.length}
          height="1"
        />
      {/if}
      <path class="bars" d={band_bars} />
      <path class="bars outside" d={outside_bars} />
    </svg>
    <input
      type="range"
      min={slider_min}
      max={slider_max}
      step={slider_min}
      value={layer.isovalue}
      oninput={(event) => set_isovalue(layer_idx, event.currentTarget, band)}
      onpointerdown={() => (isovalue_pointer_down = true)}
      onpointerup={() => (isovalue_pointer_down = false)}
      onlostpointercapture={() => (isovalue_pointer_down = false)}
      aria-label="Isovalue"
      {@attach tooltip({
        content: `Bars: how many grid values sit at each isovalue (log scale). Shaded: isovalues that draw a surface`,
      })}
    />
    {#if band}
      {#each band as edge, edge_idx (edge_idx)}
        {@const position = fraction(edge)}
        <!-- centred on its edge, but kept inside the track near either end -->
        <span
          class="band-tick"
          style:left="{position * 100}%"
          style:translate={position < 0.15 ? `0` : position > 0.85 ? `-100%` : `-50%`}
          >{format_data_value(edge, vol.data_range)}</span
        >
      {/each}
    {/if}
  </div>
{/snippet}

{#snippet volume_options()}
  {#each volumes as volume, vol_idx (volume.id)}
    <option value={volume.id}>{vol_label(vol_idx)}</option>
  {/each}
{/snippet}

{#snippet range_bound_input(layer_idx: number, bound: 0 | 1, explicit_range?: Vec2)}
  <input
    type="number"
    style="width: 4.5em"
    step="any"
    placeholder="auto"
    value={explicit_range ? Number(explicit_range[bound].toPrecision(4)) : ``}
    onchange={(event) => update_color_range(layer_idx, bound, event.currentTarget.value)}
    aria-label={bound === 0 ? `Color range minimum` : `Color range maximum`}
    {@attach tooltip({
      content: `Value mapped to the colormap ${
        bound === 0 ? `start` : `end`
      } (empty = auto-fit to surface values)`,
    })}
  />
{/snippet}

<SettingsSection
  title="Isosurface"
  changed_keys={isosurface_settings.changed_keys}
  on_reset={() => (settings = default_settings())}
  layout="grid"
  class="isosurface-settings"
>
  <label
    {@attach tooltip({
      content: `Show negative lobe at −isovalue (for orbitals, ESP, magnetization)`,
    })}
  >
    <span>Neg. lobe</span>
    <input
      type="checkbox"
      checked={settings.layers.some((layer) => layer.show_negative)}
      onchange={(event) => {
        const show_negative = event.currentTarget.checked
        update_settings({
          layers: settings.layers.map((layer) => ({ ...layer, show_negative })),
        })
      }}
    />
  </label>
  <label>
    <span {@attach tooltip({ content: `Render as wireframe mesh instead of solid surface` })}
      >Wireframe</span
    >
    <input
      type="checkbox"
      bind:checked={() => settings.wireframe, (wireframe) => update_settings({ wireframe })}
    />
  </label>

  <!-- Surfaces grouped under their geometry-source volume -->
  {#each grouped_layers as { vol_idx, entries } (vol_idx)}
    {@const vol = volumes[vol_idx]}
    <div class="volume-group">
      <div class="volume-header">
        <span class="volume-label" title={vol_label(vol_idx)}>{vol_label(vol_idx)}</span>
        <span class="volume-dims">{vol.dims.join(`×`)}</span>
        <span
          class="volume-range"
          {@attach tooltip({ content: `Data range [min, max] of this volume` })}
          >{format_data_value(vol.data_range.min, vol.data_range)}–{format_data_value(
            vol.data_range.max,
            vol.data_range,
          )}</span
        >
        {#if entries.length > 0}
          <button
            type="button"
            class="icon-btn"
            onclick={() => add_surface(vol_idx)}
            aria-label="Add surface for {vol_label(vol_idx)}"
            {@attach tooltip({ content: `Add another isosurface from this volume` })}>+</button
          >
        {/if}
        {#if volumes.length > 1}
          <button
            type="button"
            class="icon-btn"
            onclick={() => handle_remove_volume(vol_idx)}
            aria-label="Remove volume {vol_label(vol_idx)}"
            {@attach tooltip({
              content: `Remove this volume and its surfaces (restorable below)`,
            })}>×</button
          >
        {/if}
      </div>
      <!-- a volume whose surfaces were all removed gets them back from here -->
      {#if entries.length === 0}
        <div class="empty-volume">
          <button
            type="button"
            class="add-surface"
            onclick={() => add_surface(vol_idx)}
            aria-label="Add surface for {vol_label(vol_idx)}">+ Add surface</button
          >
          {#if volumes.length > 1}
            <span class="volume-note">still usable as a color source</span>
          {/if}
        </div>
      {/if}

      {#each entries as { layer, layer_idx } (layer_idx)}
        {@const layer_abs_max = Math.max(vol.data_range.abs_max, 0.001)}
        {@const layer_step = layer_abs_max / 200}
        {@const warning = compat_warning(layer)}
        {@const color_vol = color_vol_of(layer)}
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
            onchange={(event) => update_layer(layer_idx, { color: event.currentTarget.value })}
            {@attach tooltip({
              content:
                layer.color_volume_id != null
                  ? `Fallback color (surface uses colormap)`
                  : `Surface color`,
            })}
          />
          {#if layer.show_negative}
            <input
              type="color"
              value={layer.negative_color}
              onchange={(event) =>
                update_layer(layer_idx, { negative_color: event.currentTarget.value })}
              {@attach tooltip({ content: `Color for the negative-valued lobe` })}
            />
          {/if}
          <div class="layer-sliders">
            <label>
              <span
                {@attach tooltip({
                  content: `Density threshold — surface is drawn where grid values equal this`,
                })}>Isovalue</span
              >
              {@render isovalue_track(layer, layer_idx, vol, layer_step, layer_abs_max)}
              <span class="layer-value">{format_num(layer.isovalue, `.3~g`)}</span>
            </label>
            <label>
              <span {@attach tooltip({ content: `Surface transparency` })}>Opacity</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={layer.opacity}
                oninput={(event) =>
                  update_layer(layer_idx, { opacity: Number(event.currentTarget.value) })}
                aria-label="Opacity"
              />
              <span class="layer-value">{format_num(layer.opacity, `.2f`)}</span>
            </label>
          </div>
          <button
            type="button"
            class="icon-btn"
            onclick={() => remove_layer(layer_idx)}
            aria-label="Remove surface"
            {@attach tooltip({ content: `Remove this surface` })}>×</button
          >
        </div>
        <div class="color-row">
          {#if volumes.length > 1}
            <label>
              <span
                {@attach tooltip({
                  content: `Volume this surface is drawn from (e.g. switch spin up/down)`,
                })}>Surface of</span
              >
              <select
                value={layer.volume_id}
                onchange={(event) => set_layer_volume(layer_idx, event.currentTarget.value)}
              >
                {@render volume_options()}
              </select>
            </label>
          {/if}
          <label>
            <span {@attach tooltip({ content: `Color surface by another volume's values` })}
              >Color by</span
            >
            <select
              value={layer.color_volume_id ?? ``}
              onchange={(event) => {
                set_color_source(layer_idx, event.currentTarget.value || null)
              }}
            >
              <option value="">None (solid)</option>
              {@render volume_options()}
            </select>
          </label>
          {#if color_vol}
            {@const explicit_range = layer.color_range}
            {@const auto_colormap = auto_color_config(color_vol.data_range).colormap}
            <ColorScaleSelect
              {...ISO_COLORMAP_SELECT_PROPS}
              value={layer.colormap ?? DEFAULT_ISO_COLORMAP}
              on_add={({ option }) => update_layer(layer_idx, { colormap: option })}
              aria-label="Colormap for sampled values"
              {@attach tooltip({ content: `Colormap for sampled values` })}
            />
            <div class="color-range" aria-label="Colormap value range">
              <span>Range</span>
              {@render range_bound_input(layer_idx, 0, explicit_range)}
              <span aria-hidden="true">&ndash;</span>
              {@render range_bound_input(layer_idx, 1, explicit_range)}
            </div>
            {#if explicit_range || (layer.colormap ?? DEFAULT_ISO_COLORMAP) !== auto_colormap}
              {@const reset_color_label = `Reset colormap + range to auto-fit`}
              <button
                type="button"
                class="icon-btn"
                onclick={() => set_color_source(layer_idx, layer.color_volume_id ?? null)}
                aria-label={reset_color_label}
                {@attach tooltip({ content: reset_color_label })}
              >
                <Icon icon={Reset} aria-hidden="true" style="--icon-size: 12px" />
              </button>
            {/if}
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
  {#if removed_volumes.length > 0}
    <div class="removed-volumes">
      {#each removed_volumes as { volume }, removed_idx (volume.id)}
        <button
          type="button"
          onclick={() => restore_volume(removed_idx)}
          aria-label="Restore volume {volume.label ?? volume.id}"
          {@attach tooltip({ content: `Bring this volume back with its surfaces` })}
          >↺ {volume.label ?? volume.id}</button
        >
      {/each}
    </div>
  {/if}

  {#if any_periodic}
    <label
      {@attach tooltip({
        content: `Extend isosurface beyond cell boundaries to close partial spheres (fraction of cell)`,
      })}
    >
      <span>Halo</span>
      <span>{format_num(settings.halo, `.2f`)}</span>
      <input
        type="range"
        min={0}
        max={0.5}
        step={0.01}
        bind:value={() => settings.halo, (halo) => update_settings({ halo })}
      />
    </label>
    <div class="setting display-range">
      <span
        {@attach tooltip({
          content: `Fractional display range per lattice vector (VESTA-style): repeats periodic surfaces and clips them exactly at these bounds, e.g. -0.15 to 2.15. Empty = follow the structure supercell.`,
        })}>Range</span
      >
      <div class="range-axes">
        {#each [`a`, `b`, `c`] as axis_label, axis (axis)}
          <label class="range-axis">
            <span>{axis_label}</span>
            <input
              type="number"
              step="0.05"
              placeholder="0"
              value={settings.display_range?.[axis][0] ?? ``}
              onchange={(event) => update_display_range(axis, 0, event.currentTarget.value)}
            />
            <input
              type="number"
              step="0.05"
              placeholder="1"
              value={settings.display_range?.[axis][1] ?? ``}
              onchange={(event) => update_display_range(axis, 1, event.currentTarget.value)}
            />
          </label>
        {/each}
        {#if settings.display_range}
          <button
            type="button"
            class="icon-btn"
            onclick={() => update_settings({ display_range: undefined })}
            aria-label="Reset display range"
            {@attach tooltip({ content: `Follow the structure supercell again` })}
          >
            <Icon icon={Reset} aria-hidden="true" style="--icon-size: 12px" />
          </button>
        {/if}
      </div>
    </div>
  {/if}
</SettingsSection>

<style>
  /* Shared chrome for native selects/number/color + ColorScaleSelect (--sms-*) */
  :global(.isosurface-settings) {
    --iso-ctrl-h: 22px;
    --iso-ctrl-radius: 3px;
    --iso-ctrl-border: 1px solid var(--border-color, light-dark(#b8bec8, #555));
    --iso-ctrl-bg: light-dark(#fff, #1e1e1e);
    --sms-min-height: var(--iso-ctrl-h);
    --sms-border: var(--iso-ctrl-border);
    --sms-border-radius: var(--iso-ctrl-radius);
    --sms-bg: var(--iso-ctrl-bg);
    font-size: 0.95em;
  }
  :global(.isosurface-settings) :is(select, input[type='number'], input[type='color']) {
    box-sizing: border-box;
    margin: 0; /* beat DraggablePane margins */
    border: var(--iso-ctrl-border);
    border-radius: var(--iso-ctrl-radius);
  }
  :global(.isosurface-settings) :is(select, input[type='number']) {
    height: var(--iso-ctrl-h);
    padding: 0 4px;
    background: var(--iso-ctrl-bg);
    color: inherit;
    font: inherit;
    line-height: 1.2;
  }
  :global(.isosurface-settings) input[type='color'] {
    width: var(--iso-ctrl-h);
    height: var(--iso-ctrl-h);
    padding: 0;
    cursor: pointer;
    background: transparent;
  }
  .volume-group {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 3px 0;
    border-top: 1px solid light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.12));
  }
  .volume-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4em;
    min-width: 0;
  }
  .volume-label {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    max-width: 14em;
  }
  .volume-dims,
  .volume-range,
  .volume-note {
    opacity: 0.6;
    white-space: nowrap;
  }
  .removed-volumes {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    button {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 1pt 6pt;
      border: 1px dashed color-mix(in srgb, currentColor 35%, transparent);
      border-radius: var(--iso-ctrl-radius);
      background: transparent;
      color: inherit;
      font: inherit;
      opacity: 0.8;
      cursor: pointer;
      &:hover {
        opacity: 1;
        background: color-mix(in srgb, currentColor 10%, transparent);
      }
    }
  }
  .empty-volume {
    display: flex;
    align-items: center;
    gap: 0.6em;
    .add-surface {
      padding: 1pt 6pt;
      border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
      border-radius: var(--iso-ctrl-radius);
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
      &:hover {
        background: color-mix(in srgb, currentColor 10%, transparent);
      }
    }
  }
  .volume-header .icon-btn:first-of-type {
    margin-left: auto;
  }
  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: var(--iso-ctrl-h);
    height: var(--iso-ctrl-h);
    padding: 0;
    border: none;
    border-radius: var(--iso-ctrl-radius);
    background: transparent;
    color: inherit;
    font-size: 0.875rem;
    line-height: 1;
    opacity: 0.7;
    cursor: pointer;
  }
  .icon-btn:hover {
    opacity: 1;
    background: light-dark(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.15));
  }
  .layer-row,
  .color-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5em;
    min-width: 0;
    input[type='checkbox'] {
      margin: 0;
      flex-shrink: 0;
    }
  }
  .isovalue-track {
    position: relative;
    display: grid;
    min-width: 0;
    padding-bottom: 0.9em; /* room for the band-end labels */
    /* the thumb travels inset by half its width; histogram and labels follow it */
    --thumb-inset: 7px;
    .isovalue-histogram {
      width: calc(100% - 2 * var(--thumb-inset));
      height: 12px;
      margin-inline: var(--thumb-inset);
      .surface-band {
        fill: color-mix(in srgb, var(--accent-color, cornflowerblue) 18%, transparent);
      }
      .bars {
        fill: color-mix(in srgb, currentColor 55%, transparent);
        &.outside {
          fill: color-mix(in srgb, currentColor 18%, transparent);
        }
      }
    }
    .band-tick {
      position: absolute;
      bottom: 0;
      margin-left: var(--thumb-inset);
      max-width: calc(100% - 2 * var(--thumb-inset));
      font-size: 0.68em;
      line-height: 1;
      opacity: 0.7;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      pointer-events: none;
    }
  }
  /* label | slider | value per row, so both sliders get the full width and line up */
  .layer-sliders {
    flex: 1;
    display: grid;
    grid-template-columns: auto minmax(3em, 1fr) 3.5em;
    align-items: center;
    gap: 5px 0.6em;
    min-width: 0;
    label {
      display: contents;
    }
    input[type='range'] {
      width: 100%;
      margin: 0;
    }
    .layer-value {
      font-family: monospace;
      font-variant-numeric: tabular-nums;
    }
  }
  .color-row {
    padding-left: 1.4em;
    label {
      display: flex;
      align-items: center;
      gap: 4pt;
      min-width: 0;
    }
    select {
      max-width: min(11em, 100%);
    }
    :global(.multiselect) {
      flex: 1 1 10em;
      min-width: 0;
      font: inherit;
      color: inherit;
    }
  }
  .color-range {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px;
  }
  .display-range {
    .range-axes {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4pt 8pt;
      min-width: 0;
    }
    .range-axis {
      display: flex;
      align-items: center;
      gap: 3pt;
      input {
        width: 3.8em;
      }
    }
  }
  .compat-warning {
    cursor: help;
    color: light-dark(#b45309, #fbbf24);
  }
</style>
