<script lang="ts">
  import type { InfoPaneRow, ViewerPaneOptions } from '$lib/overlays'
  import { info_pane_icon, ViewerPane } from '$lib/overlays'
  import InfoPaneCards from '$lib/overlays/InfoPaneCards.svelte'
  import { format_num, trajectory_property_config } from '$lib/labels'
  import { format_bytes, strip_html } from '$lib/utils'
  import { array_extent } from '$lib/math'
  import type { TrajectoryFrame, TrajectoryMetadata, TrajectoryRun } from './index'
  import {
    extract_label_and_unit,
    get_frame_step_samples,
    get_frame_time_step,
    summarize_properties,
  } from './plotting'

  let {
    run,
    current_step_idx,
    current_frame = null,
    property_rows,
    properties_complete,
    pane_open = $bindable(false),
    toggle_props,
    ...pane_options
  }: ViewerPaneOptions & {
    run: TrajectoryRun
    current_step_idx: number
    current_frame?: TrajectoryFrame | null
    // Session-mirrored: run.properties is rune-free (see run.ts). Fallback for standalone mounts.
    property_rows?: readonly TrajectoryMetadata[]
    properties_complete?: boolean
    pane_open?: boolean
  } = $props()

  let rows = $derived(property_rows ?? run.properties.rows)
  let rows_complete = $derived(properties_complete ?? run.properties.complete)

  type Section = { title: string; items: InfoPaneRow[] }

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
  ): InfoPaneRow | null => (value ? { label, value, key, tooltip } : null)

  // oxlint-disable-next-line eslint-plugin-unicorn/prefer-native-coercion-functions -- type predicate needed for narrowing
  const is_info_item = (item: unknown): item is InfoPaneRow => Boolean(item)

  // Drop a section whose items all filtered out as falsy
  const section = (title: string, items: unknown[]): Section | null => {
    const valid_items = items.filter(is_info_item)
    return valid_items.length > 0 ? { title, items: valid_items } : null
  }

  // Properties lead the statistics in this order (substring match on the lower-cased key);
  // anything else follows alphabetically, capped so a 30-column LAMMPS log stays readable here
  // and the data inspector carries the rest
  const STAT_PRIORITY = [`energy`, `temperature`, `pressure`, `volume`, `density`, `force`]
  const MAX_STAT_SECTIONS = 8
  const stat_rank = (key: string): number => {
    const rank = STAT_PRIORITY.findIndex((token) => key.toLowerCase().includes(token))
    return rank === -1 ? STAT_PRIORITY.length : rank
  }

  let total_frames = $derived(run.frame_count)
  let step_samples = $derived(get_frame_step_samples(rows))
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

    const covered_frames = rows.length
    const is_sample = covered_frames < total_frames
    const sampled_note = is_sample
      ? `Min/max over ${format_num(covered_frames, `.3~s`)} sampled frames of ${format_num(
          total_frames,
          `.3~s`,
        )} total, so the true extremum may lie outside this range`
      : undefined
    const suffix = is_sample ? ` (${format_num(covered_frames, `.3~s`)} sampled)` : ``
    // Drift against the run's own step axis, so a dump written every 500 steps and one written
    // every step agree; fluctuation and drift are what tell equilibration from relaxation
    const statistics = total_frames > 1 ? summarize_properties(rows, (row) => row.step) : []
    const stat_sections = statistics
      .filter((stat) => stat.n_samples > 1)
      .toSorted(
        (left, right) =>
          stat_rank(left.key) - stat_rank(right.key) || left.key.localeCompare(right.key),
      )
      .slice(0, MAX_STAT_SECTIONS)
      .map((stat) => {
        const { clean_label, unit } = extract_label_and_unit(
          stat.key,
          trajectory_property_config,
        )
        const label = strip_html(clean_label)
        const relative_drift =
          Math.abs(stat.mean) > 1e-12
            ? ` (${format_num(stat.drift / Math.abs(stat.mean), `+.2~%`)})`
            : ``
        return {
          key: stat.key,
          title: label,
          unit,
          items: [
            safe_item(
              `${label} Range`,
              `${format_range([stat.min, stat.max], unit)}${suffix}`,
              `${stat.key}-range`,
              sampled_note,
            ),
            safe_item(
              `Mean ± σ`,
              `${format_num(stat.mean, `.3~s`)} ± ${format_num(stat.std, `.3~s`)} ${unit}`.trim(),
              `${stat.key}-mean`,
              `Mean and sample standard deviation over ${format_num(stat.n_samples, `.3~s`)} frames`,
            ),
            stat.std > 0 &&
              safe_item(
                `Drift`,
                `${format_num(stat.drift, `+.3~s`)} ${unit}${relative_drift}`.trim(),
                `${stat.key}-drift`,
                `Least-squares slope × run length: the systematic change over the run, as opposed to the fluctuation σ`,
              ),
          ],
        }
      })
    return { step_span, duration, stat_sections }
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
    const { step_span, duration, stat_sections } = run_summary
    const { filename, source_bytes, format } = run.provenance

    return [
      section(`File`, [
        filename && safe_item(`Name`, filename, `file-name`),
        source_bytes &&
          source_bytes > 0 &&
          safe_item(`File Size`, format_bytes(source_bytes), `file-size`),
        format && safe_item(`Format`, format, `file-format`),
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
        rows.length > 0 &&
          safe_item(
            `Property Rows`,
            `${rows.length}${rows_complete ? `` : ` loaded`}`,
            `property-rows`,
            `Frame properties available for plotting and export`,
          ),
      ]),
      // Per-property cards: the displayed frame's value first, then the run statistics
      ...stat_sections.map(({ key, title, unit, items }) => {
        const current = displayed_frame?.metadata?.[key]
        return section(title, [
          is_valid_number(current) &&
            safe_item(
              `Current ${title}`,
              `${format_num(current, `.3~s`)} ${unit}`.trim(),
              `${key}-current`,
            ),
          ...items,
        ])
      }),
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
