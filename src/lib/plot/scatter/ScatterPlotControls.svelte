<script lang="ts">
  import { track_settings } from '$lib/controls'
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import PlotControls from '$lib/plot/core/components/PlotControls.svelte'
  import type {
    DataSeries,
    PlotConfig,
    PlotControlsProps,
    StyleOverrides,
  } from '$lib/plot/core/types'
  import { DEFAULT_MARKERS } from '$lib/plot/core/types'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import { tooltip } from 'svelte-widgets/attachments'

  let {
    series = [],
    x_axis = $bindable({}),
    x2_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable({}),
    styles = $bindable({}),
    selected_series_idx = $bindable(0),
    // Declared explicitly (rather than left to ...rest) so the host can bind them and
    // observe the pane being shown/opened, matching BarPlotControls
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    on_touch,
    children,
    ...rest
  }: Omit<PlotControlsProps, `children` | `post_children`> & {
    series?: readonly DataSeries[]
    styles?: StyleOverrides
    selected_series_idx?: number
    // Reports a style key the user changed (is_touched) or reset back to untouched, so the
    // host only overrides authored per-series styles for keys the user actually set
    on_touch?: (key: string, is_touched: boolean) => void
    children?: Snippet<
      [{ styles: StyleOverrides; selected_series_idx: number } & Required<PlotConfig>]
    >
  } = $props()

  let non_null_series = $derived(series.filter((srs) => srs != null))
  const selected_series = $derived(series[selected_series_idx])
  const has_color_data = $derived(selected_series?.color_values?.some((val) => val != null))
  const has_size_data = $derived(selected_series?.size_values?.some((val) => val != null))

  const touch = ({ target }: Event) => {
    if (!(target instanceof Element)) return
    const key = target.closest(`[data-key]`)?.getAttribute(`data-key`)
    if (key) on_touch?.(key, true)
  }

  // Reset restores the defaults in the pane and untouches every key, so authored
  // per-series styles show again instead of being overridden by the defaults
  const reset_style = (kind: `point` | `line`) => () => {
    styles[kind] = { ...DEFAULTS.scatter[kind] }
    for (const key of Object.keys(DEFAULTS.scatter[kind])) on_touch?.(`${kind}.${key}`, false)
  }

  const style_sections = [
    {
      kind: `point`,
      title: `Point style`,
      description: `Toggle visibility of data points in the scatter plot`,
      settings: track_settings(() => styles.point ?? {}, DEFAULTS.scatter.point),
      rows: [
        [`size`, `color`, `opacity`],
        [`stroke_width`, `stroke_color`, `stroke_opacity`],
      ],
    },
    {
      kind: `line`,
      title: `Line style`,
      description: `Toggle visibility of connecting lines between data points`,
      settings: track_settings(() => styles.line ?? {}, DEFAULTS.scatter.line),
      rows: [[`width`, `color`, `dash`, `opacity`]],
    },
  ] as const
  // Availability is plot-wide; manual styling applies only to the selected series.
  const available_styles = $derived(
    style_sections.filter(({ kind }) =>
      non_null_series.some(
        (srs) =>
          (srs.visible ?? true) &&
          (srs.markers ?? DEFAULT_MARKERS).includes(kind === `point` ? `points` : `line`),
      ),
    ),
  )
  const visible_styles = $derived(
    available_styles.filter(({ kind }) => styles[`show_${kind}s`]),
  )
  const numeric_fields = {
    size: { label: `Size`, min: 1, max: 20, step: 0.5 },
    width: { label: `Width`, min: 0.5, max: 10, step: 0.5 },
    opacity: { label: `Opacity`, min: 0, max: 1, step: 0.05 },
    stroke_width: { label: `Stroke`, min: 0, max: 5, step: 0.1 },
    stroke_opacity: { label: `Stroke opacity`, min: 0, max: 1, step: 0.05 },
  }
  const style_values = (
    kind: `point` | `line`,
  ): StyleOverrides[`point`] & StyleOverrides[`line`] => styles[kind]
</script>

<PlotControls
  bind:x_axis
  bind:x2_axis
  bind:y_axis
  bind:y2_axis
  bind:display
  bind:show_controls
  bind:controls_open
  display_extra_values={{
    show_points: styles.show_points,
    show_lines: styles.show_lines,
  }}
  on_display_extra_reset={() => {
    styles.show_points = DEFAULTS.scatter.show_points
    styles.show_lines = DEFAULTS.scatter.show_lines
  }}
  {...rest}
>
  {@render children?.({
    x_axis,
    x2_axis,
    y_axis,
    y2_axis,
    display,
    styles,
    selected_series_idx,
  })}

  {#snippet display_children()}
    {#each available_styles as { kind, description } (kind)}
      <label {@attach tooltip({ content: description })}>
        <input type="checkbox" bind:checked={styles[`show_${kind}s`]} />
        Show {kind}s
      </label>
    {/each}
  {/snippet}

  {#snippet post_children()}
    {#if non_null_series.length > 1 && visible_styles.length}
      <SettingsSection title="Style target" class="ctrl-line" layout="flow">
        <label>
          <span>Series</span>
          <select bind:value={selected_series_idx}>
            {#each series as srs, idx (idx)}
              {#if srs}<option value={idx}>{srs.label || `Series ${idx + 1}`}</option>{/if}
            {/each}
          </select>
        </label>
      </SettingsSection>
    {/if}
    {#each visible_styles as { kind, title, rows, settings } (kind)}
      {@const style = style_values(kind)}
      <SettingsSection
        {title}
        changed_keys={settings.changed_keys}
        on_reset={reset_style(kind)}
        oninput={touch}
      >
        {#if style}
          {#each rows as fields}
            <div class="style-row">
              {#each fields as key (key)}
                {#if (key !== `size` || !has_size_data) && (key !== `color` || !has_color_data)}
                  {#if key === `color` || key === `stroke_color`}
                    <label data-key={`${kind}.${key}`}>
                      <span>Color</span>
                      <input type="color" bind:value={style[key]} />
                    </label>
                  {:else if key === `dash`}
                    <label data-key="line.dash">
                      <span>Style</span>
                      <select bind:value={style.dash}>
                        <option value="solid">Solid</option>
                        <option value="4,4">Dashed</option>
                        <option value="2,2">Dotted</option>
                        <option value="8,4,2,4">Dash-dot</option>
                      </select>
                    </label>
                  {:else}
                    {@const { label, ...limits } = numeric_fields[key]}
                    <NumberRangeInput
                      {...limits}
                      data-key={`${kind}.${key}`}
                      bind:value={style[key]}>{label}</NumberRangeInput
                    >
                  {/if}
                {/if}
              {/each}
            </div>
          {/each}
        {/if}
      </SettingsSection>
    {/each}
  {/snippet}
</PlotControls>
