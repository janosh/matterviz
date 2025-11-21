<script lang="ts">
  import { DraggablePane, format_num, Icon, type InfoItem } from '$lib'
  import { get_electro_neg_formula } from '$lib/composition'
  import { SETTINGS_CONFIG } from '$lib/settings'
  import { type AnyStructure } from '$lib/structure'
  import type { ComponentProps } from 'svelte'
  import { tooltip as create_tooltip } from 'svelte-multiselect/attachments'
  import { SvelteSet } from 'svelte/reactivity'
  import type { TrajectoryType } from './index'

  let {
    trajectory,
    current_step_idx,
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
    current_filename?: string | null
    current_file_path?: string | null
    file_size?: number | null
    file_object?: File | null
    pane_open?: boolean
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
  } = $props()

  let copied_items = new SvelteSet<string>()

  async function copy_item(label: string, value: string | number, key: string) {
    try {
      await navigator.clipboard.writeText(`${label}: ${value}`)
      copied_items.add(key)
      setTimeout(() => {
        copied_items.delete(key)
      }, 1000)
    } catch (error) {
      console.error(`Failed to copy to clipboard:`, error)
    }
  }

  // Helper functions
  const format_size = (bytes: number) =>
    bytes > 1024 * 1024
      ? `${format_num(bytes / (1024 * 1024), `.2~f`)} MB`
      : `${format_num(bytes / 1024, `.2~f`)} KB`

  const is_valid_number = (val: unknown): val is number =>
    typeof val === `number` && isFinite(val)

  const extract_numeric_array = (frames: typeof trajectory.frames, prop: string) =>
    frames.map((frame) => frame.metadata?.[prop]).filter(is_valid_number)

  const format_range = (values: number[], unit = ``, decimals = `.2~f`) => {
    if (!values.length) return null
    if (values.length === 1) {
      return `${format_num(values[0], decimals)} ${unit}`.trim()
    }
    const [min, max] = [Math.min(...values), Math.max(...values)]
    return `${format_num(min, decimals)} - ${format_num(max, decimals)} ${unit}`
      .trim()
  }

  const safe_item = (
    label: string,
    value: string | null,
    key?: string,
    tooltip?: string,
  ): InfoItem | null => value ? { label, value, key, tooltip } : null

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
    ) return []

    // For indexed trajectories, we might not have the current frame loaded
    const current_frame = trajectory.frames?.[current_step_idx]
    const total_frames = trajectory.total_frames ?? trajectory.frames?.length ?? 0

    const sections: { title: string; items: InfoItem[] }[] = []

    // File info section
    const file_items = [
      current_filename &&
      safe_item(
        `Name`,
        current_filename,
        `file-name`,
        current_file_path || undefined,
      ),
      file_size && file_size > 0 &&
      safe_item(`File Size`, format_size(file_size), `file-size`),
      file_object?.lastModified &&
      safe_item(
        `Modified`,
        new Date(file_object.lastModified).toLocaleString(),
        `file-modified`,
      ),
      trajectory.metadata?.source_format &&
      safe_item(`Format`, String(trajectory.metadata.source_format), `file-format`),
    ].filter(is_info_item)

    if (file_items.length > 0) {
      sections.push({ title: `File`, items: file_items })
    }

    // Trajectory info section (always show this)
    const traj_items = [
      safe_item(
        `Total Frames`,
        `${format_num(total_frames, `.3~s`)} (current: ${
          format_num(current_step_idx + 1, `.3~s`)
        })`,
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
    ].filter(is_info_item)

    if (traj_items.length > 0) {
      sections.push({ title: `Trajectory`, items: traj_items })
    }

    // Structure info section (only if we have the current frame)
    if (current_frame?.structure?.sites) {
      const { structure } = current_frame
      const lattice = `lattice` in structure ? structure.lattice : null
      const { volume, a, b, c, alpha, beta, gamma } = lattice || {}
      const formula = safe_formula(structure)

      const structure_items = [
        safe_item(`Atoms`, `${structure.sites.length}`, `atoms`),
        formula && safe_item(`Formula`, String(formula), `formula`),
        is_valid_number(volume) && volume > 0 &&
        safe_item(`Volume`, `${format_num(volume, `.3~s`)} Å³`, `volume`),
        is_valid_number(volume) && volume > 0 && structure.sites.length > 0 &&
        safe_item(
          `Density`,
          `${format_num(structure.sites.length / volume, `.4~s`)} atoms/Å³`,
          `density`,
        ),
        [a, b, c].every(is_valid_number) &&
        safe_item(
          `Cell Lengths`,
          `${format_num(a as number, `.3~f`)}, ${format_num(b as number, `.3~f`)}, ${
            format_num(c as number, `.3~f`)
          } Å`,
          `cell-lengths`,
        ),
        [alpha, beta, gamma].every(is_valid_number) &&
        safe_item(
          `Cell Angles`,
          `${format_num(alpha as number, `.2~f`)}°, ${
            format_num(beta as number, `.2~f`)
          }°, ${format_num(gamma as number, `.2~f`)}°`,
          `cell-angles`,
        ),
      ].filter(is_info_item)

      if (structure_items.length > 0) {
        sections.push({ title: `Structure`, items: structure_items })
      }
    } else if (trajectory.is_indexed) {
      // For indexed trajectories, show a note that frame data is loaded on demand
      const structure_items = [
        safe_item(
          `Frame Loading`,
          `On-demand`,
          `frame-loading`,
          `Structure data loaded when frame is accessed`,
        ),
      ].filter(is_info_item)

      if (structure_items.length > 0) {
        sections.push({ title: `Structure`, items: structure_items })
      }
    }

    // Energy section (only for regular trajectories with multiple frames)
    if (!trajectory.is_indexed && trajectory.frames.length > 1) {
      const energies = extract_numeric_array(trajectory.frames, `energy`)
      if (energies.length > 1) {
        const current_energy = current_frame?.metadata?.energy
        const energy_range = format_range(energies, `eV`, `.3~s`)

        const energy_items = [
          is_valid_number(current_energy) &&
          safe_item(
            `Current Energy`,
            `${format_num(current_energy, `.3~s`)} eV`,
            `energy-current`,
          ),
          energy_range && safe_item(`Energy Range`, energy_range, `energy-range`),
        ].filter(is_info_item)

        if (energy_items.length > 0) {
          sections.push({ title: `Energy`, items: energy_items })
        }
      }
    }

    // Forces section (only for regular trajectories with multiple frames)
    if (!trajectory.is_indexed && trajectory.frames.length > 1) {
      const forces = extract_numeric_array(trajectory.frames, `force_max`)
      if (forces.length > 1) {
        const current_force = current_frame?.metadata?.force_max
        const force_range = format_range(forces, `eV/Å`, `.3~s`)

        const force_items = [
          is_valid_number(current_force) &&
          safe_item(
            `Max Force`,
            `${format_num(current_force, `.3~s`)} eV/Å`,
            `force-current`,
          ),
          force_range && safe_item(`Force Range`, force_range, `force-range`),
        ].filter(is_info_item)

        if (force_items.length > 0) {
          sections.push({ title: `Forces`, items: force_items })
        }
      }
    }

    // Volume change section (only for regular trajectories)
    if (
      !trajectory.is_indexed && current_frame?.structure &&
      trajectory.frames.length > 1
    ) {
      const lattice = `lattice` in current_frame.structure
        ? current_frame.structure.lattice
        : null
      if (lattice) {
        const volumes = trajectory.frames.map((
          { structure },
        ) => (`lattice` in structure && structure.lattice?.volume))
          .filter(is_valid_number)
          .filter((v) => v > 0)

        if (volumes.length > 1) {
          const vol_change = (Math.max(...volumes) - Math.min(...volumes)) /
            Math.min(...volumes)
          if (Math.abs(vol_change) > 0.1 && is_valid_number(vol_change)) {
            const vol_items = [safe_item(
              `Volume Change`,
              `${format_num(vol_change, `.2~%`)}`,
              `vol-change`,
            )].filter(is_info_item)

            if (vol_items.length > 0) {
              sections.push({ title: `Volume`, items: vol_items })
            }
          }
        }
      }
    }

    return sections
  })
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
  {#each info_pane_data as section, sec_idx (section.title)}
    {#if sec_idx > 0}<hr />{/if}
    <section>
      {#if section.title && section.title !== `File`}
        <h4>{section.title}</h4>
      {/if}
      {#each section.items as item (item.key ?? item.label)}
        {@const { key, label, value, tooltip } = item}
        <div
          class="clickable"
          aria-label="Click to copy: {label}: {value}"
          onclick={() => copy_item(label, value, key ?? label)}
          role="button"
          tabindex="0"
          onkeydown={(event) => {
            if ([`Enter`, ` `].includes(event.key)) {
              event.preventDefault()
              copy_item(label, value, key ?? label)
            }
          }}
        >
          <span>{label}</span>
          <span title={tooltip} {@attach create_tooltip()}>{@html value}</span>
          {#if copied_items.has(key ?? label)}
            <Icon
              icon="Check"
              style="color: var(--success-color, #10b981); width: 12px; height: 12px"
              class="copy-checkmark"
            />
          {/if}
        </div>
      {/each}
    </section>
  {/each}
</DraggablePane>

<style>
  section div {
    display: flex;
    justify-content: space-between;
    gap: 6pt;
    padding: 1pt;
    line-height: 1.5;
  }
  section div.clickable {
    cursor: pointer;
    position: relative;
  }
  section div:hover {
    background: var(--pane-btn-bg-hover, rgba(255, 255, 255, 0.03));
  }
  section :global(.copy-checkmark) {
    position: absolute;
    top: 50%;
    right: 3pt;
    transform: translateY(-50%);
    background: var(--pane-bg);
    border-radius: 50%;
    padding: 3pt;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fade-in 0.1s ease-out;
  }
  @keyframes fade-in {
    0% {
      opacity: 0;
    }
  }
</style>
