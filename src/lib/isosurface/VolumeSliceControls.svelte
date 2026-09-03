<script lang="ts">
  import { ISO_COLORMAPS } from '$lib/isosurface/coloring'
  import { normalize_active_volume_idx, type VolumetricData } from '$lib/isosurface/types'
  import { format_num } from '$lib/labels'
  import { SettingsSection } from '$lib/layout'
  import MillerIndexInput from '$lib/MillerIndexInput.svelte'
  import type { Vec3 } from '$lib/math'
  import { resolve_slice_cartesian_point } from './slice'
  import { create_volume_slice_settings } from './slice-settings'
  import type { VolumeSlicePlaneMode, VolumeSliceSettings } from './slice-settings'
  import type { VolumeSliceMode } from './slice-rendering'

  type CartesianVectorKey = `cartesian_point` | `cartesian_normal` | `cartesian_up`

  const CARTESIAN_PLANE_PRESETS = [
    { label: `XY`, cartesian_normal: [0, 0, 1], cartesian_up: [1, 0, 0] },
    { label: `XZ`, cartesian_normal: [0, 1, 0], cartesian_up: [1, 0, 0] },
    { label: `YZ`, cartesian_normal: [1, 0, 0], cartesian_up: [0, 1, 0] },
  ] satisfies { label: string; cartesian_normal: Vec3; cartesian_up: Vec3 }[]
  const CARTESIAN_VECTOR_CONTROLS = [
    { label: `Point (Å)`, name: `point`, key: `cartesian_point` },
    { label: `Normal`, name: `normal`, key: `cartesian_normal` },
    { label: `Up`, name: `up`, key: `cartesian_up` },
  ] satisfies { label: string; name: string; key: CartesianVectorKey }[]

  let {
    settings = $bindable(create_volume_slice_settings()),
    volumes = [],
    active_volume_idx = $bindable(0),
  }: {
    settings?: Partial<VolumeSliceSettings>
    volumes?: VolumetricData[]
    active_volume_idx?: number
  } = $props()

  $effect(() => {
    const normalized_idx = normalize_active_volume_idx(active_volume_idx, volumes.length)
    if (normalized_idx !== active_volume_idx) active_volume_idx = normalized_idx
  })

  let active_volume = $derived(volumes[active_volume_idx])
  let resolved_settings = $derived(create_volume_slice_settings(settings))
  let cartesian_point = $derived(
    resolve_slice_cartesian_point(resolved_settings.cartesian_point, active_volume),
  )

  function update_settings(updates: Partial<VolumeSliceSettings>): void {
    const next_settings = create_volume_slice_settings({ ...resolved_settings, ...updates })
    settings = next_settings
  }

  function update_vector(key: CartesianVectorKey, axis_idx: number, value: number): void {
    if (!Number.isFinite(value)) return
    const source = key === `cartesian_point` ? cartesian_point : resolved_settings[key]
    const vector = [...source] as Vec3
    vector[axis_idx] = value
    update_settings({ [key]: vector })
  }

  function update_color_bound(bound_idx: 0 | 1, raw_value: string): void {
    const value = raw_value.trim() === `` ? undefined : Number(raw_value)
    if (value === undefined) return update_settings({ color_range: undefined })
    if (!Number.isFinite(value)) return
    const [minimum, maximum] = resolved_settings.color_range ?? [
      active_volume?.data_range.min ?? 0,
      active_volume?.data_range.max ?? 1,
    ]
    update_settings({
      color_range: bound_idx === 0 ? [value, maximum] : [minimum, value],
    })
  }
</script>

