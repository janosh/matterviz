<script lang="ts">
  import type { AnyStructure, Site } from '$lib'
  import { DraggablePane, element_data, format_num, Icon } from '$lib'
  import { electro_neg_formula, get_density } from '$lib/structure'
  import { analyze_structure_symmetry, ensure_moyo_wasm_ready } from '$lib/symmetry'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import type { ComponentProps } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'

  interface SectionItem {
    label: string
    value: string
    key: string
    tooltip?: string
  }

  interface Props {
    structure: AnyStructure
    pane_open?: boolean
    atom_count_thresholds?: [number, number] // if atom count is less than min_threshold, show sites, if atom count is greater than max_threshold, hide sites. in between, show sites behind a toggle button.
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
    [key: string]: unknown
  }
  let {
    structure,
    pane_open = $bindable(false),
    atom_count_thresholds = [50, 500],
    toggle_props = $bindable({}),
    pane_props = $bindable({}),
    ...rest
  }: Props = $props()

  let copied_items = new SvelteSet<string>()
  let sites_expanded = $state(false)
  let sym_data = $state<MoyoDataset | null>(null)

  // Reset symmetry data when structure changes
  $effect(() => {
    if (structure) sym_data = null
  })

  // Load symmetry data when pane is opened
  $effect(() => {
    if (!pane_open || !(`lattice` in structure) || sym_data) return

    const current = structure
    ensure_moyo_wasm_ready()
      .then(() => analyze_structure_symmetry(current, 1e-4, `Standard`))
      .then((data) => {
        if (structure === current) sym_data = data
      })
      .catch((err) => {
        console.error(`Symmetry analysis failed`, err)
      })
  })

  async function copy_to_clipboard(label: string, value: string, key: string) {
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

  function handle_click(item: SectionItem, section_title: string) {
    if (section_title === `Usage Tips`) return
    if (item.key === `sites-toggle`) sites_expanded = !sites_expanded
    else copy_to_clipboard(item.label, item.value, item.key)
  }

  let info_pane_data = $derived.by(() => {
    if (!structure) return []
    const sections = []
    const [min_threshold, max_threshold] = atom_count_thresholds

    // Structure Info
    const structure_items: SectionItem[] = [
      {
        label: `Formula`,
        value: `${electro_neg_formula(structure)} (${structure.sites.length} sites)`,
        key: `structure-formula`,
      },
      {
        label: `Charge`,
        value: `${structure.charge || 0}e`,
        key: `structure-charge`,
      },
    ]

    if (`properties` in structure && structure.properties) {
      for (
        const [key, value] of Object.entries(
          structure.properties as Record<string, unknown>,
        )
      ) {
        if (value != null) {
          structure_items.push({
            label: key.replace(/_/g, ` `).replace(/\b\w/g, (l) => l.toUpperCase()),
            value: String(value),
            key: `structure-prop-${key}`,
          })
        }
      }
    }
    sections.push({ title: `Structure`, items: structure_items })

    // Cell Info
    if (`lattice` in structure) {
      const { a, b, c, alpha, beta, gamma, volume } = structure.lattice
      sections.push({
        title: `Cell`,
        items: [
          {
            label: `Volume, Density`,
            value: `${format_num(volume, `.3~s`)} Å³, ${
              format_num(get_density(structure), `.3~f`)
            } g/cm³`,
            key: `cell-volume-density`,
          },
          {
            label: `a, b, c`,
            value: `${format_num(a, `.4~f`)}, ${format_num(b, `.4~f`)}, ${
              format_num(c, `.4~f`)
            } Å`,
            key: `cell-abc`,
          },
          {
            label: `α, β, γ`,
            value: `${format_num(alpha, `.2~f`)}°, ${format_num(beta, `.2~f`)}°, ${
              format_num(gamma, `.2~f`)
            }°`,
            key: `cell-angles`,
          },
        ] as SectionItem[],
      })
    }

    // Symmetry Info
    if (`lattice` in structure && sym_data) {
      const { operations } = sym_data
      const translations = operations.filter((op) =>
        op.rotation.every((r) => r === 0)
      ).length
      const rotations = operations.filter((op) =>
        op.translation.every((t) => t === 0)
      ).length
      const roto_translations = operations.filter((op) =>
        op.rotation.some((r) => r !== 0) &&
        op.translation.some((t) => t !== 0)
      ).length

      sections.push({
        title: `Symmetry`,
        items: [
          {
            label: `Space Group`,
            value: sym_data.number,
            key: `symmetry-space-group`,
          },
          {
            label: `Hall Number`,
            value: sym_data.hall_number,
            key: `symmetry-hall-number`,
          },
          {
            label: `Pearson Symbol`,
            value: sym_data.pearson_symbol,
            key: `symmetry-pearson-symbol`,
          },
          {
            label: `Symmetry Ops`,
            value:
              `${operations.length} (${translations} trans, ${rotations} rot, ${roto_translations} roto-trans)`,
            key: `symmetry-operations-total`,
          },
        ] as SectionItem[],
      })
    }

    // Sites Section
    const atom_count = structure.sites.length
    if (atom_count <= max_threshold) {
      const site_items: SectionItem[] = []

      // Merged toggle button with Sites title
      if (atom_count >= min_threshold) {
        const toggle_label = sites_expanded
          ? `Hide Sites`
          : `Show ${atom_count} sites`
        site_items.push({
          label: toggle_label,
          value: sites_expanded ? `▲` : `▼`,
          key: `sites-toggle`,
          tooltip: `Click to ${
            sites_expanded ? `hide` : `show`
          } all site information`,
        })
      }

      if (atom_count < min_threshold || sites_expanded) {
        structure.sites.forEach((site: Site, idx: number) => {
          const element = site.species[0]?.element || `Unknown`
          const element_name = element_data.find((el) =>
            el.symbol === element
          )?.name || element

          site_items.push({
            label: `${element}${idx + 1}`,
            value: element_name,
            key: `site-${idx}-header`,
          })

          if (site.abc) {
            site_items.push({
              label: `  Fractional`,
              value: `(${site.abc.map((x) => format_num(x, `.4~f`)).join(`, `)})`,
              key: `site-${idx}-fractional`,
            })
          }
          if (site.xyz) {
            site_items.push({
              label: `  Cartesian`,
              value: `(${site.xyz.map((x) => format_num(x, `.4~f`)).join(`, `)}) Å`,
              key: `site-${idx}-cartesian`,
            })
          }

          if (site.properties) {
            for (const [prop_key, prop_value] of Object.entries(site.properties)) {
              if (prop_value != null && prop_value !== undefined) {
                let formatted_value: string
                let tooltip: string | undefined

                if (
                  prop_key === `force` && Array.isArray(prop_value) &&
                  prop_value.length === 3 && prop_value.every((v) =>
                    typeof v === `number`
                  )
                ) {
                  const force_magnitude = Math.hypot(...prop_value)
                  formatted_value = `${format_num(force_magnitude, `.3~f`)} eV/Å`
                  tooltip = `Force vector: (${
                    prop_value.map((f) => format_num(f, `.3~f`)).join(`, `)
                  }) eV/Å`
                } else if (prop_key === `magmom` || prop_key.includes(`magnet`)) {
                  const num_val = Number(prop_value)
                  if (isNaN(num_val)) continue
                  formatted_value = `${format_num(num_val, `.3~f`)} μB`
                  tooltip = `Magnetic moment in Bohr magnetons`
                } else if (Array.isArray(prop_value)) {
                  formatted_value = `(${
                    prop_value.map((v) => {
                      const num_val = Number(v)
                      return isNaN(num_val) ? String(v) : format_num(num_val, `.3~f`)
                    }).join(`, `)
                  })`
                } else {
                  const num_val = Number(prop_value)
                  formatted_value = isNaN(num_val)
                    ? String(prop_value)
                    : format_num(num_val, `.3~f`)
                }

                site_items.push({
                  label: `  ${prop_key}`,
                  value: formatted_value,
                  key: `site-${idx}-${prop_key}`,
                  tooltip,
                })
              }
            }
          }
        })
      }

      if (site_items.length > 0) {
        sections.push({
          title: atom_count >= min_threshold ? `` : `Sites`,
          items: site_items,
        })
      }
    }

    // Usage Tips
    sections.push({
      title: `Usage Tips`,
      items: [
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
          value: `Press 'f' for fullscreen, 'i' to toggle this pane`,
          key: `tips-keyboard`,
        },
      ] as SectionItem[],
    })

    return sections
  })
