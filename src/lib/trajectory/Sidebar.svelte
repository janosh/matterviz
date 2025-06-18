<script lang="ts">
  import { Icon } from '$lib'
  import { format_num } from '$lib/labels'
  import { electro_neg_formula } from '$lib/structure'
  import { titles_as_tooltips } from 'svelte-zoo'
  import type { Trajectory } from './index'

  interface SidebarSection {
    title: string
    items: Array<{
      label: string
      value: string
      tooltip?: string
    }>
  }

  interface Props {
    trajectory: Trajectory
    current_step_idx: number
    current_filename?: string | null
    current_file_path?: string | null
    file_size?: number | null
    file_object?: File | null
    is_open?: boolean
    onclose?: () => void
  }
  let {
    trajectory,
    current_step_idx,
    current_filename,
    current_file_path,
    file_size,
    file_object,
    is_open = false,
    onclose = () => {},
  }: Props = $props()

  // Structured sidebar data for trajectory statistics
  let sidebar_data = $derived.by((): SidebarSection[] => {
    if (!trajectory) return []

    const first_frame = trajectory.frames[0]
    const current_frame = trajectory.frames[current_step_idx]

    const sections: SidebarSection[] = []

    // File Information Section
    if (
      current_filename || file_size !== null || trajectory.metadata?.source_format ||
      file_object
    ) {
      const file_info = []
      if (current_filename) {
        file_info.push({
          label: `Filename`,
          value: current_filename,
          tooltip: current_file_path || undefined,
        })
      }
      if (file_size !== null && file_size !== undefined) {
        const size_str = file_size > 1024 * 1024
          ? `${format_num(file_size / (1024 * 1024), `.2~f`)} MB`
          : `${format_num(file_size / 1024, `.1~f`)} KB`
        file_info.push({ label: `File Size`, value: size_str })

        // Add file size in bytes for very large files
        if (file_size > 1024 * 1024) {
          const bytes_str = file_size.toLocaleString()
          file_info.push({ label: `Size (bytes)`, value: bytes_str })
        }
      }

      // Add file timestamps if available
      if (file_object) {
        file_info.push({
          label: `Last Modified`,
          value: file_object.lastModified.toLocaleString(),
          tooltip: `File system last modified time`,
        })
      }

      if (trajectory.metadata?.source_format) {
        file_info.push({
          label: `Format`,
          value: String(trajectory.metadata.source_format),
        })
      }

      // Add total atoms across all frames if it varies
      const atom_counts = trajectory.frames.map((f) => f.structure.sites.length)
      const min_atoms = Math.min(...atom_counts)
      const max_atoms = Math.max(...atom_counts)
      if (min_atoms !== max_atoms) {
        file_info.push({
          label: `Atoms Range`,
          value: `${min_atoms} - ${max_atoms}`,
        })
      }

      // Add creation/modification time if available from trajectory metadata
      if (typeof trajectory?.metadata?.created_at === `string`) {
        const date = new Date(trajectory.metadata.created_at)
        file_info.push({
          label: `Created (metadata)`,
          value: date.toLocaleDateString(),
          tooltip: `Creation time from file metadata`,
        })
      }

      sections.push({ title: `File`, items: file_info })
    }

    // Structure Information Section
    const structure_info = []
    structure_info.push({
      label: `Atoms`,
      value: `${current_frame.structure.sites.length}`,
    })

    // Add chemical formula
    structure_info.push({
      label: `Formula`,
      value: String(electro_neg_formula(current_frame.structure)),
    })

    if (`lattice` in first_frame.structure) {
      const { volume } = first_frame.structure.lattice
      structure_info.push({
        label: `Volume`,
        value: `${format_num(volume, `.3~s`)} Å³`,
      })
      structure_info.push({
        label: `Density`,
        value: `${
          format_num(first_frame.structure.sites.length / volume, `.4~s`)
        } atoms/Å³`,
      })
    }
    sections.push({ title: `Structure`, items: structure_info })

    // Unit Cell Section (if lattice exists)
    if (`lattice` in first_frame.structure) {
      const { a, b, c, alpha, beta, gamma } = first_frame.structure.lattice
      const cell_info = [
        {
          label: `Lengths`,
          value: `${format_num(a, `.3~f`)}, ${format_num(b, `.3~f`)}, ${
            format_num(c, `.3~f`)
          } Å`,
        },
        {
          label: `Angles`,
          value: `${format_num(alpha, `.1~f`)}°, ${format_num(beta, `.1~f`)}°, ${
            format_num(gamma, `.1~f`)
          }°`,
        },
      ]
      sections.push({ title: `Unit Cell`, items: cell_info })
    }

    // Trajectory Information Section
    const traj_info = [
      {
        label: `Steps`,
        value: `${trajectory.frames.length} (current: ${current_step_idx + 1})`,
      },
    ]

    // Add trajectory duration if we have time metadata
    const times = trajectory.frames
      .map((f) => f.metadata?.time)
      .filter((t): t is number => typeof t === `number`)
    if (times.length > 1) {
      const duration = Math.max(...times) - Math.min(...times)
      const time_unit = trajectory.metadata?.time_unit || `fs`
      traj_info.push({
        label: `Duration`,
        value: `${format_num(duration, `.3~s`)} ${time_unit}`,
      })
    }

    // Add temperature range if available
    const temperatures = trajectory.frames
      .map((f) => f.metadata?.temperature)
      .filter((t): t is number => typeof t === `number`)
    if (temperatures.length > 1) {
      const min_temp = Math.min(...temperatures)
      const max_temp = Math.max(...temperatures)
      if (Math.abs(max_temp - min_temp) > 1) {
        traj_info.push({
          label: `Temperature`,
          value: `${format_num(min_temp, `.1~f`)} - ${
            format_num(max_temp, `.1~f`)
          } K`,
        })
      }
    } else if (temperatures.length === 1) {
      traj_info.push({
        label: `Temperature`,
        value: `${format_num(temperatures[0], `.1~f`)} K`,
      })
    }

    // Add pressure range if available
    const pressures = trajectory.frames
      .map((f) => f.metadata?.pressure)
      .filter((p): p is number => typeof p === `number`)
    if (pressures.length > 1) {
      const min_pressure = Math.min(...pressures)
      const max_pressure = Math.max(...pressures)
      if (Math.abs(max_pressure - min_pressure) > 0.1) {
        traj_info.push({
          label: `Pressure`,
          value: `${format_num(min_pressure, `.2~f`)} - ${
            format_num(max_pressure, `.2~f`)
          } GPa`,
        })
      }
    } else if (pressures.length === 1) {
      traj_info.push({
        label: `Pressure`,
        value: `${format_num(pressures[0], `.2~f`)} GPa`,
      })
    }

    sections.push({ title: `Trajectory`, items: traj_info })

    // Energy Information Section (if available)
    const energies = trajectory.frames
      .map((f) => f.metadata?.energy)
      .filter(Boolean) as number[]
    if (energies.length > 1) {
      const min_energy = Math.min(...energies)
      const max_energy = Math.max(...energies)
      const energy_span = max_energy - min_energy
      const current_energy = current_frame.metadata?.energy as number | undefined

      const energy_info = []
      if (current_energy !== undefined) {
        energy_info.push({
          label: `Current Energy`,
          value: `${format_num(current_energy, `.3~s`)} eV`,
        })
      }
      energy_info.push({
        label: `Energy Range`,
        value: `${format_num(min_energy, `.3~s`)} to ${
          format_num(max_energy, `.3~s`)
        } eV`,
      })
      energy_info.push({
        label: `Energy Span`,
        value: `${format_num(energy_span, `.3~s`)} eV`,
      })
      sections.push({ title: `Energy`, items: energy_info })
    }

    // Forces Information Section (if available)
    const force_maxes = trajectory.frames
      .map((f) => f.metadata?.force_max)
      .filter((f): f is number => typeof f === `number`)
    if (force_maxes.length > 1) {
      const min_force = Math.min(...force_maxes)
      const max_force = Math.max(...force_maxes)
      const current_force = current_frame.metadata?.force_max as number | undefined

      const force_info = []
      if (current_force !== undefined) {
        force_info.push({
          label: `Current Max Force`,
          value: `${format_num(current_force, `.3~s`)} eV/Å`,
        })
      }
      force_info.push({
        label: `Force Range`,
        value: `${format_num(min_force, `.3~s`)} - ${
          format_num(max_force, `.3~s`)
        } eV/Å`,
      })
      sections.push({ title: `Forces`, items: force_info })
    }

    // Volume Change Section (if available)
    if (`lattice` in first_frame.structure && trajectory.frames.length > 1) {
      const volumes = trajectory.frames
        .map((frame) =>
          `lattice` in frame.structure ? frame.structure.lattice.volume : null
        )
        .filter((v): v is number => v !== null)

      if (volumes.length > 1) {
        const vol_change =
          ((Math.max(...volumes) - Math.min(...volumes)) / Math.min(...volumes)) * 100
        if (Math.abs(vol_change) > 0.1) {
          const dynamics_info = [
            {
              label: `Volume Change`,
              value: `${format_num(vol_change, `.2~f`)}%`,
            },
          ]
          sections.push({ title: `Dynamics`, items: dynamics_info })
        }
      }
    }

    return sections
  })
