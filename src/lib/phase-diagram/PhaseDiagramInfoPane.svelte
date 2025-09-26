<script lang="ts">
  import { DraggablePane, format_num, Icon, type InfoItem } from '$lib'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'
  import type { PlotEntry3D } from './types'

  interface PhaseStats {
    total: number
    unary: number
    binary: number
    ternary: number
    quaternary: number
    stable: number
    unstable: number
    energy_range: { min: number; max: number; avg: number }
    hull_distance: { max: number; avg: number }
    elements: number
    chemical_system: string
  }

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, `onclose`> {
    phase_stats: PhaseStats | null
    stable_entries: PlotEntry3D[]
    unstable_entries: PlotEntry3D[]
    energy_threshold: number
    label_energy_threshold: number
    label_threshold: number
    pane_open?: boolean
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
  }
  let {
    phase_stats,
    stable_entries,
    unstable_entries,
    energy_threshold,
    label_energy_threshold,
    label_threshold,
    pane_open = $bindable(false),
    toggle_props = $bindable({}),
    pane_props = $bindable({}),
    ...rest
  }: Props = $props()

  let copied_items = new SvelteSet<string>()

  async function copy_to_clipboard(label: string, value: string, key: string) {
    try {
      await navigator.clipboard.writeText(`${label}: ${value}`)
      copied_items.add(key)
      setTimeout(() => copied_items.delete(key), 1000)
    } catch (error) {
      console.error(`Failed to copy to clipboard:`, error)
    }
  }

  function handle_click(item: InfoItem, section_title: string) {
    if (section_title === `Interaction`) return // Don't copy interaction tips
    copy_to_clipboard(item.label, String(item.value), item.key ?? item.label)
  }

  let pane_data = $derived.by(() => {
    if (!phase_stats) return []
    const sections: { title: string; items: InfoItem[] }[] = []

    // System Info
    sections.push({
      title: `System`,
      items: [
        {
          label: `Chemical System`,
          value: phase_stats.chemical_system,
          key: `chemical-system`,
        },
        {
          label: `Total entries`,
          value: format_num(phase_stats.total),
          key: `total-entries`,
        },
      ],
    })

    // Phase Distribution
    sections.push({
      title: `Phase Distribution`,
      items: [
        {
          label: `Unary phases`,
          value: format_num(phase_stats.unary),
          key: `unary-phases`,
        },
        {
          label: `Binary phases`,
          value: format_num(phase_stats.binary),
          key: `binary-phases`,
        },
        {
          label: `Ternary phases`,
          value: format_num(phase_stats.ternary),
          key: `ternary-phases`,
        },
        {
          label: `Quaternary phases`,
          value: format_num(phase_stats.quaternary),
          key: `quaternary-phases`,
        },
      ],
    })

    // Stability
    sections.push({
      title: `Stability`,
      items: [
        {
          label: `Stable phases`,
          value: `${format_num(phase_stats.stable)} (${
            ((phase_stats.stable / phase_stats.total) * 100).toFixed(1)
          }%)`,
          key: `stable-phases`,
        },
        {
          label: `Unstable phases`,
          value: `${format_num(phase_stats.unstable)} (${
            ((phase_stats.unstable / phase_stats.total) * 100).toFixed(1)
          }%)`,
          key: `unstable-phases`,
        },
      ],
    })

    // Energy Statistics
    sections.push({
      title: `Energy Statistics (eV/atom)`,
      items: [
        {
          label: `Min formation energy`,
          value: format_num(phase_stats.energy_range.min, `.3f`),
          key: `min-formation-energy`,
        },
        {
          label: `Max formation energy`,
          value: format_num(phase_stats.energy_range.max, `.3f`),
          key: `max-formation-energy`,
        },
        {
          label: `Avg formation energy`,
          value: format_num(phase_stats.energy_range.avg, `.3f`),
          key: `avg-formation-energy`,
        },
      ],
    })

    // Hull Distance
    sections.push({
      title: `Hull Distance (eV/atom)`,
      items: [
        {
          label: `Max above hull`,
          value: format_num(phase_stats.hull_distance.max, `.3f`),
          key: `max-hull-distance`,
        },
        {
          label: `Avg above hull`,
          value: format_num(phase_stats.hull_distance.avg, `.3f`),
          key: `avg-hull-distance`,
        },
      ],
    })

    // Visualization Settings
    sections.push({
      title: `Visualization Settings`,
      items: [
        {
          label: `Visible stable`,
          value: `${
            stable_entries.filter((e) => e.visible).length
          } / ${stable_entries.length}`,
          key: `visible-stable`,
        },
        {
          label: `Visible unstable`,
          value: `${
            unstable_entries.filter((e) => e.visible).length
          } / ${unstable_entries.length}`,
          key: `visible-unstable`,
        },
        {
          label: `Points threshold`,
          value: `${format_num(energy_threshold, `.3f`)} eV/atom`,
          key: `show-threshold`,
        },
        {
          label: `Label threshold`,
          value: `${format_num(label_energy_threshold, `.3f`)} eV/atom`,
          key: `label-threshold`,
        },
        {
          label: `Entry limit for labels`,
          value: `${label_threshold} entries`,
          key: `entry-limit-labels`,
        },
      ],
    })

    // Interaction Tips
    sections.push({
      title: `Usage Tips`,
      items: [
        { label: `Single click`, value: `Select point` },
        { label: `Double click`, value: `Copy info` },
        { label: `Drag`, value: `Rotate view` },
        { label: `Scroll`, value: `Zoom in/out` },
        { label: `Key 'r'`, value: `Reset camera` },
        { label: `Key 'b'`, value: `Toggle color mode` },
        { label: `Key 's'`, value: `Toggle stable points` },
        { label: `Key 'u'`, value: `Toggle unstable points` },
        { label: `Key 'l'`, value: `Toggle labels` },
      ],
    })

    return sections
  })
