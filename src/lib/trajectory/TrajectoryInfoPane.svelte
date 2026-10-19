<script module lang="ts">
  import type { InfoPaneCard, InfoPaneRow } from '#lib/overlays/index.js'
  import {
    display_idx,
    format_num,
    trajectory_property_config,
    zero_if_negligible,
  } from '#lib/labels.js'
  import { format_bytes } from 'svelte-widgets/format'
  import { array_extent } from '#lib/math.js'
  import type { TrajectoryFrame, TrajectoryMetadata, TrajectoryRun } from './index'
  import {
    extract_label_and_unit,
    get_frame_step_samples,
    get_frame_time_step,
    summarize_properties,
  } from './plotting'

  const is_valid_number = (val: unknown): val is number =>
    typeof val === `number` && Number.isFinite(val)

  const format_range = (values: number[], unit: string): string | null => {
    if (values.length === 0) return null
    if (values.length === 1) return `${format_num(values[0], `.3~s`)} ${unit}`.trim()
    const [min, max] = array_extent(values)
    const magnitude = Math.max(Math.abs(min), Math.abs(max))
    const [low, high] = [min, max].map((value) => zero_if_negligible(value, magnitude))
    return `${format_num(low, `.3~s`)} - ${format_num(high, `.3~s`)} ${unit}`.trim()
  }

  const safe_item = (
    label: string,
    value: string | null,
    key?: string,
    tooltip?: string,
  ): InfoPaneRow | null => (value ? { label, value, key, tooltip } : null)
  const fmt = (value: number): string => format_num(value, `.3~s`)

  // oxlint-disable-next-line eslint-plugin-unicorn/prefer-native-coercion-functions -- type predicate needed for narrowing
  const is_info_item = (item: unknown): item is InfoPaneRow => Boolean(item)

  // Drop a section whose items all filtered out as falsy
  const section = (title: string, items: unknown[]): InfoPaneCard | null => {
    const valid_items = items.filter(is_info_item)
    return valid_items.length > 0 ? { title, rows: valid_items } : null
  }

  // Properties lead the statistics in this order (substring match on the lower-cased key);
  // anything else follows alphabetically, capped so a 30-column LAMMPS log stays readable here
  // and the data inspector carries the rest
  const STAT_PRIORITY = [`energy`, `temperature`, `pressure`, `volume`, `density`, `force`]
  const MAX_STAT_ROWS = 12
  const stat_rank = (key: string): number => {
    const rank = STAT_PRIORITY.findIndex((token) => key.toLowerCase().includes(token))
    return rank === -1 ? STAT_PRIORITY.length : rank
  }

  // Whole-run facts, for the caller to derive once per trajectory rather than per frame:
  // stepping through a 100k-frame run must not re-scan every frame for min/max energy on each
  // slider tick. Shared by the info pane and the data inspector's Info tab.
  export const summarize_run_info = (
    run: TrajectoryRun,
    rows: readonly TrajectoryMetadata[],
  ) => {
    const total_frames = run.frame_count
    const step_samples = get_frame_step_samples(rows)
    const simulation_time_step = run.time_step?.value ?? null
    const simulation_time_unit = run.time_step?.unit ?? ``
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

    // Drift against the run's own step axis, so a dump written every 500 steps and one written
    // every step agree; fluctuation and drift are what tell equilibration from relaxation
    const statistics = total_frames > 1 ? summarize_properties(rows, (row) => row.step) : []
    const stat_rows = statistics
      .filter((stat) => stat.n_samples > 1)
      .toSorted(
        (left, right) =>
          stat_rank(left.key) - stat_rank(right.key) || left.key.localeCompare(right.key),
      )
      .slice(0, MAX_STAT_ROWS)
      .map(({ key, min, max, mean, std, drift }) => {
        const { clean_label, unit } = extract_label_and_unit(key, trajectory_property_config)
        const magnitude = Math.max(Math.abs(min), Math.abs(max))
        const [low, high] = [min, max].map((val) => zero_if_negligible(val, magnitude))
        return {
          key,
          // the unit rides on the label once rather than on every value
          label: unit ? `${clean_label} <small>${unit}</small>` : clean_label,
          cells: [
            format_num(mean, `.4~s`),
            format_num(std, `.2~s`),
            std > 0 ? format_num(drift, `+.2~s`) : ``,
          ],
          // 6 digits keep a narrow range apart (−789.391 to −789.389)
          range: `${format_num(low, `.6~s`)} to ${format_num(high, `.6~s`)} ${unit}`.trim(),
        }
      })
    // A sample's min/max may miss the run's extremes
    const sampled =
      rows.length < total_frames &&
      `${fmt(rows.length)} of ${fmt(total_frames)} frames sampled`
    return { step_span, duration, stat_rows, sampled }
  }

  // The info cards of the displayed frame: file, run timing, then per-property statistics
  export const trajectory_info_cards = ({
    run,
    rows,
    rows_complete,
    current_step_idx,
    current_frame,
    summary,
  }: {
    run: TrajectoryRun
    rows: readonly TrajectoryMetadata[]
    rows_complete: boolean
    current_step_idx: number
    current_frame: TrajectoryFrame | null
    summary: ReturnType<typeof summarize_run_info>
  }): InfoPaneCard[] => {
    const total_frames = run.frame_count
    const simulation_time_step = run.time_step?.value ?? null
    const simulation_time_unit = run.time_step?.unit ?? ``
    if (total_frames === 0 || current_step_idx < 0 || current_step_idx >= total_frames) {
      return []
    }
    const displayed_frame = current_frame ?? (current_step_idx === 0 ? run.preview : null)
    const frame_num = display_idx(current_step_idx)
    const current_time =
      displayed_frame && simulation_time_step
        ? displayed_frame.step * simulation_time_step
        : null
    const { step_span, duration, stat_rows, sampled } = summary
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
          `${format_num(total_frames, `.3~s`)} (current: ${format_num(frame_num, `.3~s`)})`,
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
      // One row per property (the Global tab has the displayed frame's values)
      stat_rows.length > 0 && {
        title: `Statistics`,
        subtitle: sampled || undefined,
        columns: [
          { label: `Mean`, tooltip: `Mean over the run` },
          { label: `σ`, tooltip: `Sample standard deviation: the fluctuation about the mean` },
          {
            label: `Drift`,
            tooltip: `Least-squares slope × run length: the systematic change over the run, as opposed to the fluctuation σ`,
          },
        ],
        rows: stat_rows.map(({ key, label, cells, range }) => ({
          key,
          label,
          value: cells,
          // the true extremes may lie outside a sample's
          tooltip: `Range ${range}${sampled ? ` over the ${sampled}` : ``}`,
        })),
      },
    ].filter((entry) => entry !== null && entry !== false)
  }
</script>

<script lang="ts">
  import type { ViewerPaneOptions } from '#lib/overlays/index.js'
  import { info_pane_icon, ViewerPane } from '#lib/overlays/index.js'
  import InfoPaneCards from '#lib/overlays/InfoPaneCards.svelte'

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
  // Whole-run facts once per trajectory, the cards once per displayed frame
  let summary = $derived(summarize_run_info(run, rows))
  let info_pane_data = $derived(
    trajectory_info_cards({
      run,
      rows,
      rows_complete,
      current_step_idx,
      current_frame,
      summary,
    }),
  )

  let n_info_items = $derived(
    info_pane_data.reduce((count, card) => count + card.rows.length, 0),
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
      cards={info_pane_data}
      filter_placeholder="Filter trajectory info"
      empty_label="trajectory info"
      collapsible_filter
      show_filter={n_info_items > 5}
      style="--info-card-accent: 0"
    />
  {/if}
</ViewerPane>
