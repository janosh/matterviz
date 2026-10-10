<script lang="ts">
  import { enum_options } from '#lib/plot/core/components/PlotControls.svelte'
  import { track_settings } from '#lib/controls.js'
  import { SettingsSection } from '#lib/layout/index.js'
  import type {
    BoxPointMode,
    Orientation,
    PlotConfig,
    ViolinKind,
    ViolinSide,
    WhiskerMode,
  } from '#lib/plot/index.js'
  import { PlotControls } from '#lib/plot/index.js'
  import type { PlotControlsProps } from '#lib/plot/core/types.js'
  import { DEFAULTS, SETTINGS_CONFIG } from '#lib/settings.js'
  import type { Snippet } from 'svelte'

  let {
    orientation = $bindable(`vertical`),
    whisker_mode = $bindable(`tukey`),
    show_outliers = $bindable(true),
    show_mean = $bindable(false),
    points = $bindable(`none`),
    outliers_drawn = true,
    kind = $bindable(`box`),
    side = $bindable(`both`),
    x_axis = $bindable({}),
    x2_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable({}),
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    children,
    ...rest
  }: Omit<PlotControlsProps, `children` | `post_children`> & {
    orientation?: Orientation
    whisker_mode?: WhiskerMode
    show_outliers?: boolean
    show_mean?: boolean
    points?: BoxPointMode
    // Whether any box draws outliers on their own (drawn samples already include them)
    outliers_drawn?: boolean
    kind?: ViolinKind
    side?: ViolinSide
    children?: Snippet<[{ orientation: Orientation } & Required<PlotConfig>]>
  } = $props()

  const box_violin_settings = track_settings(
    () => ({
      orientation,
      kind,
      side,
      whisker_mode,
      show_outliers,
      show_mean,
      points,
    }),
    { orientation: `vertical`, ...DEFAULTS.box },
  )
</script>

<PlotControls
  bind:show_controls
  bind:controls_open
  bind:x_axis
  bind:x2_axis
  bind:y_axis
  bind:y2_axis
  bind:display
  {...rest}
>
  {@render children?.({ orientation, x_axis, x2_axis, y_axis, y2_axis, display })}
  <SettingsSection
    title="Box / violin"
    changed_keys={box_violin_settings.changed_keys}
    on_reset={() =>
      ({ orientation, kind, side, whisker_mode, show_outliers, show_mean, points } =
        box_violin_settings.snapshot())}
    layout="flow"
  >
    <div class="ctrl-line">
      <label>
        <span>Orientation</span>
        <select bind:value={orientation}>
          <option value="vertical">Vertical</option>
          <option value="horizontal">Horizontal</option>
        </select>
      </label>
      <label>
        <span>Glyph</span>
        <select bind:value={kind}>
          {@render enum_options(SETTINGS_CONFIG.box.kind)}
        </select>
      </label>
      {#if kind !== `box`}
        <label>
          <span>Side</span>
          <select bind:value={side}>
            {@render enum_options(SETTINGS_CONFIG.box.side)}
          </select>
        </label>
      {/if}
      <label>
        <span>Whiskers</span>
        <select bind:value={whisker_mode}>
          {@render enum_options(SETTINGS_CONFIG.box.whisker_mode)}
        </select>
      </label>
      <label>
        <span>Points</span>
        <select bind:value={points}>
          {@render enum_options(SETTINGS_CONFIG.box.points)}
        </select>
      </label>
    </div>
    <div class="ctrl-line">
      <label>
        <input type="checkbox" bind:checked={show_outliers} disabled={!outliers_drawn} />
        Show outliers
      </label>
      <label>
        <input type="checkbox" bind:checked={show_mean} />
        Show mean
      </label>
    </div>
  </SettingsSection>
</PlotControls>
