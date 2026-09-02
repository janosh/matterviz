<script lang="ts">
  import { ISO_COLORMAP_SELECT_PROPS } from '$lib/isosurface/coloring'
  import { format_num } from '$lib/labels'
  import { SettingsGroup, SettingsSection } from '$lib/layout'
  import { ColorScaleSelect } from '$lib/plot'
  import { ControlPane } from '$lib/overlays'
  import type { SceneExportFormat } from '$lib/scene'
  import { DEFAULTS } from '$lib/settings'
  import { make_change_detector, parse_num_token } from '$lib/utils'
  import { untrack, type Snippet } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import type { BandGridData, FermiSurfaceData, FermiSurfaceSettings } from './types'

  const defaults = DEFAULTS.fermi

  let {
    controls_open = $bindable(false),
    fermi_data,
    band_data,
    mu = $bindable(defaults.mu),
    color_property = $bindable(defaults.color_property),
    color_scale = $bindable(defaults.color_scale),
    custom_property_label,
    representation = $bindable(defaults.representation),
    surface_opacity = $bindable(defaults.surface_opacity),
    selected_bands = $bindable(),
    show_bz = $bindable(defaults.show_bz),
    bz_opacity = $bindable(defaults.bz_opacity),
    show_vectors = $bindable(defaults.show_vectors),
    tile_bz = $bindable(defaults.tile_bz),
    // Clipping plane
    clip_enabled = $bindable(defaults.clip_enabled),
    clip_axis = $bindable(defaults.clip_axis),
    clip_position = $bindable(defaults.clip_position),
    clip_flip = $bindable(defaults.clip_flip),
    // Interpolation
    interpolation_factor = $bindable(defaults.interpolation_factor),
    // Camera
    camera_projection = $bindable(defaults.camera_projection),
    on_export,
    children,
  }: Partial<FermiSurfaceSettings> & {
    controls_open?: boolean
    fermi_data?: FermiSurfaceData
    band_data?: BandGridData
    // Label for the per-vertex property (e.g. "Fermi velocity", "λ(k)", "DOS")
    custom_property_label?: string
    selected_bands?: number[]
    on_export?: (format: SceneExportFormat) => void
    children?: Snippet<[{ fermi_data?: FermiSurfaceData; band_data?: BandGridData }]>
  } = $props()

  const export_formats = [
    [`stl`, `3D printing`],
    [`obj`, `Wavefront`],
    [`glb`, `web/AR`],
  ] as const

  // Per-vertex scalars (Fermi velocity, orbital character, …) are only colourable when some
  // sheet carries them
  let has_property = $derived(
    fermi_data?.isosurfaces.some((iso) => iso.properties?.length) ?? false,
  )

  let available_bands = $derived(
    fermi_data
      ? [...new SvelteSet(fermi_data.isosurfaces.map((iso) => iso.band_index))].toSorted(
          (left, right) => left - right,
        )
      : [],
  )
  const available_bands_changed = make_change_detector()

  const sync_bindable_defaults = (bands_changed = false): void => {
    if (color_property === `property` && !has_property)
      color_property = defaults.color_property
    if (available_bands.length > 0 && (selected_bands === undefined || bands_changed)) {
      selected_bands = [...available_bands]
    }
  }

  untrack(sync_bindable_defaults)
  $effect(() => sync_bindable_defaults(available_bands_changed(available_bands.join(`,`))))

  function toggle_band(band_idx: number): void {
    const bands = selected_bands ?? []
    selected_bands = bands.includes(band_idx)
      ? bands.filter((band) => band !== band_idx)
      : [...bands, band_idx].toSorted((left, right) => left - right)
  }

  function handle_mu_change(event: Event & { currentTarget: HTMLInputElement }) {
    const parsed = parse_num_token(event.currentTarget.value)
    // Only update mu when input is valid; keep last valid value during transient
    // invalid states (e.g. empty string while user is typing a new value)
    if (Number.isFinite(parsed)) mu = parsed
  }
</script>

<ControlPane
  bind:controls_open
  pane_class="fermi-controls"
  toggle_class="controls-toggle"
  pane_style="--ctrl-label-w: 8.5em; --ctrl-value-w: 4em;"
  toggle_style=""
  toggle_props={{ title: `Fermi surface controls` }}
