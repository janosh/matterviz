<script lang="ts">
  import { DraggablePanel, Icon } from '$lib'
  import { format_num } from '$lib/labels'
  import { theme_state } from '$lib/state.svelte'
  import { type AnyStructure, electro_neg_formula } from '$lib/structure'
  import type { ComponentProps } from 'svelte'
  import { tooltip as create_tooltip } from 'svelte-multiselect/attachments'
  import { SvelteSet } from 'svelte/reactivity'
  import type { Trajectory } from './index'

  interface Props {
    trajectory: Trajectory
    current_step_idx: number
    current_filename?: string | null
    current_file_path?: string | null
    file_size?: number | null
    file_object?: File | null
    panel_open?: boolean
    toggle_props?: ComponentProps<typeof DraggablePanel>[`toggle_props`]
    panel_props?: ComponentProps<typeof DraggablePanel>[`panel_props`]
    [key: string]: unknown
  }
  let {
    trajectory,
    current_step_idx,
    current_filename,
    current_file_path,
    file_size,
    file_object,
    panel_open = $bindable(false),
    toggle_props,
    panel_props,
    ...rest
  }: Props = $props()

  let copied_items = new SvelteSet<string>()

  async function copy_item(label: string, value: string, key: string) {
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
    typeof val === `number` && !isNaN(val) && isFinite(val)

  const extract_numeric_array = (frames: typeof trajectory.frames, prop: string) =>
    frames.map((f) => f.metadata?.[prop]).filter(is_valid_number)

  const format_range = (values: number[], unit = ``, decimals = `.2~f`) => {
    if (!values.length) return null
    if (values.length === 1) {
      return `${format_num(values[0], decimals)} ${unit}`.trim()
    }
    const [min, max] = [Math.min(...values), Math.max(...values)]
    return `${format_num(min, decimals)} - ${format_num(max, decimals)} ${unit}`
      .trim()
  }

  type InfoItem = { label: string; value: string; key: string; tooltip?: string }

  const safe_item = (
    label: string,
    value: string | null,
    key: string,
    tooltip?: string,
  ): InfoItem | null => value ? { label, value, key, tooltip } : null

  const is_info_item = (item: unknown): item is InfoItem => Boolean(item)

  const safe_formula = (structure: AnyStructure) => {
    try {
      return electro_neg_formula(structure)
    } catch {
      return null
    }
  }

  // Get trajectory info organized by sections
  let info_sections = $derived.by(() => {
    if (
      !trajectory?.frames?.length || current_step_idx < 0 ||
      current_step_idx >= trajectory.frames.length
    ) return []

    const current_frame = trajectory.frames[current_step_idx]
    if (!current_frame?.structure?.sites) return []

    const sections: InfoItem[][] = []

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

    if (file_items.length > 0) sections.push(file_items)

    // Structure info section
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

    if (structure_items.length > 0) sections.push(structure_items)

    // Trajectory info section
    const times = extract_numeric_array(trajectory.frames, `time`)
    const duration = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0
    const time_unit = trajectory.metadata?.time_unit || `fs`

    const properties = [
      { key: `temperature`, unit: `K` },
      { key: `pressure`, unit: `GPa` },
    ]

    const traj_items = [
      safe_item(
        `Steps`,
        `${trajectory.frames.length} (current: ${current_step_idx + 1})`,
        `steps`,
      ),
      duration > 0 &&
      safe_item(
        `Duration`,
        `${format_num(duration, `.3~s`)} ${time_unit}`,
        `duration`,
      ),
      ...properties.map(({ key, unit }) => {
        const values = extract_numeric_array(trajectory.frames, key)
        const range = format_range(values, unit)
        return range &&
          safe_item(key.charAt(0).toUpperCase() + key.slice(1), range, key)
      }),
    ].filter(is_info_item)

    if (traj_items.length > 0) sections.push(traj_items)

    // Energy section
    const energies = extract_numeric_array(trajectory.frames, `energy`)
    if (energies.length > 1) {
      const current_energy = current_frame.metadata?.energy
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

      if (energy_items.length > 0) sections.push(energy_items)
    }

    // Forces section
    const forces = extract_numeric_array(trajectory.frames, `force_max`)
    if (forces.length > 1) {
      const current_force = current_frame.metadata?.force_max
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

      if (force_items.length > 0) sections.push(force_items)
    }

    // Volume change section
    if (lattice && trajectory.frames.length > 1) {
      const volumes = trajectory.frames
        .map((f) => (`lattice` in f.structure && f.structure.lattice?.volume))
        .filter(is_valid_number)
        .filter((v) => v > 0)

      if (volumes.length > 1) {
        const vol_change =
          ((Math.max(...volumes) - Math.min(...volumes)) / Math.min(...volumes)) * 100
        if (Math.abs(vol_change) > 0.1 && is_valid_number(vol_change)) {
          const vol_items = [safe_item(
            `Volume Change`,
            `${format_num(vol_change, `.2~f`)}%`,
            `vol-change`,
          )].filter(is_info_item)

          if (vol_items.length > 0) sections.push(vol_items)
        }
      }
    }

    return sections.filter((section) => section.length > 0)
  })
</script>

<DraggablePanel
  bind:show={panel_open}
  max_width="24em"
  toggle_props={{
    class: `trajectory-info-toggle`,
    title: `${panel_open ? `Close` : `Open`} trajectory info`,
    ...toggle_props,
  }}
  open_icon="Cross"
  closed_icon="Info"
  icon_style="transform: scale(1.3);"
  panel_props={{
    class: `trajectory-info-panel`,
    style: `box-shadow: 0 5px 10px rgba(0, 0, 0, ${
      theme_state.type === `dark` ? `0.5` : `0.1`
    }); max-height: 80vh;`,
    ...panel_props,
  }}
  {...rest}
>
  <h4>Trajectory Info</h4>
  {#each info_sections as section, section_idx (section_idx)}
    {#if section_idx > 0}
      <hr class="section-divider" />
    {/if}
    {#each section as { label, value, key, tooltip } (key)}
      <div
        class="info-item"
        title="Click to copy: {label}: {value}"
        onclick={() => copy_item(label, value, key)}
        role="button"
        tabindex="0"
        onkeydown={(event) => {
          if (event.key === `Enter` || event.key === ` `) {
            event.preventDefault()
            copy_item(label, value, key)
          }
        }}
      >
        <span>{label}</span>
        <span title={tooltip} {@attach create_tooltip()}>{@html value}</span>
        {#if copied_items.has(key)}
          <div class="copy-check">
            <Icon
              icon="Check"
              style="color: var(--success-color, #10b981); width: 12px; height: 12px"
            />
          </div>
        {/if}
      </div>
    {/each}
  {/each}
</DraggablePanel>

<style>
  h4 {
    margin: 8pt 0 6pt;
    font-size: 0.9em;
    color: var(--text-muted, #ccc);
  }
  .section-divider {
    margin: 12pt 0;
    border: none;
    border-top: 1px solid var(--border-color, #444);
  }
  .info-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6pt;
    padding: var(--panel-padding, 1pt 5pt);
    border-radius: var(--panel-border-radius, 3pt);
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
  }
  .info-item:hover {
    background: var(--panel-btn-hover-bg, var(--tooltip-bg));
  }
  .info-item span:first-child {
    font-size: 0.85em;
    font-weight: 500;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .info-item span:last-child {
    font-size: 0.8em;
    font-weight: 500;
    text-align: right;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .copy-check {
    position: absolute;
    top: 50%;
    right: 3pt;
    transform: translateY(-50%);
    background: var(--panel-bg, rgba(0, 0, 0, 0.9));
    border-radius: 50%;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: appear 0.1s ease-out;
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
