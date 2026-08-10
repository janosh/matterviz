<script lang="ts">
  import { ControlPane, type PaneProps, type PaneToggleProps } from '$lib/overlays'
  import type { D3InterpolateName } from '$lib/colors'
  import { format_num } from '$lib/labels'
  import { SettingsSection } from '$lib/layout'
  import { sanitize_html } from '$lib/sanitize'
  import { ColorScaleSelect } from '$lib/plot'
  import { tooltip } from 'svelte-widgets/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { get_entry_category, marker_path_data } from './helpers'
  import type {
    ConvexHullControlsType,
    ConvexHullEntry,
    EntryCategoryConfig,
    HullFaceColorMode,
  } from './types'
  import { HULL_FACE_COLOR_MODES, MAGNETIC_ORDERING_CATEGORY } from './types'

  interface CameraState {
    elevation?: number // Elevation angle in degrees (for ternary)
    azimuth?: number // Azimuth angle in degrees (for ternary)
    rotation_x?: number // X rotation in radians (for quaternary)
    rotation_y?: number // Y rotation in radians (for quaternary)
    zoom: number
    center_x: number
    center_y: number
  }

  // Face color mode display labels and tooltips
  const FACE_COLOR_MODES: Record<HullFaceColorMode, { label: string; tip: string }> = {
    uniform: { label: `Uniform`, tip: `Single uniform color for all faces` },
    formation_energy: {
      label: `Energy`,
      tip: `Color by average formation energy of face vertices`,
    },
    dominant_element: {
      label: `Element`,
      tip: `Color by element with highest concentration at face centroid`,
    },
    facet_index: { label: `Index`, tip: `Distinct categorical color per facet` },
  }

  let {
    color_mode = $bindable(`stability`),
    color_scale = $bindable(`interpolateViridis`),
    show_stable = $bindable(true),
    show_unstable = $bindable(true),
    entry_category = MAGNETIC_ORDERING_CATEGORY,
    hidden_categories = $bindable([]),
    show_stable_labels = $bindable(true),
    show_unstable_labels = $bindable(false),
    show_hull_faces = undefined,
    on_hull_faces_change,
    hull_face_color = `#0072B2`,
    on_hull_face_color_change,
    hull_face_opacity = $bindable(0.03),
    on_hull_face_opacity_change,
    hull_face_color_mode = `uniform` as HullFaceColorMode,
    on_hull_face_color_mode_change,
    max_hull_dist_show_phases = $bindable(0),
    max_hull_dist_show_labels = $bindable(0.1),
    max_hull_dist_in_data = 0.5,
    energy_source_mode = $bindable(`precomputed`),
    has_precomputed_hull = false,
    can_compute_hull = false,
    has_precomputed_e_form = false,
    can_compute_e_form = false,
    stable_entries,
    unstable_entries,
    camera,
    merged_controls,
    controls_open = $bindable(false),
    toggle_props = {},
    pane_props = {},
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `onclose`> & {
    // Display controls
    color_mode?: `stability` | `energy`
    color_scale?: D3InterpolateName
    show_stable?: boolean
    show_unstable?: boolean
    // Categorical classification rendered as filter toggles (null disables the row)
    entry_category?: EntryCategoryConfig | null
    hidden_categories?: string[]
    show_stable_labels?: boolean
    show_unstable_labels?: boolean
    // 3D specific controls
    show_hull_faces?: boolean
    on_hull_faces_change?: (value: boolean) => void
    hull_face_color?: string
    on_hull_face_color_change?: (value: string) => void
    hull_face_opacity?: number
    on_hull_face_opacity_change?: (value: number) => void
    hull_face_color_mode?: HullFaceColorMode
    on_hull_face_color_mode_change?: (value: HullFaceColorMode) => void
    energy_source_mode?: `precomputed` | `on-the-fly` // whether to read formation and above hull distance from entries or compute them on the fly
    has_precomputed_hull?: boolean
    can_compute_hull?: boolean
    has_precomputed_e_form?: boolean
    can_compute_e_form?: boolean
    // Thresholds
    max_hull_dist_show_phases?: number
    max_hull_dist_show_labels?: number
    max_hull_dist_in_data?: number
    // Data for visualization
    stable_entries: ConvexHullEntry[]
    unstable_entries: ConvexHullEntry[]
    // Camera state (optional - only used for 3D/4D diagrams)
    camera?: CameraState
    // Legend configuration
    merged_controls: ConvexHullControlsType
    // Pane state
    controls_open?: boolean
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
  } = $props()

  // Focus the multiselect input next to the "Color scale" label
  function focus_multiselect(evt: Event & { currentTarget: HTMLElement }): void {
    evt.currentTarget.nextElementSibling?.querySelector<HTMLInputElement>(`input`)?.focus()
  }

  // Category filters: only show category values present in the (threshold-filtered) data
  const category_counts = $derived.by(() => {
    const counts: Record<string, number> = {}
    for (const entry of [...stable_entries, ...unstable_entries]) {
      const value = get_entry_category(entry, entry_category)
      if (value) counts[value] = (counts[value] ?? 0) + 1
    }
    return counts
  })
  const category_values_in_data = $derived(
    Object.keys(entry_category?.markers ?? {}).filter(
      (value) => (category_counts[value] ?? 0) > 0,
    ),
  )
  const toggle_category = (value: string) => {
    hidden_categories = hidden_categories.includes(value)
      ? hidden_categories.filter((hidden) => hidden !== value)
      : [...hidden_categories, value]
  }
  const SWATCH_RADIUS = 4.4 // marker swatch radius, sized to fit the 12x12 viewBox
  // Keyboard activation for legend toggles (preventDefault stops Space scrolling the page)
  const legend_keydown = (action: () => void) => (evt: KeyboardEvent) => {
    if (![`Enter`, ` `].includes(evt.key)) return
    evt.preventDefault()
    action()
  }

  // Camera rows by diagram dimensionality: ternary tilts by elevation/azimuth in degrees,
  // quaternary by two rotation angles in radians
  type CameraField = readonly [
    key: keyof CameraState,
    label: string,
    tip: string,
    step: number,
    // digits, not a d3 format: format_num emits a unicode minus that <input type=number> rejects
    digits: number,
    suffix?: string,
    min?: number,
    max?: number,
  ]
  const ELEV_TIP = `Elevation angle (0° = look down z-axis, 90° = side view, 180° = look up z-axis)`
  const TILT_TIP = `Vertical tilt (up/down rotation)`
  const MAX_TILT = Math.PI / 3
  let camera_fields = $derived<readonly CameraField[]>(
    camera?.elevation !== undefined && camera.azimuth !== undefined
      ? [
          [`elevation`, `Elev`, ELEV_TIP, 5, 0, `°`],
          [`azimuth`, `Azim`, `Azimuth rotation around z-axis`, 15, 0, `°`],
        ]
      : [
          [`rotation_x`, `φ`, TILT_TIP, 0.1, 2, undefined, -MAX_TILT, MAX_TILT],
          [`rotation_y`, `θ`, `Horizontal rotation (left/right)`, 0.1, 2],
        ],
  )
  let point_toggles = $derived([
    {
      active: show_stable,
      marker: `stable`,
      label: `Stable${merged_controls.show_counts ? ` (${stable_entries.length})` : ``}`,
      tip: `Toggle visibility of stable points`,
      toggle: () => (show_stable = !show_stable),
    },
    {
      active: show_unstable,
      marker: `unstable`,
      label: `Above hull${
        merged_controls.show_counts
          ? ` (${show_unstable ? unstable_entries.length : 0}/${unstable_entries.length})`
          : ``
      }`,
      tip: `Toggle visibility of above-hull points`,
      toggle: () => (show_unstable = !show_unstable),
    },
  ])

  // One mutually exclusive toggle button per option
  type ToggleOption = readonly [text: string, tip: string, active: boolean, select: () => void]
</script>

{#snippet toggle_row(label: string, options: readonly ToggleOption[])}
  <div class="setting">
    <span class="control-label">{label}</span>
    {#each options as [text, tip, active, select] (text)}
      <button
        class="toggle-btn {active ? `active` : ``}"
        onclick={select}
        {@attach tooltip({ allow_html: true, content: tip })}
      >
        {text}
      </button>
    {/each}
  </div>
{/snippet}

<ControlPane
  bind:controls_open
  controls_class="convex-hull"
  pane_style=""
  toggle_style=""
  toggle_props={{ title: controls_open ? `` : `Convex hull controls`, ...toggle_props }}
  {pane_props}
  {...rest}
>
  <h4>
    {@html sanitize_html(merged_controls.title || `Convex Hull Controls`)}
  </h4>

  <SettingsSection title="Display" layout="grid">
    <!-- Energy source selection (only if both options are available) -->
    {#if has_precomputed_e_form && has_precomputed_hull && can_compute_e_form && can_compute_hull}
      {@render toggle_row(`Energy source`, [
        [
          `Precomputed`,
          `Use precomputed formation energies (E<sub>form</sub>)`,
          energy_source_mode === `precomputed`,
          () => (energy_source_mode = `precomputed`),
        ],
        [
          `On the fly`,
          `Compute formation energies and hull distances on the fly. Note: Missing pure-element reference entries default to E<sub>form</sub> = 0 eV/atom if not provided explicitly.`,
          energy_source_mode === `on-the-fly`,
          () => (energy_source_mode = `on-the-fly`),
        ],
      ])}
    {/if}

    {@render toggle_row(`Color mode`, [
      [
        `Stability`,
        `Color points by stable/unstable`,
        color_mode === `stability`,
        () => (color_mode = `stability`),
      ],
      [
        `Energy`,
        `Color points by energy above hull`,
        color_mode === `energy`,
        () => (color_mode = `energy`),
      ],
    ])}

    <!-- Energy threshold slider - shown in both color modes -->
    <div
      class="setting"
      {@attach tooltip({ content: `Max eV/atom above hull to display unstable points` })}
    >
      <span class="control-label">Points threshold</span>
      <label style="display: flex; align-items: center; gap: 4px; flex: 1">
        <input
          type="number"
          min="0"
          max={max_hull_dist_in_data}
          step="0.01"
          bind:value={max_hull_dist_show_phases}
          aria-label="Points threshold (eV/atom)"
          style="border: 1px solid var(--border-color, rgba(0, 0, 0, 0.2))"
        />
        <span style="white-space: nowrap">eV/atom</span>
        <input
          type="range"
          min="0"
          max={max_hull_dist_in_data}
          step="0.01"
          bind:value={max_hull_dist_show_phases}
        />
      </label>
    </div>

    {#if color_mode === `stability`}
      <div class="setting">
        <span class="control-label">Points</span>
        <div class="legend-items-container">
          {#each point_toggles as { active, marker, label, tip, toggle } (marker)}
            <div
              class="legend-item {active ? `active` : `inactive`}"
              onclick={toggle}
              onkeydown={legend_keydown(toggle)}
              role="button"
              tabindex="0"
              aria-pressed={active}
              {@attach tooltip({ content: tip })}
            >
              <div class="marker {marker}"></div>
              <span>{label}</span>
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <!-- Color scale selector -->
      <div class="setting color-scale-row">
        <span
          {@attach tooltip({ content: `Choose energy colormap` })}
          onclick={focus_multiselect}
          onkeydown={(evt) => {
            if (evt.key === `Enter` || evt.key === ` `) focus_multiselect(evt)
          }}
          role="button"
          tabindex="0"
          style="cursor: pointer">Color scale</span
        >
        <ColorScaleSelect
          bind:value={color_scale}
          selected={[color_scale]}
          placeholder="Select color scale"
          {@attach tooltip({ content: `Set interpolator for energy colors` })}
        />
      </div>
    {/if}

    <!-- Category filters (only when entries carry recognized category data,
    e.g. magnetic orderings with the default MAGNETIC_ORDERING_CATEGORY) -->
    {#if entry_category && category_values_in_data.length > 0}
      <div class="setting">
        <span class="control-label">{entry_category.label}</span>
        <div class="legend-items-container category-filters">
          {#each category_values_in_data as value (value)}
            {@const hidden = hidden_categories.includes(value)}
            {@const count = category_counts[value] ?? 0}
            {@const long_name = entry_category.labels?.[value]}
            <div
              class="legend-item {hidden ? `inactive` : `active`}"
              onclick={() => toggle_category(value)}
              onkeydown={legend_keydown(() => toggle_category(value))}
              role="button"
              tabindex="0"
              aria-pressed={!hidden}
              {@attach tooltip({
                content: `Toggle visibility of ${
                  long_name ? `${long_name.toLowerCase()} (${value})` : value
                } entries`,
              })}
            >
              <svg viewBox="-6 -6 12 12" width="12" height="12" aria-hidden="true">
                <path
                  d={marker_path_data(SWATCH_RADIUS, entry_category.markers[value]) ?? ``}
                />
              </svg>
              <span
                >{value}{merged_controls.show_counts
                  ? ` (${hidden ? `0/${count}` : count})`
                  : ``}</span
              >
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if merged_controls.show_label_controls}
      <div class="setting">
        <span class="control-label">Labels</span>
        <div style="display: flex; gap: 12px; flex: 1">
          <label {@attach tooltip({ content: `Show labels for stable points` })}>
            <input type="checkbox" bind:checked={show_stable_labels} />
            <span>Stable</span>
          </label>
          <label {@attach tooltip({ content: `Show labels for unstable points` })}>
            <input type="checkbox" bind:checked={show_unstable_labels} />
            <span>Unstable</span>
          </label>
        </div>
      </div>

      {#if show_unstable_labels}
        <div
          class="setting"
          {@attach tooltip({ content: `Max eV/atom for labeling unstable points` })}
        >
          <span class="control-label">Label threshold</span>
          <label style="display: flex; align-items: center; gap: 4px; flex: 1">
            <span style="white-space: nowrap"
              >{format_num(max_hull_dist_show_labels, `.2f`)} eV/atom</span
            >
            <input
              type="range"
              min="0"
              max={max_hull_dist_in_data}
              step="0.01"
              bind:value={max_hull_dist_show_labels}
            />
          </label>
        </div>
      {/if}
    {/if}

    <!-- Hull faces toggle (for 3D ternary and 4D quaternary diagrams) -->
    {#if show_hull_faces !== undefined}
      <div class="setting">
        <span class="control-label">Hull faces</span>
        <label {@attach tooltip({ content: `Toggle convex hull faces` })}>
          <input
            type="checkbox"
            checked={show_hull_faces}
            oninput={(event) => on_hull_faces_change?.(event.currentTarget.checked)}
          />
          <span>Show</span>
        </label>
        <div style="display: flex; gap: 6px; align-items: center; flex: 1">
          {#if hull_face_color_mode === `uniform`}
            <input
              type="color"
              value={hull_face_color}
              oninput={(event) => on_hull_face_color_change?.(event.currentTarget.value)}
              {@attach tooltip({ content: `Set hull face color` })}
              style="width: 40px; height: 20px"
            />
          {/if}
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            aria-label="Hull face opacity"
            bind:value={hull_face_opacity}
            oninput={() => on_hull_face_opacity_change?.(hull_face_opacity)}
            {@attach tooltip({ content: `Hull face opacity (0 = transparent, 1 = opaque)` })}
            style="flex: 1; min-width: 80px"
          />
          <span style="font-size: 0.9em; min-width: 2em; text-align: right"
            >{format_num(hull_face_opacity, `.1%`)}</span
          >
        </div>
      </div>

      <!-- Face color mode selector -->
      <div class="setting">
        <span class="control-label">Face color</span>
        <div class="face-color-mode-buttons">
          {#each HULL_FACE_COLOR_MODES as mode (mode)}
            <button
              class="toggle-btn {hull_face_color_mode === mode ? `active` : ``}"
              style="min-width: auto; flex: 0 1 auto"
              onclick={() => on_hull_face_color_mode_change?.(mode)}
              {@attach tooltip({ content: FACE_COLOR_MODES[mode].tip })}
            >
              {FACE_COLOR_MODES[mode].label}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if camera}
      <div class="setting">
        <span class="control-label">Camera</span>
        {#each camera_fields as [key, label, tip, step, digits, suffix, min, max] (key)}
          <label {@attach tooltip({ content: tip })}>
            <span>{label}</span>
            <input
              type="number"
              value={(camera[key] ?? 0).toFixed(digits)}
              {step}
              {min}
              {max}
              oninput={(event) => {
                const camera_value = event.currentTarget.valueAsNumber
                if (camera && Number.isFinite(camera_value)) camera[key] = camera_value
              }}
              style="width: 3em"
            />
            {#if suffix}<span>{suffix}</span>{/if}
          </label>
        {/each}
      </div>
    {/if}
  </SettingsSection>
</ControlPane>

<style>
  :global(.convex-hull-controls-pane) {
    --pane-max-height: max(350px, calc(100cqh - 40px));
    --pane-padding: 1ex;
    --pane-gap: 0;
    --ctrl-label-w: 8em;
    --ctrl-value-w: 4em;
    --settings-row-gap: 8pt;
    font-size: 0.85em;
    pointer-events: auto;
  }
  .control-label {
    font-weight: 500;
  }
  button {
    border: 1px solid var(--border-color, rgba(0, 0, 0, 0.2));
  }
  .toggle-btn.active,
  .toggle-btn:hover.active {
    background: light-dark(rgba(25, 118, 210, 0.15), rgba(100, 180, 255, 0.2));
  }
  .legend-items-container {
    display: flex;
    gap: 12px;
    flex: 1;
  }
  .legend-item {
    display: flex;
    align-items: center;
    border-radius: var(--hull-border-radius, var(--border-radius, 3pt));
    cursor: pointer;
    white-space: nowrap;
  }
  .legend-item:hover {
    background: var(--btn-bg-hover, rgba(0, 0, 0, 0.05));
  }
  .legend-item.inactive {
    opacity: 0.5;
  }
  .category-filters {
    flex-wrap: wrap;
    gap: 8px;
  }
  .legend-item svg {
    margin-right: 4px;
    flex-shrink: 0;
    fill: currentColor;
  }
  .marker {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    margin-right: 8px;
    aspect-ratio: 1;
  }
  .marker.stable {
    background: var(--stable-color, #0072b2);
  }
  .marker.unstable {
    background: var(--unstable-color, #e69f00);
  }
  .face-color-mode-buttons {
    display: flex;
    gap: 4px;
    flex: 1;
    flex-wrap: wrap;
  }
  .color-scale-row {
    :global(.multiselect) {
      --sms-min-height: 24px;
    }
  }
</style>
