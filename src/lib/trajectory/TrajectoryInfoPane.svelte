<script lang="ts">
  import { ViewerPane, info_pane_icon, type ViewerPaneOptions } from '$lib/overlays'
  import type { InfoItem } from '$lib/layout'
  import InfoPaneCards from '$lib/overlays/InfoPaneCards.svelte'
  import { format_bytes, format_num } from '$lib/labels'
  import { array_extent } from '$lib/math'
  import type { TrajectoryFrame, TrajectoryRun } from './index'
  import { get_frame_step_samples, get_frame_time_step } from './plotting'

  let {
    run,
    current_step_idx,
    current_frame = null,
    current_filename,
    current_file_path,
    file_size,
    file_object,
    pane_open = $bindable(false),
    toggle_props,
    ...pane_options
  }: ViewerPaneOptions & {
    run: TrajectoryRun
    current_step_idx: number
    current_frame?: TrajectoryFrame | null
    current_filename?: string | null
    current_file_path?: string | null
    file_size?: number | null
    file_object?: File | null
    pane_open?: boolean
  } = $props()

  type Section = { title: string; items: InfoItem[] }

  const is_valid_number = (val: unknown): val is number =>
    typeof val === `number` && Number.isFinite(val)

  const format_range = (values: number[], unit: string): string | null => {
    if (values.length === 0) return null
    if (values.length === 1) return `${format_num(values[0], `.3~s`)} ${unit}`.trim()
    const [min, max] = array_extent(values)
    return `${format_num(min, `.3~s`)} - ${format_num(max, `.3~s`)} ${unit}`.trim()
  }

  const safe_item = (
    label: string,
    value: string | null,
    key?: string,
    tooltip?: string,
  ): InfoItem | null => (value ? { label, value, key, tooltip } : null)

  // oxlint-disable-next-line eslint-plugin-unicorn/prefer-native-coercion-functions -- type predicate needed for narrowing
  const is_info_item = (item: unknown): item is InfoItem => Boolean(item)

  // Drop a section whose items all filtered out as falsy
  const section = (title: string, items: unknown[]): Section | null => {
    const valid_items = items.filter(is_info_item)
    return valid_items.length > 0 ? { title, items: valid_items } : null
  }

  const RANGE_SECTIONS = [
    { title: `Energy`, prop: `energy`, unit: `eV`, key: `energy`, label: `Energy` },
    { title: `Forces`, prop: `force_max`, unit: `eV/Å`, key: `force`, label: `Force` },
  ] as const

  let total_frames = $derived(run.frame_count)
  let step_samples = $derived(get_frame_step_samples(run.properties.rows))
  let simulation_time_step = $derived(run.time_step?.value ?? null)
  let simulation_time_unit = $derived(run.time_step?.unit ?? ``)

  // Whole-run facts: computed once per trajectory, not per frame. Stepping through a
  // 100k-frame run must not re-scan every frame for min/max energy on each slider tick.
  let run_summary = $derived.by(() => {
    const { frame_numbers, steps } = step_samples
    const [first_step, last_step] = [steps[0], steps.at(-1)]
    const step_span =
      total_frames > 1 &&
      frame_numbers[0] === 0 &&
      frame_numbers.at(-1) === total_frames - 1 &&
      is_valid_number(first_step) &&
      is_valid_number(last_step)
        ? format_range([first_step, last_step], ``)
        : null
    const frame_time_step =
      simulation_time_step && get_frame_time_step(step_samples, simulation_time_step)
    const duration =
      is_valid_number(frame_time_step) && total_frames > 1
        ? `${format_num(frame_time_step * (total_frames - 1), `.3~s`)} ${simulation_time_unit}`
        : null

    const metadata = run.properties.rows
    const covered_frames = metadata.length
    const is_sample = covered_frames < total_frames
    const can_aggregate = total_frames > 1 && metadata.length > 1
    const sampled_note = is_sample
      ? `Min/max over ${format_num(covered_frames, `.3~s`)} sampled frames of ${format_num(
          total_frames,
          `.3~s`,
        )} total, so the true extremum may lie outside this range`
      : undefined
    const aggregate_values = (prop: string): number[] =>
      metadata.map(({ properties }) => properties[prop]).filter(is_valid_number)
    const range_item = (label: string, values: number[], unit: string, key: string) => {
      const range = format_range(values, unit)
      if (!range) return null
      const suffix = is_sample ? ` (${format_num(covered_frames, `.3~s`)} sampled)` : ``
      return safe_item(label, `${range}${suffix}`, key, sampled_note)
    }

    const ranges = RANGE_SECTIONS.map(({ prop, unit, key, label }) => {
      const values = can_aggregate ? aggregate_values(prop) : []
      return values.length > 1
        ? range_item(`${label} Range`, values, unit, `${key}-range`)
        : null
    })

    let volume_section: Section | null = null
    if (can_aggregate) {
      const volumes = aggregate_values(`volume`).filter((volume) => volume > 0)
      if (volumes.length > 1) {
        const [min_volume, max_volume] = array_extent(volumes)
        // A fixed cell would otherwise render a zero-width `125 - 125 Å³` range. volumes is
        // already filtered to finite positives, so the ratio is finite and non-negative.
        const vol_change = (max_volume - min_volume) / min_volume
        volume_section = section(`Volume`, [
          min_volume < max_volume && range_item(`Volume Range`, volumes, `Å³`, `volume-range`),
          vol_change > 0.1 &&
            safe_item(`Volume Change`, `${format_num(vol_change, `.2~%`)}`, `vol-change`),
        ])
      }
    }
    return { step_span, duration, ranges, volume_section }
  })

  let info_pane_data = $derived.by((): Section[] => {
    if (total_frames === 0 || current_step_idx < 0 || current_step_idx >= total_frames) {
      return []
    }
    const displayed_frame = current_frame ?? (current_step_idx === 0 ? run.preview : null)
    const current_time =
      displayed_frame && simulation_time_step
        ? displayed_frame.step * simulation_time_step
        : null
    const { step_span, duration, ranges, volume_section } = run_summary

    return [
      section(`File`, [
        current_filename &&
          safe_item(`Name`, current_filename, `file-name`, current_file_path || undefined),
        file_size &&
          file_size > 0 &&
          safe_item(`File Size`, format_bytes(file_size), `file-size`),
        file_object?.lastModified &&
          safe_item(
            `Modified`,
            new Date(file_object.lastModified).toLocaleString(),
            `file-modified`,
          ),
        run.provenance.format && safe_item(`Format`, run.provenance.format, `file-format`),
      ]),
      section(`Trajectory`, [
        safe_item(
          `Total Frames`,
          `${format_num(total_frames, `.3~s`)} (current: ${format_num(
            current_step_idx + 1,
            `.3~s`,
          )})`,
          `total-frames`,
        ),
        displayed_frame &&
          safe_item(
            `Current Step`,
            format_num(displayed_frame.step, `.3~s`),
            `current-step`,
            `Simulation or ionic step recorded in the source file`,
          ),
        safe_item(`Step Span`, step_span, `step-span`),
        simulation_time_step &&
          safe_item(
            `Time Step`,
            `${format_num(simulation_time_step, `.3~s`)} ${simulation_time_unit}`,
            `time-step`,
            `Simulation time per recorded MD step`,
          ),
        is_valid_number(current_time) &&
          safe_item(
            `Current Time`,
            `${format_num(current_time, `.3~s`)} ${simulation_time_unit}`,
            `current-time`,
          ),
        safe_item(`Duration`, duration, `duration`),
        run.properties.rows.length > 0 &&
          safe_item(
            `Property Rows`,
            `${run.properties.rows.length}${run.properties.complete ? `` : ` loaded`}`,
            `property-rows`,
            `Frame properties available for plotting and export`,
          ),
      ]),
      ...RANGE_SECTIONS.map(({ title, prop, unit, key, label }, range_idx) => {
        const range = ranges[range_idx]
        if (!range) return null
        const current = displayed_frame?.metadata?.[prop]
        return section(title, [
          is_valid_number(current) &&
            safe_item(
              prop === `energy` ? `Current Energy` : `Max ${label}`,
              `${format_num(current, `.3~s`)} ${unit}`,
              `${key}-current`,
            ),
          range,
        ])
      }),
      volume_section,
    ].filter((entry): entry is Section => entry !== null)
  })

  let info_cards = $derived(info_pane_data.map(({ title, items }) => ({ title, rows: items })))
  let n_info_items = $derived(
    info_pane_data.reduce((count, { items }) => count + items.length, 0),
  )
</script>

<ViewerPane
  bind:open={pane_open}
  pane_name="trajectory info"
  class_prefix="trajectory-info"
  max_width="24em"
  toggle_props={{
    'aria-label': pane_open ? `Close trajectory info` : `Open trajectory info`,
    ...toggle_props,
  }}
  closed_icon={info_pane_icon}
  {...pane_options}
>
  <!-- ViewerPane keeps children mounted while hidden; without this gate a closed pane would
    rebuild every card on each frame of playback -->
  {#if pane_open}
    <InfoPaneCards
      title="Trajectory Info"
      cards={info_cards}
      filter_placeholder="Filter trajectory info"
      empty_label="trajectory info"
      collapsible_filter
      show_filter={n_info_items > 5}
      style="--info-card-accent: 0"
    />
  {/if}
</ViewerPane>
