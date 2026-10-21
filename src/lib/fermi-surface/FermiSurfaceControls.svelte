<script lang="ts">
  import { track_settings } from '#lib/controls.js'
  import { ISO_COLORMAP_SELECT_PROPS } from '#lib/isosurface/coloring.js'
  import { format_num } from '#lib/labels.js'
  import { SettingsGroup, SettingsSection } from '#lib/layout/index.js'
  import { ColorScaleSelect } from '#lib/plot/index.js'
  import { ControlPane } from '#lib/overlays/index.js'
  import CameraSection from '#lib/scene/CameraSection.svelte'
  import { DEFAULTS } from '#lib/settings.js'
  import { resolve_value_range, to_color_scale_config } from '#lib/plot/core/scales.js'
  import { make_change_detector, parse_num_token } from '#lib/utils.js'
  import type { ShortcutScope } from '#lib/shortcuts.js'
  import { untrack, type Snippet } from 'svelte'
  import type { Vec2 } from '#lib/math.js'
  import { property_label } from './constants'
  import { available_property_names } from './geometry'
  import type { BandGridData, FermiSurfaceData, FermiSurfaceSettings } from './types'

  const defaults = DEFAULTS.fermi

  let {
    controls_open = $bindable(false),
    fermi_data,
    band_data,
    mu: chemical_potential = $bindable(defaults.mu),
    color_property = $bindable(defaults.color_property),
    color_scale = $bindable(defaults.color_scale),
    property_name = $bindable(),
    fitted_value_range,
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
    shortcut_scopes,
    children,
  }: Partial<FermiSurfaceSettings> & {
    controls_open?: boolean
    fermi_data?: FermiSurfaceData
    band_data?: BandGridData
    property_name?: string // coloured by in `property` mode (default: the first present)
    fitted_value_range?: Vec2 // placeholder for the color_scale.value_range ends left unset
    custom_property_label?: string // label of the unnamed property, e.g. "Fermi velocity"
    selected_bands?: number[]
    shortcut_scopes?: readonly ShortcutScope[] // listed at the bottom of the pane
    children?: Snippet<[{ fermi_data?: FermiSurfaceData; band_data?: BandGridData }]>
  } = $props()

  // color_scale's scheme and value_range, edited in place by the select and range inputs
  const color_scale_config = $derived(to_color_scale_config(color_scale))
  const set_value_range = (value_range: Vec2 | undefined): void => {
    if (value_range || color_scale_config.value_range) {
      color_scale = { ...color_scale_config, value_range }
    }
  }

  // per-vertex scalars (Fermi velocity, λ_nk, Δ_nk, …) the data carries
  let available_properties = $derived(available_property_names(fermi_data, band_data))
  let has_property = $derived(available_properties.length > 0)

  let available_bands = $derived(
    fermi_data
      ? [...new Set(fermi_data.isosurfaces.map((iso) => iso.band_index))].toSorted(
          (left, right) => left - right,
        )
      : [],
  )
  const available_bands_changed = make_change_detector()

  // Bands switched off stay off when a mu change alters which bands cross E_F, even after one
  // stops crossing and crosses again; newly crossing bands start visible
  let previous_bands: number[] = []
  const hidden_bands = new Set<number>()
  const sync_bindable_defaults = (bands_changed = false): void => {
    if (color_property === `property` && !has_property)
      color_property = defaults.color_property
    // A property the new data lacks falls back to the first one, and its fixed range with it
    if (!available_properties.includes(property_name ?? ``)) {
      if (property_name !== undefined) set_value_range(undefined)
      property_name = available_properties[0]
    }
    if (available_bands.length > 0 && (selected_bands === undefined || bands_changed)) {
      // a band crossing before but not shown now was hidden; one shown now is not
      if (selected_bands) {
        for (const band of previous_bands) hidden_bands.add(band)
        for (const band of selected_bands) hidden_bands.delete(band)
      }
      selected_bands = available_bands.filter((band) => !hidden_bands.has(band))
    }
    previous_bands = available_bands
  }

  untrack(sync_bindable_defaults)
  $effect(() => sync_bindable_defaults(available_bands_changed(available_bands.join(`,`))))

  // An emptied field returns to auto; one typed bound keeps the fitted value for the other. A
  // partial entry (`-`, `1e`) also reads as `` but is flagged by badInput: keep the range.
  function set_color_bound(
    bound_idx: 0 | 1,
    event: Event & { currentTarget: HTMLInputElement },
  ) {
    const { value, validity } = event.currentTarget
    if (validity.badInput) return
    const parsed = parse_num_token(value)
    if (Number.isFinite(parsed)) {
      const range = resolve_value_range(color_scale, fitted_value_range ?? [0, 1])
      range[bound_idx] = parsed
      set_value_range(range)
    } else if (value.trim() === ``) set_value_range(undefined)
  }

  // also forgets bands hidden while they did not cross
  function show_all_bands(): void {
    hidden_bands.clear()
    selected_bands = [...available_bands]
  }

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
    if (Number.isFinite(parsed)) chemical_potential = parsed
  }

  const mu_settings = track_settings(() => ({ mu: chemical_potential }), defaults)
  const bands_settings = $derived(
    track_settings(() => ({ selected_bands }), { selected_bands: available_bands }),
  )
  const appearance_settings = track_settings(
    () => ({ color_property, color_scale, representation, surface_opacity }),
    defaults,
  )
  const bz_settings = track_settings(
    () => ({ show_bz, bz_opacity, show_vectors, tile_bz }),
    defaults,
  )
  const clip_settings = track_settings(
    () => ({ clip_enabled, clip_axis, clip_position, clip_flip }),
    defaults,
  )
  const interpolation_settings = track_settings(() => ({ interpolation_factor }), defaults)
