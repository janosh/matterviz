<script lang="ts">
  import { Cross, Info } from 'svelte-widgets/icons'
  import { DraggablePane, type PaneProps, type PaneToggleProps } from '$lib/overlays'
  import type { InfoItem } from '$lib/layout'
  import InfoPaneCards from '$lib/overlays/InfoPaneCards.svelte'
  import { format_bytes, format_num } from '$lib/labels'
  import { array_extent } from '$lib/math'
  import { get_electro_neg_formula } from '$lib/composition'
  import { SETTINGS_CONFIG } from '$lib/settings'
  import type { AnyStructure } from '$lib/structure'
  import type { ComponentProps } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import type { TrajectoryFrame, TrajectoryType } from './index'

  let {
    trajectory,
    current_step_idx,
    current_frame = null,
    current_filename,
    current_file_path,
    file_size,
    file_object,
    pane_open = $bindable(false),
    toggle_props,
    pane_props,
    ...rest
  }: Omit<ComponentProps<typeof DraggablePane>, `children`> & {
    trajectory: TrajectoryType
    current_step_idx: number
    current_frame?: TrajectoryFrame | null
    current_filename?: string | null
    current_file_path?: string | null
    file_size?: number | null
    file_object?: File | null
    pane_open?: boolean
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
  } = $props()

  const is_valid_number = (val: unknown): val is number =>
    typeof val === `number` && Number.isFinite(val)

  const extract_numeric_array = (frames: typeof trajectory.frames, prop: string) =>
    frames.map((frame) => frame.metadata?.[prop]).filter(is_valid_number)

  const format_range = (values: number[], unit = ``, decimals = `.2~f`) => {
    if (values.length === 0) return null
    if (values.length === 1) {
      return `${format_num(values[0], decimals)} ${unit}`.trim()
    }
    const [min, max] = array_extent(values)
    return `${format_num(min, decimals)} - ${format_num(max, decimals)} ${unit}`.trim()
  }

  const safe_item = (
    label: string,
    value: string | null,
    key?: string,
    tooltip?: string,
  ): InfoItem | null => (value ? { label, value, key, tooltip } : null)

  // oxlint-disable-next-line eslint-plugin-unicorn/prefer-native-coercion-functions -- type predicate needed for narrowing
  const is_info_item = (item: unknown): item is InfoItem => Boolean(item)

  const safe_formula = (structure: AnyStructure) => {
    try {
      return get_electro_neg_formula(structure)
    } catch {
      return null
    }
  }

  // Get trajectory info organized by sections
  let info_pane_data = $derived.by(() => {
    if (
      (!trajectory?.frames?.length && !trajectory?.total_frames) ||
      current_step_idx < 0 ||
      current_step_idx >= (trajectory.total_frames ?? trajectory.frames?.length ?? 0)
    )
      return []

    // For indexed trajectories, the resolved frame may live outside sparse frame arrays.
    const displayed_frame = current_frame ?? trajectory.frames?.[current_step_idx]
    const total_frames = trajectory.total_frames ?? trajectory.frames?.length ?? 0

    const sections: { title: string; items: InfoItem[] }[] = []
    // Append a section unless every item filtered out as falsy
    const push_section = (title: string, items: unknown[]) => {
      const valid_items = items.filter(is_info_item)
      if (valid_items.length > 0) sections.push({ title, items: valid_items })
    }

    push_section(`File`, [
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
      trajectory.metadata?.source_format &&
        safe_item(`Format`, String(trajectory.metadata.source_format), `file-format`),
    ])

    push_section(`Trajectory`, [
      safe_item(
        `Total Frames`,
        `${format_num(total_frames, `.3~s`)} (current: ${format_num(
          current_step_idx + 1,
          `.3~s`,
        )})`,
        `total-frames`,
      ),
      trajectory.is_indexed &&
        safe_item(
          `Indexed`,
          `Yes`,
          `indexed-mode`,
          SETTINGS_CONFIG.trajectory.use_indexing.description,
        ),
      trajectory.indexed_frames &&
        safe_item(
          `Index Points`,
          `${trajectory.indexed_frames.length}`,
          `index-points`,
          `Number of frames indexed for fast seeking`,
        ),
      trajectory.plot_metadata &&
        safe_item(
          `Plot Metadata`,
          `${trajectory.plot_metadata.length} frames`,
          `plot-metadata`,
          `Pre-extracted metadata for plotting`,
        ),
    ])

    // Structure info section (only if we have the current frame)
    if (displayed_frame?.structure?.sites) {
      const { structure } = displayed_frame
      const lattice = `lattice` in structure ? structure.lattice : null
      const { volume, a, b, c, alpha, beta, gamma } = lattice || {}
      const formula = safe_formula(structure)

      push_section(`Structure`, [
        safe_item(`Atoms`, `${structure.sites.length}`, `atoms`),
        formula && safe_item(`Formula`, String(formula), `formula`),
        is_valid_number(volume) &&
          volume > 0 &&
          safe_item(`Volume`, `${format_num(volume, `.3~s`)} Å³`, `volume`),
        is_valid_number(volume) &&
          volume > 0 &&
          structure.sites.length > 0 &&
          safe_item(
            `Density`,
            `${format_num(structure.sites.length / volume, `.3~s`)} atoms/Å³`,
            `density`,
          ),
        [a, b, c].every(is_valid_number) &&
          safe_item(
            `Cell Lengths`,
            `${format_num(a as number, `.3~f`)}, ${format_num(b as number, `.3~f`)}, ${format_num(
              c as number,
              `.3~f`,
            )} Å`,
            `cell-lengths`,
          ),
        [alpha, beta, gamma].every(is_valid_number) &&
          safe_item(
            `Cell Angles`,
            `${format_num(alpha as number, `.2~f`)}°, ${format_num(
              beta as number,
              `.2~f`,
            )}°, ${format_num(gamma as number, `.2~f`)}°`,
            `cell-angles`,
          ),
      ])
    } else if (trajectory.is_indexed) {
      // For indexed trajectories, show a note that frame data is loaded on demand
      push_section(`Structure`, [
        safe_item(
          `Frame Loading`,
          `On-demand`,
          `frame-loading`,
          `Structure data loaded when frame is accessed`,
        ),
      ])
    }

    // Aggregates over the run. An indexed trajectory keeps only a handful of frames in memory,
    // so a min/max over `frames` there would describe the start of the run as the whole run.
    // Its pre-extracted plot_metadata is the only honest source, and is labelled with a
    // sample count below when it really does skip frames.
    const frames_in_memory = trajectory.frames?.length ?? 0
    const has_all_frames = frames_in_memory > 1 && frames_in_memory >= total_frames
    const metadata = has_all_frames ? null : trajectory.plot_metadata
    const metadata_count = metadata?.length ?? 0
    // The indexed parser extracts plot_metadata at sample_rate 1, so it normally holds one
    // entry per frame and the min/max over it is exact. Only call it a sample when frames
    // are actually missing, or a complete 100k-frame run reads "100k sampled of 100k".
    // Counted over distinct frame numbers because a re-delivered streaming batch can repeat.
    const covered_frames = metadata
      ? new SvelteSet(metadata.map(({ frame_number }) => frame_number)).size
      : 0
    const is_sample = metadata != null && covered_frames < total_frames
    const can_aggregate = total_frames > 1 && (has_all_frames || metadata_count > 1)
    const sampled_note = is_sample
      ? `Min/max over ${format_num(covered_frames, `.3~s`)} sampled frames of ${format_num(
          total_frames,
          `.3~s`,
        )} total, so the true extremum may lie outside this range`
      : undefined

    const aggregate_values = (prop: string): number[] =>
      metadata
        ? metadata.map(({ properties }) => properties[prop]).filter(is_valid_number)
        : extract_numeric_array(trajectory.frames, prop)

    const range_item = (label: string, values: number[], unit: string, key: string) => {
      const range = format_range(values, unit, `.3~s`)
      if (!range) return null
      const suffix = is_sample ? ` (${format_num(covered_frames, `.3~s`)} sampled)` : ``
      return safe_item(label, `${range}${suffix}`, key, sampled_note)
    }

    if (can_aggregate) {
      const range_sections = [
        {
          title: `Energy`,
          prop: `energy`,
          unit: `eV`,
          key: `energy`,
          current_label: `Current Energy`,
          range_label: `Energy Range`,
        },
        {
          title: `Forces`,
          prop: `force_max`,
          unit: `eV/Å`,
          key: `force`,
          current_label: `Max Force`,
          range_label: `Force Range`,
        },
      ] as const
      for (const { title, prop, unit, key, current_label, range_label } of range_sections) {
        const values = aggregate_values(prop)
        if (values.length <= 1) continue
        const current = displayed_frame?.metadata?.[prop]
        push_section(title, [
          is_valid_number(current) &&
            safe_item(
              current_label,
              `${format_num(current, `.3~s`)} ${unit}`,
              `${key}-current`,
            ),
          range_item(range_label, values, unit, `${key}-range`),
        ])
      }

      // In-memory frames carry volume on the lattice (metadata usually omits it); sampled
      // metadata carries it as a plain property.
      const volumes = (
        metadata
          ? aggregate_values(`volume`)
          : trajectory.frames
              .map(({ structure }) => `lattice` in structure && structure.lattice?.volume)
              .filter(is_valid_number)
      ).filter((volume) => volume > 0)

      if (volumes.length > 1) {
        const [min_volume, max_volume] = array_extent(volumes)
        // A fixed cell would otherwise render `125 - 125 Å³` directly under the Structure
        // section's own Volume row. volumes is already filtered to finite positives, so the
        // ratio is finite and non-negative.
        const vol_change = (max_volume - min_volume) / min_volume
        push_section(`Volume`, [
          min_volume < max_volume && range_item(`Volume Range`, volumes, `Å³`, `volume-range`),
          vol_change > 0.1 &&
            safe_item(`Volume Change`, `${format_num(vol_change, `.2~%`)}`, `vol-change`),
        ])
      }
    }
    return sections
  })

  let info_cards = $derived(info_pane_data.map(({ title, items }) => ({ title, rows: items })))
  let n_info_items = $derived(
    info_pane_data.reduce((count, { items }) => count + items.length, 0),
  )
</script>

<DraggablePane
  bind:open={pane_open}
  max_width="24em"
  toggle_props={{
    title: pane_open ? `` : `Trajectory info`,
    'aria-label': pane_open ? `Close trajectory info` : `Open trajectory info`,
    ...toggle_props,
    class: `trajectory-info-toggle ${toggle_props?.class ?? ``}`,
  }}
  pane_props={{ ...pane_props, class: `trajectory-info-pane ${pane_props?.class ?? ``}` }}
  open_icon={Cross}
  closed_icon={Info}
  {...rest}
>
  <h4 style="margin-top: 0">Trajectory Info</h4>
  <InfoPaneCards
    cards={info_cards}
    filter_placeholder="Filter trajectory info"
    empty_label="trajectory info"
    show_filter={n_info_items > 5}
  />
</DraggablePane>
