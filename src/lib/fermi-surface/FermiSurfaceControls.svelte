<script lang="ts">
  import { DraggablePane, SettingsSection } from '$lib'
  import type { CameraProjection } from '$lib/settings'
  import { type Snippet } from 'svelte'
  import type {
    BandGridData,
    ColorProperty,
    FermiSurfaceData,
    RepresentationMode,
  } from './types'

  let {
    controls_open = $bindable(false),
    fermi_data,
    band_data,
    mu = $bindable(0),
    color_property = $bindable(`band`),
    color_scale = $bindable(`interpolateViridis`),
    representation = $bindable(`solid`),
    surface_opacity = $bindable(0.8),
    selected_bands = $bindable(),
    show_bz = $bindable(true),
    bz_opacity = $bindable(0.1),
    show_vectors = $bindable(true),
    tile_bz = $bindable(false),
    // Clipping plane
    clip_enabled = $bindable(false),
    clip_axis = $bindable<`x` | `y` | `z`>(`z`),
    clip_position = $bindable(0),
    clip_flip = $bindable(false),
    // Interpolation
    interpolation_factor = $bindable(1),
    // Camera
    camera_projection = $bindable(`perspective`),
    on_mu_change,
    on_interpolation_change,
    on_export,
    children,
  }: {
    controls_open?: boolean
    fermi_data?: FermiSurfaceData
    band_data?: BandGridData
    mu?: number | undefined
    color_property?: ColorProperty
    color_scale?: string
    representation?: RepresentationMode
    surface_opacity?: number
    selected_bands?: number[]
    show_bz?: boolean
    bz_opacity?: number
    show_vectors?: boolean
    tile_bz?: boolean
    clip_enabled?: boolean
    clip_axis?: `x` | `y` | `z`
    clip_position?: number
    clip_flip?: boolean
    interpolation_factor?: number
    camera_projection?: CameraProjection
    on_mu_change?: (mu: number) => void
    on_interpolation_change?: (factor: number) => void
    on_export?: (format: `stl` | `obj` | `gltf`) => void
    children?: Snippet<[{ fermi_data?: FermiSurfaceData; band_data?: BandGridData }]>
  } = $props()

  // Color scale options
  const color_scales = [
    { value: `interpolateViridis`, label: `Viridis` },
    { value: `interpolatePlasma`, label: `Plasma` },
    { value: `interpolateInferno`, label: `Inferno` },
    { value: `interpolateMagma`, label: `Magma` },
    { value: `interpolateCool`, label: `Cool` },
    { value: `interpolateWarm`, label: `Warm` },
    { value: `interpolateRainbow`, label: `Rainbow` },
    { value: `interpolateTurbo`, label: `Turbo` },
    { value: `interpolateRdYlBu`, label: `RdYlBu` },
    { value: `interpolateSpectral`, label: `Spectral` },
  ]

  // Get unique band indices from Fermi surface data
  let available_bands = $derived(
    fermi_data
      ? [...new Set(fermi_data.isosurfaces.map((iso) => iso.band_index))].sort(
        (a, b) => a - b,
      )
      : [],
  )
  // Track previous available bands to detect when fermi_data changes
  let prev_available_bands = $state<number[]>([])

  // Reset selected_bands when available_bands changes (new file loaded)
  // This ensures band selection doesn't persist across different files
  $effect(() => {
    const bands_changed = available_bands.length !== prev_available_bands.length ||
      available_bands.some((band, idx) => band !== prev_available_bands[idx])
    if (bands_changed) { // Always update tracking variable to avoid stale comparisons
      prev_available_bands = [...available_bands]
      // Only reset selected_bands when there are bands to select
      if (available_bands.length > 0) selected_bands = [...available_bands]
    }
  })

  function toggle_band(band_idx: number) {
    if (!selected_bands) {
      selected_bands = [band_idx]
      return
    }
    const idx = selected_bands.indexOf(band_idx)
    if (idx >= 0) {
      selected_bands = selected_bands.filter((b) => b !== band_idx)
    } else {
      selected_bands = [...selected_bands, band_idx].sort((a, b) => a - b)
    }
  }

  function handle_mu_change(event: Event) {
    const target = event.target as HTMLInputElement
    const trimmed = target.value.trim()
    const parsed = parseFloat(trimmed)
    // Only update mu when input is valid; keep last valid value during transient
    // invalid states (e.g. empty string while user is typing a new value)
    if (Number.isFinite(parsed)) {
      mu = parsed
      on_mu_change?.(parsed)
    }
  }
