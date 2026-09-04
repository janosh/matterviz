<script lang="ts">
  import { ControlPane, type PaneProps, type PaneToggleProps } from '$lib/overlays'
  import type { D3InterpolateName } from '$lib/colors'
  import { format_num } from '$lib/labels'
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import { sanitize_html } from '$lib/sanitize'
  import { ColorScaleSelect } from '$lib/plot'
  import { tooltip } from 'svelte-widgets/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { marker_path_data } from './canvas-draw'
  import { get_entry_category } from './helpers'
  import type { EnergyModeInfo, EnergySourceMode } from './hull-state.svelte'
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

  // Face color mode button labels and tooltips
  const FACE_COLOR_MODES: Record<HullFaceColorMode, [label: string, tip: string]> = {
    uniform: [`Uniform`, `Single uniform color for all faces`],
    formation_energy: [`Energy`, `Color by average formation energy of face vertices`],
    dominant_element: [
      `Element`,
      `Color by element with highest concentration at face centroid`,
    ],
    facet_index: [`Index`, `Distinct categorical color per facet`],
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
    // Hull face settings only exist for 3D/4D; the row renders when show_hull_faces is set
    show_hull_faces = $bindable(),
    hull_face_color = $bindable(),
    hull_face_opacity = $bindable(),
    hull_face_color_mode = $bindable(),
    max_hull_dist_show_phases = $bindable(0),
    max_hull_dist_show_labels = $bindable(0.1),
    max_hull_dist_in_data = 0.5,
    energy_source_mode = $bindable(`precomputed`),
    energy_info,
    stable_entries,
    unstable_entries,
    camera,
    merged_controls,
    controls_open = $bindable(false),
    toggle_props = {},
    pane_props = {},
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
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
    hull_face_color?: string
    hull_face_opacity?: number
    hull_face_color_mode?: HullFaceColorMode
    // Read formation energies + hull distances from the entries or compute them on the fly;
    // the toggle only renders when energy_info says both options are viable
    energy_source_mode?: EnergySourceMode
    energy_info?: EnergyModeInfo
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

  // Clickable legend entries (stable/unstable points, category filters): a `.marker` swatch
  // class for the point rows, an SVG path for the per-category marker shapes
  type LegendItem = {
    key: string
    active: boolean
    text: string
    tip: string
    toggle: () => void
    marker?: `stable` | `unstable`
    path?: string
  }
  const SWATCH_RADIUS = 4.4 // marker swatch radius, sized to fit the 12x12 viewBox
  const count_suffix = (count: string | number) =>
    merged_controls.show_counts ? ` (${count})` : ``
  let point_items = $derived<LegendItem[]>([
    {
      key: `stable`,
      marker: `stable`,
      active: show_stable,
      text: `Stable${count_suffix(stable_entries.length)}`,
      tip: `Toggle visibility of stable points`,
      toggle: () => (show_stable = !show_stable),
    },
    {
      key: `unstable`,
      marker: `unstable`,
      active: show_unstable,
      text: `Above hull${count_suffix(
        `${show_unstable ? unstable_entries.length : 0}/${unstable_entries.length}`,
      )}`,
      tip: `Toggle visibility of above-hull points`,
      toggle: () => (show_unstable = !show_unstable),
    },
  ])
  // Category filters: only category values present in the (threshold-filtered) data
  let category_items = $derived.by((): LegendItem[] => {
    const category = entry_category
    if (!category) return []
    const counts: Record<string, number> = {}
    for (const entry of [...stable_entries, ...unstable_entries]) {
      const value = get_entry_category(entry, category)
      if (value) counts[value] = (counts[value] ?? 0) + 1
    }
    return Object.keys(category.markers)
      .filter((value) => counts[value])
      .map((value) => {
        const hidden = hidden_categories.includes(value)
        const long_name = category.labels?.[value]
        return {
          key: value,
          active: !hidden,
          text: `${value}${count_suffix(hidden ? `0/${counts[value]}` : counts[value])}`,
          tip: `Toggle visibility of ${
            long_name ? `${long_name.toLowerCase()} (${value})` : value
          } entries`,
          toggle: () => {
            hidden_categories = hidden
              ? hidden_categories.filter((other) => other !== value)
              : [...hidden_categories, value]
          },
          path: marker_path_data(SWATCH_RADIUS, category.markers[value]) ?? ``,
        }
      })
  })

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

  // One mutually exclusive toggle button per option
  type ToggleOption = readonly [text: string, tip: string, active: boolean, select: () => void]
  let face_color_options = $derived(
    HULL_FACE_COLOR_MODES.map((mode): ToggleOption => [
      ...FACE_COLOR_MODES[mode],
      hull_face_color_mode === mode,
      () => (hull_face_color_mode = mode),
    ]),
  )
</script>

<!-- Buttons sit directly in the row's grid tracks unless `wrap_class` groups them in one cell -->
{#snippet toggle_buttons(options: readonly ToggleOption[])}
  {#each options as [text, tip, active, select] (text)}
    <button
      class={[`toggle-btn`, active && `active`]}
      onclick={select}
      {@attach tooltip({ allow_html: true, content: tip })}
    >
      {text}
    </button>
  {/each}
{/snippet}

{#snippet toggle_row(label: string, options: readonly ToggleOption[], wrap_class?: string)}
  <div class="setting">
    <span class="control-label">{label}</span>
    {#if wrap_class}
      <div class={wrap_class}>{@render toggle_buttons(options)}</div>
    {:else}
      {@render toggle_buttons(options)}
    {/if}
  </div>
{/snippet}

{#snippet legend_row(label: string, items: readonly LegendItem[], container_class?: string)}
  <div class="setting">
    <span class="control-label">{label}</span>
    <div class={[`legend-items-container`, container_class]}>
      {#each items as { key, active, text, tip, toggle, marker, path } (key)}
        <div
          class={[`legend-item`, active ? `active` : `inactive`]}
          onclick={toggle}
          onkeydown={(evt) => {
            // preventDefault stops Space scrolling the page
            if (![`Enter`, ` `].includes(evt.key)) return
            evt.preventDefault()
            toggle()
          }}
          role="button"
          tabindex="0"
          aria-pressed={active}
          {@attach tooltip({ content: tip })}
        >
          {#if marker}
            <div class={[`marker`, marker]}></div>
          {:else}
            <svg viewBox="-6 -6 12 12" width="12" height="12" aria-hidden="true">
              <path d={path} />
            </svg>
          {/if}
          <span>{text}</span>
        </div>
      {/each}
    </div>
  </div>
{/snippet}

<ControlPane
  bind:controls_open
  controls_name="convex-hull"
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
    <!-- Energy source selection (only if both options are available and nothing forces a rebuild) -->
    {#if energy_info?.corrections_active && energy_info.can_compute}
      <div class="setting">
        <span class="control-label">Energy source</span>
        <span
          style="opacity: 0.75"
          title="Temperature or gas-pressure corrections shift the raw energies, so formation energies and hull distances are recomputed on the fly"
          >On the fly (T / P corrections active)</span
        >
      </div>
    {:else if energy_info?.has_precomputed_e_form && energy_info.has_precomputed_hull && energy_info.can_compute}
      {@render toggle_row(
        `Energy source`,
        [
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
        ],
        `energy-source-buttons`,
      )}
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
      <NumberRangeInput
        min={0}
        max={max_hull_dist_in_data}
        step={0.01}
        bind:value={max_hull_dist_show_phases}
        title="Points threshold (eV/atom)"
        style="gap: 4px; flex: 1"
        number_props={{
          'aria-label': `Points threshold (eV/atom)`,
          style: `border: 1px solid var(--border-color, rgba(0, 0, 0, 0.2))`,
        }}>eV/atom</NumberRangeInput
      >
    </div>

    {#if color_mode === `stability`}
      {@render legend_row(`Points`, point_items)}
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
    {#if entry_category && category_items.length > 0}
      {@render legend_row(entry_category.label, category_items, `category-filters`)}
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
          <input type="checkbox" bind:checked={show_hull_faces} />
          <span>Show</span>
        </label>
        <div style="display: flex; gap: 6px; align-items: center; flex: 1">
          {#if hull_face_color_mode === `uniform`}
            <input
              type="color"
              bind:value={hull_face_color}
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
            {@attach tooltip({ content: `Hull face opacity (0 = transparent, 1 = opaque)` })}
            style="flex: 1; min-width: 60px"
          />
          <span style="font-size: 0.9em; min-width: 2.6em; text-align: right"
            >{format_num(hull_face_opacity ?? 0, `.1%`)}</span
          >
        </div>
      </div>

      {@render toggle_row(`Face color`, face_color_options, `face-color-mode-buttons`)}
    {/if}

    {#if camera}
      <div class="setting">
        <span class="control-label">Camera</span>
        <div class="camera-fields">
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
    background: var(--hull-stable-color, #0072b2);
  }
  .marker.unstable {
    background: var(--hull-unstable-color, #e69f00);
  }
  /* Button groups and paired inputs do not fit the 4em value track, so they take the value
     and wide tracks together and wrap inside that span when the pane is narrow */
  .face-color-mode-buttons,
  .energy-source-buttons,
  .camera-fields {
    grid-column: 2 / -1;
    display: flex;
    gap: 4px;
    flex: 1;
    flex-wrap: wrap;
    button {
      min-width: auto;
      flex: 0 1 auto;
    }
  }
  .camera-fields {
    gap: 4px 10px;
    label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
  }
  .color-scale-row {
    :global(.multiselect) {
      --sms-min-height: 24px;
    }
  }
</style>
