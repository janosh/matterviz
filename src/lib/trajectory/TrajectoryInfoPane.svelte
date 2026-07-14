<script lang="ts">
  import type { PaneProps, PaneToggleProps } from '$lib/overlays'
  import type { InfoItem } from '$lib/layout'
  import InfoPaneCards from '$lib/overlays/InfoPaneCards.svelte'
  import { format_bytes, format_num } from '$lib/labels'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { get_electro_neg_formula } from '$lib/composition'
  import { SETTINGS_CONFIG } from '$lib/settings'
  import type { AnyStructure } from '$lib/structure'
  import type { ComponentProps } from 'svelte'
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

  // Helper functions
  const is_valid_number = (val: unknown): val is number =>
    typeof val === `number` && isFinite(val)

  const extract_numeric_array = (frames: typeof trajectory.frames, prop: string) =>
    frames.map((frame) => frame.metadata?.[prop]).filter(is_valid_number)

  const format_range = (values: number[], unit = ``, decimals = `.2~f`) => {
    if (values.length === 0) return null
    if (values.length === 1) {
      return `${format_num(values[0], decimals)} ${unit}`.trim()
    }
    const [min, max] = [Math.min(...values), Math.max(...values)]
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

    // Energy/Forces sections (only for regular trajectories with multiple frames)
    if (!trajectory.is_indexed && trajectory.frames.length > 1) {
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
        const values = extract_numeric_array(trajectory.frames, prop)
        if (values.length <= 1) continue
        const current = displayed_frame?.metadata?.[prop]
        push_section(title, [
          is_valid_number(current) &&
            safe_item(
              current_label,
              `${format_num(current, `.3~s`)} ${unit}`,
              `${key}-current`,
            ),
          safe_item(range_label, format_range(values, unit, `.3~s`), `${key}-range`),
        ])
      }
    }

    // Volume change section (only for regular trajectories)
    if (!trajectory.is_indexed && displayed_frame?.structure && trajectory.frames.length > 1) {
      const lattice =
        `lattice` in displayed_frame.structure ? displayed_frame.structure.lattice : null
      if (lattice) {
        const volumes = trajectory.frames
          .map(({ structure }) => `lattice` in structure && structure.lattice?.volume)
          .filter(is_valid_number)
          .filter((volume) => volume > 0)

        if (volumes.length > 1) {
          const vol_change =
            (Math.max(...volumes) - Math.min(...volumes)) / Math.min(...volumes)
          if (Math.abs(vol_change) > 0.1 && is_valid_number(vol_change)) {
            push_section(`Volume`, [
              safe_item(`Volume Change`, `${format_num(vol_change, `.2~%`)}`, `vol-change`),
            ])
          }
        }
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
  bind:show={pane_open}
  max_width="24em"
  toggle_props={{
    title: pane_open ? `` : `Trajectory info`,
    ...toggle_props,
    class: `trajectory-info-toggle ${toggle_props?.class ?? ``}`,
  }}
  open_icon="Cross"
  closed_icon="Info"
  pane_props={{ ...pane_props, class: `trajectory-info-pane ${pane_props?.class ?? ``}` }}
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