</script>

<DraggablePane
  bind:show={pane_open}
  max_width="24em"
  toggle_props={{
    class: `structure-info-toggle`,
    title: `${pane_open ? `Close` : `Open`} structure info`,
    ...toggle_props,
  }}
  open_icon="Cross"
  closed_icon="Info"
  pane_props={{
    ...pane_props,
    class: `structure-info-pane ${pane_props?.class ?? ``}`,
  }}
  {...rest}
>
  <h4 style="margin-top: 0">Structure Info</h4>
  {#each info_pane_data as section (section.title)}
    <section>
      {#if section.title && section.title !== `Structure`}
        <h4>{section.title}</h4>
      {/if}
      {#each section.items as item (item.key)}
        {#if section.title === `Usage Tips`}
          <div class="tips-item">
            <span>{item.label}</span>
            <span>{@html item.value}</span>
          </div>
        {:else}
          <div
            class:site-item={item.label.startsWith(`  `)}
            class:toggle-item={item.key === `sites-toggle`}
            class="clickable"
            title={item.key === `sites-toggle`
            ? item.tooltip
            : `Click to copy: ${item.label}: ${item.value}`}
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
            <span>{item.label}</span>
            <span title={item.tooltip}>{@html item.value}</span>
            {#if item.key !== `sites-toggle` && copied_items.has(item.key)}
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
      {#if section !== info_pane_data[info_pane_data.length - 1]}
        <hr />
      {/if}
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
    position: relative; /* Add relative positioning for checkmark overlay */
  }
  section div:hover {
    background: var(--pane-btn-bg-hover, rgba(255, 255, 255, 0.03));
  }
  .copy-checkmark-overlay {
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
  section div.site-item {
    border-left: 2px solid #3b82f6;
    margin-left: 10pt;
    padding-left: 6pt;
  }
  section div.tips-item {
    flex-direction: column;
    gap: 2pt;
  }
  section div.tips-item span:last-child {
    opacity: 0.8;
  }
</style>
