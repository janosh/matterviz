<script lang="ts">
  import type { AnyStructure, Site } from '$lib'
  import { element_data, format_num, Icon } from '$lib'
  import * as math from '$lib/math'
  import { electro_neg_formula, get_density } from '$lib/structure'
  import { titles_as_tooltips } from 'svelte-zoo'

  interface SidebarSection {
    title: string
    items: Array<{
      label: string
      value: string
      tooltip?: string
      key?: string // Unique key for each item
    }>
  }

  interface Props {
    structure: AnyStructure
    is_open?: boolean
    onclose?: () => void
  }

  let {
    structure,
    is_open = false,
    onclose = () => {},
  }: Props = $props()

  // Structured sidebar data for structure information
  let sidebar_data = $derived.by((): SidebarSection[] => {
    if (!structure) return []

    const sections: SidebarSection[] = []

    // Structure Info Section
    const structure_info = []
    structure_info.push({
      label: `Formula`,
      value: electro_neg_formula(structure),
      key: `structure-formula`,
    })
    structure_info.push({
      label: `Total Atoms`,
      value: `${structure.sites.length}`,
      key: `structure-total-atoms`,
    })
    structure_info.push({
      label: `Charge`,
      value: `${structure.charge || 0}`,
      key: `structure-charge`,
    })

    // Add structure properties/metadata if available
    if (`properties` in structure && structure.properties) {
      const props = structure.properties as Record<string, unknown>
      for (const [key, value] of Object.entries(props)) {
        if (value !== null && value !== undefined) {
          structure_info.push({
            label: key.replace(/_/g, ` `).replace(/\b\w/g, (l) => l.toUpperCase()),
            value: String(value),
            tooltip: `Structure property: ${key}`,
            key: `structure-prop-${key}`,
          })
        }
      }
    }

    sections.push({ title: `Structure`, items: structure_info })

    // Unit Cell Section (if lattice exists)
    if (`lattice` in structure) {
      const { a, b, c, alpha, beta, gamma, volume } = structure.lattice
      const cell_info = [
        {
          label: `Volume`,
          value: `${format_num(volume, `.3~s`)} Å³`,
          key: `cell-volume`,
        },
        {
          label: `Density`,
          value: `${format_num(get_density(structure), `.3~f`)} g/cm³`,
          key: `cell-density`,
        },
        {
          label: `a`,
          value: `${format_num(a, `.4~f`)} Å`,
          key: `cell-a`,
        },
        {
          label: `b`,
          value: `${format_num(b, `.4~f`)} Å`,
          key: `cell-b`,
        },
        {
          label: `c`,
          value: `${format_num(c, `.4~f`)} Å`,
          key: `cell-c`,
        },
        {
          label: `α`,
          value: `${format_num(alpha, `.2~f`)}°`,
          key: `cell-alpha`,
        },
        {
          label: `β`,
          value: `${format_num(beta, `.2~f`)}°`,
          key: `cell-beta`,
        },
        {
          label: `γ`,
          value: `${format_num(gamma, `.2~f`)}°`,
          key: `cell-gamma`,
        },
      ]
      sections.push({ title: `Unit Cell`, items: cell_info })
    }

    // Site Information Section
    const site_items: Array<{
      label: string
      value: string
      tooltip?: string
      key?: string
    }> = []

    structure.sites.forEach((site: Site, idx: number) => {
      const element = site.species[0]?.element || `Unknown`
      const element_info = element_data.find((el) => el.symbol === element)
      const element_name = element_info?.name || element

      // Site header
      site_items.push({
        label: `${element}${idx + 1}`,
        value: element_name,
        tooltip: `Site ${idx + 1}: ${element_name}`,
        key: `site-${idx}-header`,
      })

      // Fractional coordinates
      if (site.abc) {
        site_items.push({
          label: `  Fractional`,
          value: `(${site.abc.map((x) => format_num(x, `.4~f`)).join(`, `)})`,
          tooltip: `Fractional coordinates in unit cell basis`,
          key: `site-${idx}-fractional`,
        })
      }

      // Cartesian coordinates
      if (site.xyz) {
        site_items.push({
          label: `  Cartesian`,
          value: `(${site.xyz.map((x) => format_num(x, `.4~f`)).join(`, `)}) Å`,
          tooltip: `Cartesian coordinates in Ångström`,
          key: `site-${idx}-cartesian`,
        })
      }

      // Site properties
      if (site.properties && Object.keys(site.properties).length > 0) {
        for (const [prop_key, prop_value] of Object.entries(site.properties)) {
          if (prop_value !== null && prop_value !== undefined) {
            let formatted_value: string
            let tooltip: string | undefined

            if (
              prop_key === `force` && Array.isArray(prop_value) &&
              prop_value.length === 3
            ) {
              const force_magnitude = math.norm(prop_value)
              formatted_value = `${format_num(force_magnitude, `.3~f`)} eV/Å`
              tooltip = `Force vector: (${
                prop_value.map((f) => format_num(f, `.3~f`)).join(`, `)
              }) eV/Å`
            } else if (prop_key === `magmom` || prop_key.includes(`magnet`)) {
              formatted_value = `${format_num(Number(prop_value), `.3~f`)} μB`
              tooltip = `Magnetic moment in Bohr magnetons`
            } else if (Array.isArray(prop_value)) {
              formatted_value = `(${
                prop_value.map((v) => format_num(Number(v), `.3~f`)).join(`, `)
              })`
            } else {
              formatted_value = format_num(Number(prop_value), `.3~f`)
            }

            site_items.push({
              label: `  ${prop_key}`,
              value: formatted_value,
              tooltip: tooltip || `Site property: ${prop_key}`,
              key: `site-${idx}-${prop_key}`,
            })
          }
        }
      }
    })

    if (site_items.length > 0) {
      sections.push({ title: `Sites`, items: site_items })
    }

    // Usage Tips Section
    const tips_items = [
      {
        label: `File Drop`,
        value: `Drop POSCAR, XYZ, CIF or JSON files to load structures`,
        key: `tips-file-drop`,
      },
      {
        label: `Atom Selection`,
        value: `Click atoms to activate, hover for distances`,
        key: `tips-atom-selection`,
      },
      {
        label: `Navigation`,
        value: `Hold Shift/Cmd/Ctrl + drag to pan the scene`,
        key: `tips-navigation`,
      },
      {
        label: `Colors`,
        value: `Click legend labels to change colors, double-click to reset`,
        key: `tips-colors`,
      },
      {
        label: `Keyboard`,
        value: `Press 'f' for fullscreen, 'i' to toggle this panel`,
        key: `tips-keyboard`,
      },
    ]

    sections.push({ title: `Usage Tips`, items: tips_items })

    return sections
  })
