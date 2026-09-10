<script lang="ts">
  import { track_settings } from '$lib/controls'
  import { SettingsGroup, SettingsSection } from '$lib/layout'
  import { format_num } from '$lib/labels'
  import { ControlPane } from '$lib/overlays'
  import { DEFAULTS } from '$lib/settings'
  import type { BrillouinZoneSettings } from './types'

  const defaults = DEFAULTS.brillouin

  let {
    controls_open = $bindable(false),
    bz_order = $bindable(defaults.bz_order),
    surface_color = $bindable(defaults.surface_color),
    surface_opacity = $bindable(defaults.surface_opacity),
    edge_color = $bindable(defaults.edge_color),
    edge_width = $bindable(defaults.edge_width),
    show_vectors = $bindable(defaults.show_vectors),
    camera_projection = $bindable(defaults.camera_projection),
    // Irreducible BZ options
    show_ibz = $bindable(defaults.show_ibz),
    ibz_color = $bindable(defaults.ibz_color),
    ibz_opacity = $bindable(defaults.ibz_opacity),
  }: Partial<Omit<BrillouinZoneSettings, `vector_scale`>> & {
    controls_open?: boolean
  } = $props()

  const brillouin_zone_controls_settings = track_settings(
    () => ({ bz_order, show_vectors }),
    defaults,
  )
  const surface_settings = track_settings(() => ({ surface_color, surface_opacity }), defaults)
  const edges_settings = track_settings(() => ({ edge_color, edge_width }), defaults)
  const irreducible_bz_settings = track_settings(
    () => ({ show_ibz, ibz_color, ibz_opacity }),
    defaults,
  )
  const camera_settings = track_settings(() => ({ camera_projection }), defaults)
</script>

<ControlPane
  bind:controls_open
  pane_class="bz-controls"
  toggle_class="controls-toggle"
  pane_style="--ctrl-label-w: 7.5em; --ctrl-value-w: 3.5em;"
  toggle_style=""
  toggle_props={{ title: `Brillouin zone controls` }}
>
  <SettingsGroup title="Geometry" open>
    <SettingsSection
      title="Brillouin zone controls"
      changed_keys={brillouin_zone_controls_settings.changed_keys}
      on_reset={() => ({ bz_order, show_vectors } = defaults)}
      layout="grid"
    >
      <label>
        <span>Order</span>
        <select bind:value={bz_order}>
          <option value={1}>1st BZ</option>
          <option value={2}>2nd BZ</option>
          <option value={3}>3rd BZ</option>
        </select>
      </label>
      <label>
        <span>Show vectors</span>
        <input type="checkbox" bind:checked={show_vectors} />
      </label>
    </SettingsSection>

    <SettingsSection
      title="Surface"
      changed_keys={surface_settings.changed_keys}
      on_reset={() => ({ surface_color, surface_opacity } = defaults)}
      layout="grid"
    >
      <label>
        <span>Color</span>
        <input type="color" bind:value={surface_color} />
      </label>
      <label>
        <span>Opacity</span>
        <span>{format_num(surface_opacity, `.2f`)}</span>
        <input type="range" min="0" max="1" step="0.01" bind:value={surface_opacity} />
      </label>
    </SettingsSection>

    <SettingsSection
      title="Edges"
      changed_keys={edges_settings.changed_keys}
      on_reset={() => ({ edge_color, edge_width } = defaults)}
      layout="grid"
    >
      <label>
        <span>Color</span>
        <input type="color" bind:value={edge_color} />
      </label>
      <label>
        <span>Width</span>
        <span>{format_num(edge_width, `.3f`)}</span>
        <input type="range" min="0.002" max="0.02" step="0.001" bind:value={edge_width} />
      </label>
    </SettingsSection>

    <SettingsSection
      title="Irreducible BZ"
      changed_keys={irreducible_bz_settings.changed_keys}
      on_reset={() => ({ show_ibz, ibz_color, ibz_opacity } = defaults)}
      layout="grid"
    >
      <label>
        <span>Show IBZ</span>
        <input type="checkbox" bind:checked={show_ibz} />
      </label>
      {#if show_ibz}
        <label>
          <span>Color</span>
          <input type="color" bind:value={ibz_color} />
        </label>
        <label>
          <span>Opacity</span>
          <span>{format_num(ibz_opacity, `.2f`)}</span>
          <input type="range" min="0" max="1" step="0.01" bind:value={ibz_opacity} />
        </label>
      {/if}
    </SettingsSection>
  </SettingsGroup>

  <SettingsSection
    title="Camera"
    changed_keys={camera_settings.changed_keys}
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
</ControlPane>