>
  <SettingsGroup title="Surface" open>
    <SettingsSection
      title="Chemical potential"
      current_values={{ mu }}
      on_reset={() => (mu = defaults.mu)}
      layout="grid"
    >
      <label>
        <span>μ offset (eV)</span>
        <input
          type="number"
          step="0.01"
          value={mu}
          oninput={handle_mu_change}
          style="width: 4em"
        />
        <input
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={mu}
          oninput={handle_mu_change}
        />
      </label>
      {#if fermi_data}
        <small>E_F = {format_num(fermi_data.fermi_energy, `.3f`)} eV</small>
      {/if}
    </SettingsSection>

    {#if available_bands.length > 0}
      <SettingsSection
        title="Bands"
        current_values={{ selected_bands }}
        on_reset={() => (selected_bands = [...available_bands])}
        layout="grid"
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
      current_values={{ color_property, color_scale, representation, surface_opacity }}
      on_reset={() =>
        ({ color_property, color_scale, representation, surface_opacity } = defaults)}
      layout="grid"
    >
      <label>
        <span>Color by</span>
        <select bind:value={color_property}>
          <option value="band">Band</option>
          <option value="spin">Spin</option>
          {#if has_property}
            <option value="property">{custom_property_label ?? `Property`}</option>
          {/if}
        </select>
      </label>
      {#if color_property === `property`}
        <label>
          <span>Color scale</span>
          <ColorScaleSelect
            {...ISO_COLORMAP_SELECT_PROPS}
            bind:value={color_scale}
            selected={[color_scale]}
            aria-label="Fermi surface color scale"
          />
        </label>
      {/if}
      <label>
        <span>Style</span>
        <select bind:value={representation}>
          <option value="solid">Solid</option>
          <option value="wireframe">Wireframe</option>
          <option value="transparent">Transparent</option>
        </select>
      </label>
      <label>
        <span>Opacity</span>
        <span class="value">{format_num(surface_opacity, `.2f`)}</span>
        <input type="range" min="0.1" max="1" step="0.05" bind:value={surface_opacity} />
      </label>
    </SettingsSection>

    <SettingsSection
      title="Brillouin zone"
      current_values={{ show_bz, bz_opacity, show_vectors, tile_bz }}
      on_reset={() => ({ show_bz, bz_opacity, show_vectors, tile_bz } = defaults)}
      layout="grid"
    >
      <label>
        <span>Show BZ</span>
        <input type="checkbox" bind:checked={show_bz} />
      </label>
      {#if show_bz}
        <label>
          <span>BZ opacity</span>
          <span class="value">{format_num(bz_opacity, `.2f`)}</span>
          <input type="range" min="0" max="0.5" step="0.01" bind:value={bz_opacity} />
        </label>
      {/if}
      <label>
        <span>Show vectors</span>
        <input type="checkbox" bind:checked={show_vectors} />
      </label>
      <label
        title="Tile Fermi surface from irreducible part to fill full Brillouin zone using symmetry"
      >
        <span>Tile to full BZ</span>
        <input type="checkbox" bind:checked={tile_bz} />
      </label>
    </SettingsSection>

    <SettingsSection
      title="Clipping plane"
      current_values={{ clip_enabled, clip_axis, clip_position, clip_flip }}
      on_reset={() => ({ clip_enabled, clip_axis, clip_position, clip_flip } = defaults)}
      layout="grid"
    >
      <label>
        <span>Enable</span>
        <input type="checkbox" bind:checked={clip_enabled} />
      </label>
      {#if clip_enabled}
        <label>
          <span>Axis</span>
          <select bind:value={clip_axis}>
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="z">Z</option>
          </select>
        </label>
        <label>
          <span>Position</span>
          <span class="value">{format_num(clip_position, `.2f`)}</span>
          <input type="range" min="-1" max="1" step="0.01" bind:value={clip_position} />
        </label>
        <label>
          <span>Flip</span>
          <input type="checkbox" bind:checked={clip_flip} />
        </label>
      {/if}
    </SettingsSection>

    {#if band_data}
      <SettingsSection
        title="Interpolation"
        current_values={{ interpolation_factor }}
        on_reset={() => (interpolation_factor = defaults.interpolation_factor)}
        layout="grid"
      >
        <label>
          <span>Grid density</span>
          <select bind:value={interpolation_factor}>
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
  </SettingsGroup>

  <SettingsSection title="Export" layout="grid">
    <div class="export-buttons">
      {#each export_formats as [format, blurb] (format)}
        <button
          type="button"
          onclick={() => on_export?.(format)}
          title="Export as {format.toUpperCase()} ({blurb})"
        >
          {format.toUpperCase()}
        </button>
      {/each}
    </div>
    <small>Export visible Fermi surfaces</small>
  </SettingsSection>

  <SettingsSection
    title="Camera"
    current_values={{ camera_projection }}
    on_reset={() => ({ camera_projection } = defaults)}
    layout="grid"
  >
    <label>
      <span>Projection</span>
      <select bind:value={camera_projection}>
        <option value="perspective">Perspective</option>
        <option value="orthographic">Orthographic</option>
      </select>
    </label>
  </SettingsSection>

  {@render children?.({ fermi_data, band_data })}
</ControlPane>

<style>
  :is(.band-checkboxes, .band-actions, .export-buttons, small) {
    grid-column: 1 / -1;
  }
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
  :is(.band-actions, .export-buttons) {
    display: flex;
    gap: 0.5em;
  }
  .band-actions {
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
  .value {
    min-width: 3em;
    font-family: monospace;
    font-size: 0.9em;
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