</script>

<ControlPane
  bind:controls_open
  pane_class="fermi-controls"
  toggle_class="controls-toggle"
  pane_style="--ctrl-label-w: 8.5em; --ctrl-value-w: 4em;"
  toggle_style=""
  toggle_props={{ title: `Fermi surface controls` }}
  {shortcut_scopes}
>
  <SettingsGroup title="Surface" open>
    {#if fermi_data}
      <small>E<sub>F</sub> = {format_num(fermi_data.fermi_energy, `.3f`)} eV</small>
    {/if}
    {#if band_data}
      <SettingsSection
        title="Chemical potential"
        changed_keys={mu_settings.changed_keys}
        on_reset={() => (chemical_potential = defaults.mu)}
        layout="grid"
      >
        <label>
          <span>μ offset (eV)</span>
          <input
            type="number"
            step="0.01"
            value={chemical_potential}
            oninput={handle_mu_change}
            style="width: 4em"
          />
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={chemical_potential}
            oninput={handle_mu_change}
          />
        </label>
      </SettingsSection>
    {/if}

    {#if available_bands.length > 0}
      <div class="bands">
        <SettingsSection
          title="Bands"
          changed_keys={bands_settings.changed_keys}
          on_reset={show_all_bands}
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
                <span>Band {band_idx + 1}</span>
              </label>
            {/each}
          </div>
        </SettingsSection>
        <div class="band-actions">
          <button type="button" onclick={show_all_bands}>All</button>
          <button type="button" onclick={() => (selected_bands = [])}>None</button>
        </div>
      </div>
    {/if}

    <SettingsSection
      title="Appearance"
      changed_keys={appearance_settings.changed_keys}
      on_reset={() => {
        ;({ color_property, color_scale, representation, surface_opacity } = defaults)
      }}
      layout="grid"
    >
      <label>
        <span>Color by</span>
        <select bind:value={color_property}>
          <option value="band">Band</option>
          <option value="spin">Spin</option>
          {#if has_property}
            <option value="property">
              {available_properties.length === 1
                ? property_label(available_properties[0], custom_property_label)
                : `Property`}
            </option>
          {/if}
        </select>
      </label>
      {#if color_property === `property`}
        {#if available_properties.length > 1}
          <label>
            <span>Property</span>
            <select
              bind:value={property_name}
              onchange={() => set_value_range(undefined)}
              aria-label="Fermi surface colouring property"
            >
              {#each available_properties as name (name)}
                <option value={name}>{property_label(name, custom_property_label)}</option>
              {/each}
            </select>
          </label>
        {/if}
        <label>
          <span>Color scale</span>
          <ColorScaleSelect
            {...ISO_COLORMAP_SELECT_PROPS}
            bind:value={color_scale}
            aria-label="Fermi surface color scale"
          />
        </label>
        <label title="Fixed colour-scale bounds; leave empty to fit the visible surfaces">
          <span>Range</span>
          <span style="display: flex; gap: 0.3em">
            {#each [0, 1] as const as bound_idx (bound_idx)}
              <input
                type="number"
                step="any"
                style="width: 4.5em"
                value={color_scale_config.value_range?.[bound_idx] ?? ``}
                placeholder={fitted_value_range
                  ? format_num(fitted_value_range[bound_idx], `.3~g`)
                  : ``}
                oninput={(event) => set_color_bound(bound_idx, event)}
                aria-label={`Colour range ${bound_idx ? `max` : `min`}`}
              />
            {/each}
          </span>
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
      changed_keys={bz_settings.changed_keys}
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
      changed_keys={clip_settings.changed_keys}
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
        changed_keys={interpolation_settings.changed_keys}
        on_reset={() => (interpolation_factor = defaults.interpolation_factor)}
        layout="grid"
      >
        <label>
          <span>Grid density</span>
          <select bind:value={interpolation_factor}>
            <option value={0}>Auto</option>
            <option value={1}>1× (original)</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2×</option>
            <option value={3}>3×</option>
            <option value={4}>4×</option>
          </select>
        </label>
        <small
          >Auto refines coarse k-meshes to ~48 points per axis. Higher = smoother, slower</small
        >
      </SettingsSection>
    {/if}
  </SettingsGroup>

  <CameraSection bind:camera_projection default_projection={defaults.camera_projection} />

  {@render children?.({ fermi_data, band_data })}
</ControlPane>

<style>
  :is(.band-checkboxes, .band-actions, small) {
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
  /* All/None on the Bands heading row, between its title and Reset: the heading's children
     join this grid, the section body spans the row below */
  .bands {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    column-gap: 0.5em;
    > :global(.settings-section-heading) {
      display: contents;
    }
    > :global(.settings-section) {
      grid-area: 2 / 1 / 3 / -1;
    }
    :global(.heading-actions) {
      grid-area: 1 / 3;
    }
  }
  .band-actions {
    grid-area: 1 / 2;
    display: flex;
    gap: 0.5em;
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
</style>
