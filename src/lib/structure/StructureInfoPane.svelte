<script lang="ts">
  import type { InfoPaneCard, InfoPaneRow, PaneProps, PaneToggleProps } from '$lib/overlays'
  import { ViewerPane, create_clipboard_feedback, info_pane_icon } from '$lib/overlays'
  import InfoPaneCards from '$lib/overlays/InfoPaneCards.svelte'
  import { get_electro_neg_formula } from '$lib/composition'
  import { element_by_symbol, type ElementSymbol } from '$lib/element'
  import { format_num } from '$lib/labels'
  import { colors } from '$lib/state.svelte'
  import { get_density, type AnyStructure } from '$lib/structure'
  import type { BondingStrategy } from '$lib/structure/bonding'
  import { has_usable_lattice } from '$lib/structure/validation'
  import { DEFAULTS } from '$lib/settings'
  import RdfPlot from '$lib/rdf/RdfPlot.svelte'
  import CoordinationBarPlot from '$lib/coordination/CoordinationBarPlot.svelte'
  import BondAnglePlot from '$lib/bond-angles/BondAnglePlot.svelte'
  import type { SymmetryDataset, WyckoffPos } from '$lib/symmetry'
  import { count_symmetry_op_kinds, WyckoffTable } from '$lib/symmetry'
  import type { HTMLAttributes } from 'svelte/elements'

  type SiteCard = InfoPaneCard & { idx: number; element: string }

  const USAGE_TIPS = [
    [`File Drop`, `Drop POSCAR, XYZ, CIF or JSON files to load structures`],
    [
      `Atom Selection`,
      `Click atoms to select them, then pick distance or angle mode to measure all pairwise distances/angles`,
    ],
    [
      `Navigation`,
      `Drag to rotate, scroll to zoom, hold Shift/Cmd/Ctrl + drag to pan. Rotate, zoom and pan sensitivity are adjustable under Camera in the settings pane`,
    ],
    [
      `Camera Reset`,
      `Press r, double-click the canvas, or use Reset view at the top of the settings pane`,
    ],
    [
      `Colors`,
      `Click legend labels to change colors, double-click to reset, right-click to remap elements`,
    ],
    [
      `Keyboard`,
      `Press f for fullscreen, i to toggle this pane, g for multi-view, r to reset the view`,
    ],
  ] as const

  let {
    structure,
    displayed_structure = structure,
    bonding_strategy = DEFAULTS.structure.bonding_strategy,
    pane_open = $bindable(false),
    toggle_props = {},
    pane_props = {},
    highlighted_sites = $bindable([]),
    hovered_site_idx = $bindable(null),
    selected_sites = $bindable([]),
    sym_data = null,
    wyckoff_positions = [],
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    structure: AnyStructure
    // Analysis excludes render-only images; selected indices address displayed_structure.
    displayed_structure?: AnyStructure
    bonding_strategy?: BondingStrategy
    pane_open?: boolean
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
    highlighted_sites?: number[] // Sites highlighted from Wyckoff table hover
    hovered_site_idx?: number | null // Site hovered in this pane or in the 3D scene
    selected_sites?: number[] // Sites selected from Wyckoff table click
    sym_data?: SymmetryDataset | null // Symmetry analysis data for the Symmetry card
    // Wyckoff rows whose site_indices address the sites the scene renders (StructureSession
    // .wyckoff_rows), so hovering/clicking a row highlights the right atoms in conventional/
    // primitive cells and supercells too, not the analyzed cell's indices
    wyckoff_positions?: WyckoffPos[]
  } = $props()

  const { copy } = create_clipboard_feedback()

  function set_site_hover(site_idx: number | null) {
    highlighted_sites = site_idx === null ? [] : [site_idx]
    hovered_site_idx = site_idx
  }

  function select_site(site_idx: number, event?: MouseEvent | KeyboardEvent) {
    set_site_hover(null)
    if (event?.shiftKey) {
      selected_sites = selected_sites.includes(site_idx)
        ? selected_sites.filter((idx) => idx !== site_idx)
        : [...selected_sites, site_idx]
      return
    }
    selected_sites =
      selected_sites.length === 1 && selected_sites[0] === site_idx ? [] : [site_idx]
  }

  const site_summary = (card: SiteCard): string =>
    [card.subtitle, ...card.rows.map(({ label, value }) => `${label}: ${value}`)].join(`; `)

  function handle_site_keydown(event: KeyboardEvent, card: SiteCard) {
    const plain_key = !event.altKey && !event.ctrlKey && !event.metaKey
    if ([`Enter`, ` `].includes(event.key)) {
      event.preventDefault()
      select_site(card.idx, event)
    } else if (event.key === `c` && plain_key) {
      event.preventDefault()
      copy(`${card.title}: ${site_summary(card)}`, `site-${card.idx}-summary`)
    } else if (plain_key && [`ArrowDown`, `ArrowUp`].includes(event.key)) {
      event.preventDefault()
      const current_card = event.currentTarget
      if (!(current_card instanceof HTMLElement)) return
      const sibling_cards = [
        ...(current_card.parentElement?.querySelectorAll<HTMLElement>(`.site-card`) ?? []),
      ]
      const current_idx = sibling_cards.indexOf(current_card)
      const next_idx =
        event.key === `ArrowDown`
          ? Math.min(current_idx + 1, sibling_cards.length - 1)
          : Math.max(current_idx - 1, 0)
      sibling_cards[next_idx]?.focus()
    }
  }

  const format_numeric = (value: unknown): string | null => {
    const numeric_value = Number(value)
    return Number.isNaN(numeric_value) ? null : format_num(numeric_value, `.3~f`)
  }

  function format_site_property(prop_key: string, prop_value: unknown): InfoPaneRow | null {
    if (prop_value == null) return null
    if (
      prop_key === `force` &&
      Array.isArray(prop_value) &&
      prop_value.length === 3 &&
      prop_value.every((value) => typeof value === `number`)
    ) {
      const force_values = prop_value as [number, number, number]
      return {
        label: prop_key,
        key: prop_key,
        value: `${format_num(Math.hypot(...force_values), `.3~f`)} eV/Å`,
        tooltip: `Force vector: ${force_values.map((force) => format_num(force, `.3~f`)).join(`, `)} eV/Å`,
      }
    }
    if (prop_key === `magmom` || prop_key.includes(`magnet`)) {
      const formatted_value = format_numeric(prop_value)
      if (!formatted_value) return null
      return {
        label: prop_key,
        key: prop_key,
        value: `${formatted_value} μB`,
        tooltip: `Magnetic moment in Bohr magnetons`,
      }
    }
    const value = Array.isArray(prop_value)
      ? `(${prop_value.map((item) => format_numeric(item) ?? String(item)).join(`, `)})`
      : (format_numeric(prop_value) ?? String(prop_value))
    return { label: prop_key, key: prop_key, value }
  }

  // Skipped while closed — ViewerPane keeps children mounted (display:none).
  let structure_cards = $derived.by((): InfoPaneCard[] => {
    if (!pane_open) return []
    const structure_rows: InfoPaneRow[] = [
      {
        label: `Formula`,
        value: `${get_electro_neg_formula(structure)} (${structure.sites.length} sites)`,
        key: `structure-formula`,
      },
      { label: `Charge`, value: `${structure.charge || 0}e`, key: `structure-charge` },
    ]
    // Only display scalar values (skip arrays and objects)
    for (const [key, value] of Object.entries(structure.properties ?? {})) {
      if (value == null || typeof value === `object`) continue
      structure_rows.push({
        label: key.replaceAll(`_`, ` `).replaceAll(/\b\w/g, (char) => char.toUpperCase()),
        value: String(value),
        key: `structure-prop-${key}`,
      })
    }
    const cards: InfoPaneCard[] = [{ title: `Structure`, rows: structure_rows }]
    if (!(`lattice` in structure)) return cards
    const { a, b, c, alpha, beta, gamma, volume } = structure.lattice
    cards.push({
      title: `Cell`,
      rows: [
        {
          label: `Volume, Density`,
          value: `${format_num(volume, `.3~s`)} Å³, ${format_num(get_density(structure), `.3~f`)} g/cm³`,
          key: `cell-volume-density`,
        },
        {
          label: `a, b, c`,
          value: `${format_num(a, `.3~f`)}, ${format_num(b, `.3~f`)}, ${format_num(c, `.3~f`)} Å`,
          key: `cell-abc`,
        },
        {
          label: `α, β, γ`,
          value: `${format_num(alpha, `.2~f`)}°, ${format_num(beta, `.2~f`)}°, ${format_num(gamma, `.2~f`)}°`,
          key: `cell-angles`,
        },
      ],
    })
    if (!sym_data) return cards
    const { operations } = sym_data
    const { translations, rotations, roto_translations } = count_symmetry_op_kinds(operations)
    const space_group_symbol = sym_data.hm_symbol.replaceAll(/\s+/g, ``)
    cards.push({
      title: `Symmetry`,
      rows: [
        {
          label: `Space Group`,
          value: space_group_symbol
            ? `${sym_data.number} (${space_group_symbol})`
            : String(sym_data.number),
          key: `symmetry-space-group`,
        },
        {
          label: `Hall Number`,
          value: String(sym_data.hall_number),
          key: `symmetry-hall-number`,
        },
        {
          label: `Pearson Symbol`,
          value: sym_data.pearson_symbol,
          key: `symmetry-pearson-symbol`,
        },
        {
          label: `Symmetry Ops`,
          value: `${operations.length} (${translations} trans, ${rotations} rot, ${roto_translations} roto-trans)`,
          key: `symmetry-operations-total`,
        },
      ],
    })
    return cards
  })

  let site_search = $state(``)
  const site_matches = $derived.by(() => {
    const query = site_search.trim().toLowerCase()
    if (!pane_open || !query) return []
    const matches: { idx: number; label: string }[] = []
    for (const [idx, site] of displayed_structure.sites.entries()) {
      const element = site.species.map((species) => species.element).join(`/`)
      const label = `${element}${idx + 1}`
      const names = site.species
        .map((species) => element_by_symbol.get(species.element)?.name)
        .join(` `)
      if (`${label} ${names}`.toLowerCase().includes(query) || String(idx + 1) === query) {
        matches.push({ idx, label })
        if (matches.length === 20) break
      }
    }
    return matches
  })
  let analysis_open = $state(false)
  const rdf_structure = $derived(has_usable_lattice(structure) ? structure : undefined)
  const rdf_available = $derived(Boolean(rdf_structure))
  let analysis_kind = $derived<`rdf` | `coordination` | `angles`>(
    rdf_available ? `rdf` : `coordination`,
  )
  const plot_props = {
    allow_file_drop: false,
    show_controls: false,
    style: `height: 250px; width: 100%`,
  }

  let site_cards = $derived.by((): SiteCard[] => {
    if (!pane_open) return []
    return selected_sites.flatMap((idx) => {
      const site = displayed_structure.sites[idx]
      // Image sites can disappear during a drag while the parent retains the selection.
      if (!site) return []
      const element = site.species?.[0]?.element || `Unknown`
      const element_name = element_by_symbol.get(element as ElementSymbol)?.name ?? element
      const rows: InfoPaneRow[] = []
      for (const [label, key, coords, unit] of [
        [`Frac.`, `fractional`, site.abc, ``],
        [`Cart.`, `cartesian`, site.xyz, ` Å`],
      ] as const) {
        const value = `(${coords.map((coord) => format_num(coord, `.3~f`)).join(`, `)})${unit}`
        rows.push({ label, key, value })
      }
      for (const [prop_key, prop_value] of Object.entries(site.properties ?? {})) {
        if ([`orig_site_idx`, `orig_unit_cell_idx`, `completion_image`].includes(prop_key))
          continue
        const row = format_site_property(prop_key, prop_value)
        if (row) rows.push(row)
      }
      const title = `${element}${idx + 1}`
      return [{ idx, element, title, subtitle: element_name, key: title, rows }]
    })
  })

  const site_card_attrs = (card: SiteCard): HTMLAttributes<HTMLElement> => ({
    class: [
      `site-card selected`,
      {
        highlighted: highlighted_sites.includes(card.idx) || hovered_site_idx === card.idx,
      },
    ],
    'data-site-idx': card.idx,
    style: `--site-color: ${colors.element?.[card.element as ElementSymbol] ?? `#888`}`,
    title: `Click to select ${card.title}. Press c to copy.`,
    role: `button`,
    tabindex: 0,
    onmouseenter: () => set_site_hover(card.idx),
    onmouseleave: () => set_site_hover(null),
    onfocus: () => set_site_hover(card.idx),
    onblur: () => set_site_hover(null),
    onclick: (event) => select_site(card.idx, event),
    onkeydown: (event) => handle_site_keydown(event, card),
  })

  let wyckoff_table_expanded = $derived(wyckoff_positions.length < 50)