{#snippet color_bound_input(bound_idx: 0 | 1)}
  <input
    aria-label="Slice color {bound_idx === 0 ? `minimum` : `maximum`}"
    type="number"
    step="any"
    placeholder="auto"
    value={resolved_settings.color_range?.[bound_idx] ?? ``}
    oninput={(event) => update_color_bound(bound_idx, event.currentTarget.value)}
  />
{/snippet}

<SettingsSection
  title="Cross-section"
  current_values={{ ...resolved_settings, active_volume_idx }}
  on_reset={() => {
    active_volume_idx = 0
    update_settings(create_volume_slice_settings())
  }}
  class="slice-settings"
  layout="grid"
>
  {#if volumes.length > 1}
    <label>
      <span>Volume</span>
      <select bind:value={active_volume_idx} aria-label="Slice volume">
        {#each volumes as volume, volume_idx (volume_idx)}
          <option value={volume_idx}>
            {volume.label ?? `Volume ${volume_idx + 1}`}
          </option>
        {/each}
      </select>
    </label>
  {/if}

  <label>
    <span>Plane</span>
    <select
      aria-label="Slice plane mode"
      bind:value={
        () => resolved_settings.plane_mode,
        (plane_mode) => update_settings({ plane_mode: plane_mode as VolumeSlicePlaneMode })
      }
    >
      <option value="hkl">HKL</option>
      <option value="cartesian">Cartesian</option>
    </select>
  </label>

  {#if resolved_settings.plane_mode === `hkl`}
    <div class="setting">
      <span>Indices</span>
      <MillerIndexInput
        bind:value={
          () => resolved_settings.miller_indices,
          (miller_indices) => update_settings({ miller_indices })
        }
      />
    </div>
    <label>
      <span>Position</span>
      <span>d = {format_num(resolved_settings.position, `.2f`)}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        aria-label="Slice position"
        bind:value={
          () => resolved_settings.position, (position) => update_settings({ position })
        }
      />
    </label>
  {:else}
    {#each CARTESIAN_VECTOR_CONTROLS as { label, name, key } (name)}
      {@const vector = key === `cartesian_point` ? cartesian_point : resolved_settings[key]}
      <label class="vector-control">
        <span>{label}</span>
        <span class="vector-inputs">
          {#each [`x`, `y`, `z`] as axis, axis_idx (axis)}
            <input
              aria-label="Cartesian {name} {axis}"
              type="number"
              step={0.1}
              value={vector[axis_idx]}
              oninput={(event) =>
                update_vector(key, axis_idx, event.currentTarget.valueAsNumber)}
            />
          {/each}
        </span>
      </label>
    {/each}
    <div class="setting">
      <span>Plane presets</span>
      <div class="plane-presets" aria-label="Cartesian plane presets">
        {#each CARTESIAN_PLANE_PRESETS as { label, ...plane } (label)}
          <button type="button" onclick={() => update_settings({ cartesian_point, ...plane })}>
            {label}
          </button>
        {/each}
        <button type="button" onclick={() => update_settings({ cartesian_point: undefined })}>
          Center
        </button>
      </div>
    </div>
  {/if}

  <label>
    <span>Resolution (0 = native)</span>
    <input
      aria-label="Slice resolution"
      type="number"
      min={0}
      step={1}
      bind:value={
        () => resolved_settings.resolution, (resolution) => update_settings({ resolution })
      }
    />
  </label>
  <label>
    <span>View</span>
    <select
      aria-label="Slice rendering mode"
      bind:value={
        () => resolved_settings.render_mode,
        (render_mode) => update_settings({ render_mode: render_mode as VolumeSliceMode })
      }
    >
      <option value="both">Filled + contours</option>
      <option value="filled">Filled</option>
      <option value="contours">Contours</option>
    </select>
  </label>
  <label>
    <span>Colormap</span>
    <select
      aria-label="Slice colormap"
      bind:value={
        () => resolved_settings.colormap, (colormap) => update_settings({ colormap })
      }
    >
      {#each ISO_COLORMAPS as colormap (colormap)}
        <option value={colormap}>{colormap.replace(`interpolate`, ``)}</option>
      {/each}
    </select>
  </label>
  <label>
    <span>Contours</span>
    <input
      aria-label="Slice contour levels"
      type="number"
      min={0}
      max={50}
      step={1}
      bind:value={
        () => resolved_settings.contour_levels,
        (contour_levels) => update_settings({ contour_levels })
      }
    />
  </label>

  <label class="range-control">
    <span>Range</span>
    <span class="range-inputs">
      {@render color_bound_input(0)}
      <span>to</span>
      {@render color_bound_input(1)}
      <button type="button" onclick={() => update_settings({ color_range: undefined })}>
        Auto
      </button>
    </span>
  </label>

  {#if active_volume}
    <div class="grid-info">
      {active_volume.dims.join(` × `)} grid &nbsp;|&nbsp; [{format_num(
        active_volume.data_range.min,
        `.3~g`,
      )}, {format_num(active_volume.data_range.max, `.3~g`)}]
    </div>
  {/if}
</SettingsSection>

<style>
  :is(.plane-presets, .vector-inputs, .range-inputs) {
    display: flex;
    align-items: center;
    gap: 0.35em;
    flex-wrap: wrap;
  }
  .vector-inputs {
    input {
      width: 5.5em;
      min-width: 0;
    }
  }
  .range-inputs input {
    width: 6.5em;
  }
  .plane-presets {
    margin-block: 0.2em;
  }
  button {
    padding: 0.15em 0.45em;
  }
  .grid-info {
    grid-column: 1 / -1;
    opacity: 0.7;
    font-size: 0.8em;
  }
</style>
