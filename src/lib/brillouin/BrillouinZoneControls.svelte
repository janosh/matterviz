<script lang="ts">
  import { DraggablePane, SettingsSection } from '$lib'

  let {
    controls_open = $bindable(false),
    bz_order = $bindable(1),
    surface_color = $bindable(`#4488ff`),
    surface_opacity = $bindable(0.3),
    edge_color = $bindable(`#000000`),
    edge_width = $bindable(0.05),
    show_vectors = $bindable(true),
    vector_scale = $bindable(1.0),
    camera_projection = $bindable(`perspective`),
  }: {
    controls_open?: boolean
    bz_order?: number
    surface_color?: string
    surface_opacity?: number
    edge_color?: string
    edge_width?: number
    show_vectors?: boolean
    vector_scale?: number
    camera_projection?: `perspective` | `orthographic`
  } = $props()
</script>

<DraggablePane
  bind:show={controls_open}
  open_icon="Cross"
  closed_icon="Settings"
  pane_props={{ class: `bz-controls` }}
  toggle_props={{ class: `controls-toggle`, title: `Brillouin zone controls` }}
>
  <SettingsSection title="Brillouin Zone Order" current_values={{ bz_order }}>
    <label>
      <span>Order:</span>
      <select bind:value={bz_order}>
        <option value={1}>1st BZ</option>
        <option value={2}>2nd BZ</option>
        <option value={3}>3rd BZ</option>
      </select>
    </label>
  </SettingsSection>

  <SettingsSection title="Surface" current_values={{ surface_color, surface_opacity }}>
    <label>
      <span>Color:</span>
      <input type="color" bind:value={surface_color} />
    </label>
    <label>
      <span>Opacity:</span>
      <input type="range" min="0" max="1" step="0.01" bind:value={surface_opacity} />
      <span class="value">{surface_opacity.toFixed(2)}</span>
    </label>
  </SettingsSection>

  <SettingsSection title="Edges" current_values={{ edge_color, edge_width }}>
    <label>
      <span>Color:</span>
      <input type="color" bind:value={edge_color} />
    </label>
    <label>
      <span>Width:</span>
      <input type="range" min="0.01" max="0.2" step="0.01" bind:value={edge_width} />
      <span class="value">{edge_width.toFixed(2)}</span>
    </label>
  </SettingsSection>

  <SettingsSection
    title="Reciprocal Lattice Vectors"
    current_values={{ show_vectors, vector_scale }}
  >
    <label>
      <span>Show Vectors:</span>
      <input type="checkbox" bind:checked={show_vectors} />
    </label>
    {#if show_vectors}
      <label>
        <span>Scale:</span>
        <input type="range" min="0.5" max="2" step="0.1" bind:value={vector_scale} />
        <span class="value">{vector_scale.toFixed(1)}</span>
      </label>
    {/if}
  </SettingsSection>

  <SettingsSection title="Camera" current_values={{ camera_projection }}>
    <label>
      <span>Projection:</span>
      <select bind:value={camera_projection}>
        <option value="perspective">Perspective</option>
        <option value="orthographic">Orthographic</option>
      </select>
    </label>
  </SettingsSection>
</DraggablePane>

<style>
  label {
    display: flex;
    align-items: center;
    gap: 1ex;
    justify-content: space-between;
  }
  label > span:first-child {
    flex: 1;
  }
  label input[type='range'] {
    flex: 2;
    min-width: 100px;
  }
  label input[type='color'] {
    width: 60px;
    height: 30px;
    border: none;
    cursor: pointer;
  }
  label input[type='checkbox'] {
    width: 20px;
    height: 20px;
    cursor: pointer;
  }
  label select {
    flex: 1;
    padding: 4px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    background: var(--surface-bg);
    color: var(--text-color);
  }
  .value {
    font-family: monospace;
    font-size: 0.9em;
    min-width: 3em;
    text-align: right;
  }
</style>