</script>

<DraggablePane
  bind:show={pane_open}
  max_width="24em"
  toggle_props={{
    title: `${pane_open ? `Close` : `Open`} phase diagram info`,
    class: `phase-diagram-info-toggle`,
    ...toggle_props,
  }}
  open_icon="Cross"
  closed_icon="Info"
  pane_props={{
    ...pane_props,
    class: `phase-diagram-info-pane ${pane_props?.class ?? ``}`,
  }}
  {...rest}
>
  <h4 style="margin-top: 0">Phase Diagram Statistics</h4>
  {#each pane_data as section, sec_idx (section.title)}
    {#if sec_idx > 0}<hr />{/if}
    <section>
      {#if section.title && section.title !== `System`}
        <h5>{section.title}</h5>
      {/if}
      {#each section.items as item (item.key ?? item.label)}
        {@const { key, label, value } = item}
        {#if section.title === `Interaction`}
          <div class="tips-item">
            <span>{label}:</span>
            <span>{value}</span>
          </div>
        {:else}
          <div
            class="clickable stat-item"
            title="Click to copy: {label}: {value}"
            onclick={() => handle_click(item, section.title)}
            role="button"
            tabindex="0"
            onkeydown={(event) => {
              if (event.key === `Enter` || event.key === ` `) {
                event.preventDefault()
                handle_click(item, section.title)
              }
            }}
          >
            <span>{label}:</span>
            <span>{@html value}</span>
            {#if key && copied_items.has(key)}
              <div class="copy-checkmark-overlay">
                <Icon
                  icon="Check"
                  style="color: var(--success-color, #10b981); width: 12px; height: 12px"
                />
              </div>
            {/if}
          </div>
        {/if}
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
    padding: 0 3pt;
  }
  section div:hover {
    background: var(--pane-bg-hover);
    border-radius: 3pt;
  }
  .copy-checkmark-overlay {
    position: absolute;
    top: 50%;
    right: 3pt;
    transform: translateY(-50%);
    background: var(--pane-bg);
    border-radius: 50%;
    animation: fade-in 0.1s ease-out;
  }
  @keyframes fade-in {
    0% {
      opacity: 0;
    }
  }
  .stat-item span:first-child {
    color: var(--text-color-muted, #666);
  }
  section h5 {
    margin: 0 0 6px 0;
  }
</style>