</script>

<aside class="info-sidebar" class:open={is_open}>
  <header class="sidebar-header">
    <h3>Trajectory Info</h3>
    <button
      onclick={onclose}
      aria-label="Close info panel"
      class="close-button"
      type="button"
    >
      <Icon icon="Cross" />
    </button>
  </header>
  <div class="sidebar-content">
    {#each sidebar_data as section (section.title)}
      <section>
        <h4>{section.title}</h4>
        {#each section.items as item (item.label)}
          <div>
            <span>{item.label}</span>
            <span
              title={item.tooltip}
              use:titles_as_tooltips
            >
              {@html item.value}
            </span>
          </div>
        {/each}
      </section>
    {/each}
  </div>
</aside>

<style>
  /* Info Sidebar Styles */
  .info-sidebar {
    position: absolute;
    top: 0;
    right: -320px;
    width: 320px;
    height: 100%; /* needed for scroll in sidebar */
    background: var(--sidebar-bg, rgba(15, 23, 42, 0.96));
    backdrop-filter: blur(8px);
    border-left: var(--sidebar-border, 1px solid rgba(71, 85, 105, 0.3));
    visibility: hidden;
    opacity: 0;
    transition:
      right 0.3s cubic-bezier(0.4, 0, 0.2, 1),
      visibility 0.3s cubic-bezier(0.4, 0, 0.2, 1),
      opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 10;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: var(--sidebar-shadow, -4px 0 20px rgba(0, 0, 0, 0.15));
    pointer-events: none;
  }
  .info-sidebar.open {
    right: 0;
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
  }
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem;
    border-bottom: var(--sidebar-header-border, 1px solid rgba(71, 85, 105, 0.2));
    background: var(--sidebar-header-bg, rgba(30, 41, 59, 0.8));
  }
  .sidebar-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--sidebar-title-color, #f1f5f9);
  }
  .close-button {
    min-width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    color: var(--sidebar-close-color, #94a3b8);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s ease;
  }
  .close-button:hover {
    background: var(--sidebar-close-hover-bg, rgba(71, 85, 105, 0.3));
    color: var(--sidebar-close-hover-color, #f1f5f9);
  }
  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0.375rem;
    scrollbar-width: thin;
    scrollbar-color: var(--sidebar-scrollbar-thumb, rgba(71, 85, 105, 0.5)) transparent;
  }
  .sidebar-content::-webkit-scrollbar {
    width: 6px;
  }
  .sidebar-content::-webkit-scrollbar-track {
    background: transparent;
  }
  .sidebar-content::-webkit-scrollbar-thumb {
    background: var(--sidebar-scrollbar-thumb, rgba(71, 85, 105, 0.5));
    border-radius: 3px;
  }
  .sidebar-content::-webkit-scrollbar-thumb:hover {
    background: var(--sidebar-scrollbar-thumb-hover, rgba(71, 85, 105, 0.7));
  }
  .sidebar-content section {
    margin-bottom: 1rem;
    &:last-child {
      margin-bottom: 0.25rem;
    }
    h4 {
      margin: 0 0 0.5rem 0;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--sidebar-section-title-color, #cbd5e1);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0 0.375rem;
    }
    div {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 1pt 4pt;
      margin-bottom: 0.25rem;
      background: var(--sidebar-item-bg, rgba(30, 41, 59, 0.4));
      border-radius: 4px;
      border: var(--sidebar-item-border, 1px solid rgba(71, 85, 105, 0.2));
      transition: all 0.2s ease;
      &:hover {
        background: var(--sidebar-item-hover-bg, rgba(30, 41, 59, 0.6));
        border-color: var(--sidebar-item-hover-border, rgba(71, 85, 105, 0.4));
      }
      &:last-child {
        margin-bottom: 0;
      }
      span:first-child {
        font-size: 0.8rem;
        color: var(--sidebar-label-color, #94a3b8);
        font-weight: 500;
        min-width: 0;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      span:last-child {
        font-size: 0.75rem;
        color: var(--sidebar-value-color, #f1f5f9);
        font-weight: 500;
        text-align: right;
        font-family: inherit;
        flex-shrink: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }

  /* Responsive design */
  @media (max-width: 768px) {
    .info-sidebar {
      width: 100%;
      max-width: 320px;
    }
  }
</style>