</script>

<ViewerPane
  bind:open={pane_open}
  pane_name="structure info"
  class_prefix="structure-info"
  max_width="24em"
  {toggle_props}
  pane_props={{
    ...pane_props,
    style: [`--pane-padding: 4pt; --pane-gap: 2pt`, pane_props?.style]
      .filter(Boolean)
      .join(`; `),
  }}
  closed_icon={info_pane_icon}
  {...rest}
>
  <div class="structure-info">
    <InfoPaneCards cards={structure_cards} empty_label="structure info" show_filter={false} />

    {#if pane_open && wyckoff_positions.length > 0}
      <details class="wyckoff" bind:open={wyckoff_table_expanded}>
        <summary>Wyckoff table ({wyckoff_positions.length})</summary>
        {#if wyckoff_table_expanded}
          <WyckoffTable
            {wyckoff_positions}
            on_hover={(site_indices) => (highlighted_sites = site_indices ?? [])}
            on_click={(site_indices) => (selected_sites = site_indices ?? [])}
            style="width: 100%; margin-top: 2pt; font-size: 0.8em"
          />
        {/if}
      </details>
    {/if}

    {#if pane_open}
      <section class="selected-sites">
        <h4>Selected sites ({site_cards.length})</h4>
        <input
          type="search"
          aria-label="Find site"
          placeholder="Find site by element or index"
          bind:value={site_search}
        />
        {#if site_search.trim()}
          <div class="site-matches">
            {#each site_matches as { idx, label } (idx)}
              <button
                type="button"
                onclick={(event) => {
                  select_site(idx, event)
                  site_search = ``
                }}
              >
                {label}
              </button>
            {:else}
              <span>No matching sites.</span>
            {/each}
            {#if site_matches.length === 20}<small
                >First 20 matches. Refine your search for more.</small
              >{/if}
          </div>
        {/if}
        {#if site_cards.length > 0}
          <InfoPaneCards
            cards={site_cards}
            show_filter={false}
            empty_label="selected sites"
            page_size={100}
            card_attrs={site_card_attrs}
            class="site-cards"
          />
        {:else}
          <p>
            Select atoms in the viewer or find a site above. Shift-click to select several.
          </p>
        {/if}
      </section>

      <details class="analysis" bind:open={analysis_open}>
        <summary>Structure analysis</summary>
        {#if analysis_open}
          <label>
            Plot
            <select aria-label="Structure analysis plot" bind:value={analysis_kind}>
              {#if rdf_structure}<option value="rdf">Radial distribution</option>{/if}
              <option value="coordination">Coordination numbers</option>
              <option value="angles">Bond angles</option>
            </select>
          </label>
          {#if analysis_kind === `rdf` && rdf_structure}
            <RdfPlot
              structures={rdf_structure}
              mode="full"
              cutoff={8}
              n_bins={80}
              show_legend={false}
              {...plot_props}
            />
          {:else if analysis_kind === `coordination`}
            <CoordinationBarPlot
              structures={structure}
              strategy={bonding_strategy}
              {...plot_props}
            />
          {:else if analysis_kind === `angles`}
            <BondAnglePlot
              structures={structure}
              strategy={bonding_strategy}
              split_mode="none"
              show_legend={false}
              {...plot_props}
            />
          {/if}
        {/if}
      </details>
    {/if}

    <section>
      <h4>Usage Tips</h4>
      {#each USAGE_TIPS as [label, value] (label)}
        <div class="tips-item">
          <span>{label}</span>
          <span>{value}</span>
        </div>
      {/each}
    </section>
  </div>
</ViewerPane>

<style>
  .structure-info {
    display: grid;
    gap: 4pt;
    --info-card-accent: 0;
    --info-card-padding: 2pt 4pt;
    --info-row-padding: 0;
    --info-card-heading-gap: 1pt;
    :is(section, details) {
      padding-top: 3pt;
      border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    }
    summary {
      cursor: pointer;
      font-weight: 600;
      font-size: 0.95em;
    }
    h4 {
      margin: 3pt 0;
    }
    input[type='search'] {
      width: 100%;
      box-sizing: border-box;
    }
    p {
      font-size: 0.8em;
      margin: 5pt 0;
    }
    .site-matches {
      display: flex;
      flex-wrap: wrap;
      gap: 3pt;
      margin: 4pt 0;
      small {
        width: 100%;
      }
    }
    .analysis label {
      display: flex;
      align-items: center;
      gap: 6pt;
      margin: 6pt 0;
    }
  }
  .structure-info :global(.site-cards) {
    --info-card-padding: 4pt 8pt;
    --info-row-value-align: left;
    font-size: 0.8em;
  }
  .structure-info :global(.site-card) {
    border-left: 3px solid var(--site-color, #888);
    cursor: pointer;
    outline: none;
  }
  .structure-info :global(.site-card:is(:hover, :focus-visible, .highlighted)) {
    background: color-mix(in srgb, var(--site-color, currentColor) 18%, transparent);
  }
  .structure-info :global(.site-card.selected) {
    box-shadow: inset 0 0 0 1px var(--site-color, currentColor);
    background: color-mix(in srgb, var(--site-color, currentColor) 25%, transparent);
  }
  .tips-item {
    display: grid;
    gap: 1pt;
    padding: 4pt 0;
    font-size: 0.8em;
    line-height: 1.25;
    span:first-child {
      font-weight: 600;
    }
    span:last-child {
      opacity: 0.8;
    }
  }
</style>