</script>

<aside class="info-sidebar" class:open={is_open}>
  <header class="sidebar-header">
    <h3>Structure Info</h3>
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
        {#each section.items as item (item.key || item.label)}
          <div
            class:site-item={item.label.startsWith(`  `)}
            class:tips-item={section.title === `Usage Tips`}
          >
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
    right: -340px;
    width: 340px;
    height: 100%;
    background: var(--sidebar-bg, rgba(15, 23, 42, 0.96));
    backdrop-filter: blur(8px);
    border-left: var(--sidebar-border, 1px solid rgba(71, 85, 105, 0.3));
    visibility: hidden;
    opacity: 0;
    transition:
      right 0.3s cubic-bezier(0.4, 0, 0.2, 1),
      visibility 0.3s cubic-bezier(0.4, 0, 0.2, 1),
      opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 1000;
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
      &.site-item {
        background: var(--sidebar-site-item-bg, rgba(30, 41, 59, 0.2));
        border-left: 3px solid var(--sidebar-site-border, rgba(99, 179, 237, 0.6));
        margin-left: 0.5rem;
        padding-left: 0.25rem;
      }
      &.tips-item {
        background: transparent;
        border: none;
        padding: 0;
        margin-bottom: 0.5rem;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.25rem;
        width: 100%;
        max-width: 100%;
        &:hover {
          background: transparent;
          border: none;
        }
        span:first-child {
          white-space: normal;
          overflow: visible;
          text-overflow: unset;
          color: var(--sidebar-label-color, #dde2e8);
        }
        span:last-child {
          font-size: 0.8rem;
          color: var(--sidebar-label-color, #cbd5e1);
          font-weight: 400;
          text-align: left;
          white-space: normal;
        }
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
        text-align: left;
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
      max-width: 340px;
    }
  }
</style>