</script>

<DraggablePane
  bind:show={controls_open}
  open_icon="Cross"
  closed_icon="Settings"
  pane_props={{ class: `fermi-controls` }}
  toggle_props={{ class: `controls-toggle`, title: `Fermi surface controls` }}
>
  <SettingsSection
    title="Chemical Potential"
    current_values={{ mu }}
    on_reset={() => {
      mu = 0
      on_mu_change?.(0)
    }}
  >
    <label>
      <span>μ offset (eV):</span>
      <input
        type="range"
        min="-1"
        max="1"
        step="0.01"
        value={mu}
        oninput={handle_mu_change}
      />
      <input
        type="number"
        step="0.01"
        value={mu}
        oninput={handle_mu_change}
        style="width: 4em"
      />
    </label>
    {#if fermi_data}
      <small>E_F = {fermi_data.fermi_energy.toFixed(3)} eV</small>
    {/if}
  </SettingsSection>

  {#if available_bands.length > 0}
    <SettingsSection
      title="Bands"
      current_values={{ selected_bands }}
      on_reset={() => {
        selected_bands = [...available_bands]
      }}
    >
      <div class="band-checkboxes">
        {#each available_bands as band_idx (band_idx)}
          <label class="band-checkbox">
            <input
              type="checkbox"
              checked={selected_bands?.includes(band_idx)}
              onchange={() => toggle_band(band_idx)}
            />
            <span>Band {band_idx}</span>
          </label>
        {/each}
      </div>
      <div class="band-actions">
        <button type="button" onclick={() => (selected_bands = [...available_bands])}>
          All
        </button>
        <button type="button" onclick={() => (selected_bands = [])}>None</button>
      </div>
    </SettingsSection>
  {/if}

  <SettingsSection
    title="Appearance"
    current_values={{ color_property, representation, surface_opacity }}
    on_reset={() => {
      color_property = `band`
      representation = `solid`
      surface_opacity = 0.8
    }}
  >
    <label>
      <span>Color by:</span>
      <select bind:value={color_property}>
        <option value="band">Band</option>
        <option value="velocity">Velocity</option>
        <option value="spin">Spin</option>
      </select>
    </label>
    {#if color_property === `velocity`}
      <label>
        <span>Color scale:</span>
        <select bind:value={color_scale}>
          {#each color_scales as scale (scale.value)}
            <option value={scale.value}>{scale.label}</option>
          {/each}
        </select>
      </label>
    {/if}
    <label>
      <span>Style:</span>
      <select bind:value={representation}>
        <option value="solid">Solid</option>
        <option value="wireframe">Wireframe</option>
        <option value="transparent">Transparent</option>
      </select>
    </label>
    <label>
      <span>Opacity:</span>
      <input type="range" min="0.1" max="1" step="0.05" bind:value={surface_opacity} />
      <span class="value">{surface_opacity.toFixed(2)}</span>
    </label>
  </SettingsSection>

  <SettingsSection
    title="Brillouin Zone"
    current_values={{ show_bz, bz_opacity, show_vectors, tile_bz }}
    on_reset={() => {
      show_bz = true
      bz_opacity = 0.1
      show_vectors = true
      tile_bz = false
    }}
  >
    <label>
      <span>Show BZ:</span>
      <input type="checkbox" bind:checked={show_bz} />
    </label>
    {#if show_bz}
      <label>
        <span>BZ Opacity:</span>
        <input type="range" min="0" max="0.5" step="0.01" bind:value={bz_opacity} />
        <span class="value">{bz_opacity.toFixed(2)}</span>
      </label>
    {/if}
    <label>
      <span>Show Vectors:</span>
      <input type="checkbox" bind:checked={show_vectors} />
    </label>
    <label
      title="Tile Fermi surface from irreducible part to fill full Brillouin zone using symmetry"
    >
      <span>Tile to full BZ:</span>
      <input type="checkbox" bind:checked={tile_bz} />
    </label>
  </SettingsSection>

  <SettingsSection
    title="Clipping Plane"
    current_values={{ clip_enabled, clip_axis, clip_position, clip_flip }}
    on_reset={() => {
      clip_enabled = false
      clip_axis = `z`
      clip_position = 0
      clip_flip = false
    }}
  >
    <label>
      <span>Enable:</span>
      <input type="checkbox" bind:checked={clip_enabled} />
    </label>
    {#if clip_enabled}
      <label>
        <span>Axis:</span>
        <select bind:value={clip_axis}>
          <option value="x">X</option>
          <option value="y">Y</option>
          <option value="z">Z</option>
        </select>
      </label>
      <label>
        <span>Position:</span>
        <input
          type="range"
          min="-1"
          max="1"
          step="0.01"
          bind:value={clip_position}
        />
        <span class="value">{clip_position.toFixed(2)}</span>
      </label>
      <label>
        <span>Flip:</span>
        <input type="checkbox" bind:checked={clip_flip} />
      </label>
    {/if}
  </SettingsSection>

  {#if band_data}
    <SettingsSection
      title="Interpolation"
      current_values={{ interpolation_factor }}
      on_reset={() => {
        interpolation_factor = 1
        on_interpolation_change?.(1)
      }}
    >
      <label>
        <span>Grid density:</span>
        <select
          value={interpolation_factor}
          onchange={(event) => {
            const val = parseFloat((event.target as HTMLSelectElement).value)
            if (!Number.isFinite(val)) return
            interpolation_factor = val
            on_interpolation_change?.(val)
          }}
        >
          <option value={1}>1× (original)</option>
          <option value={1.5}>1.5×</option>
          <option value={2}>2×</option>
          <option value={3}>3×</option>
          <option value={4}>4×</option>
        </select>
      </label>
      <small>Higher = smoother surface, slower</small>
    </SettingsSection>
  {/if}

  <SettingsSection title="Export" current_values={{}}>
    <div class="export-buttons">
      <button
        type="button"
        onclick={() => on_export?.(`stl`)}
        title="Export as STL (3D printing)"
      >
        STL
      </button>
      <button
        type="button"
        onclick={() => on_export?.(`obj`)}
        title="Export as OBJ (Wavefront)"
      >
        OBJ
      </button>
      <button
        type="button"
        onclick={() => on_export?.(`gltf`)}
        title="Export as GLTF (web/AR)"
      >
        GLTF
      </button>
    </div>
    <small>Export visible Fermi surfaces</small>
  </SettingsSection>

  <SettingsSection
    title="Camera"
    current_values={{ camera_projection }}
    on_reset={() => {
      camera_projection = `perspective`
    }}
  >
    <label>
      <span>Projection:</span>
      <select bind:value={camera_projection}>
        <option value="perspective">Perspective</option>
        <option value="orthographic">Orthographic</option>
      </select>
    </label>
  </SettingsSection>

  {@render children?.({ fermi_data, band_data })}
</DraggablePane>

<style>
  .band-checkboxes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5em;
  }
  .band-checkbox {
    display: flex;
    align-items: center;
    gap: 0.3em;
    font-size: 0.9em;
  }
  .band-actions {
    display: flex;
    gap: 0.5em;
    margin-top: 0.5em;
  }
  .band-actions button {
    padding: 0.2em 0.6em;
    font-size: 0.85em;
  }
  small {
    color: var(--text-color-muted, #888);
    font-size: 0.85em;
  }
  label {
    display: flex;
    align-items: center;
    gap: 0.5em;
    flex-wrap: wrap;
  }
  .value {
    min-width: 3em;
    font-family: monospace;
    font-size: 0.9em;
  }
  .export-buttons {
    display: flex;
    gap: 0.5em;
  }
  .export-buttons button {
    padding: 0.3em 0.8em;
    font-size: 0.85em;
    background: var(--btn-bg, #4488cc);
    color: white;
    border: none;
    border-radius: 3pt;
    cursor: pointer;
  }
  .export-buttons button:hover {
    background: var(--btn-bg-hover, #3377bb);
  }
</style>
