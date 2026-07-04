<script lang="ts">
  import type { PaneProps, PaneToggleProps } from '$lib/overlays'
  import { get_electro_neg_formula } from '$lib/composition'
  import { element_data, type ElementSymbol } from '$lib/element'
  import Icon from '$lib/Icon.svelte'
  import { format_num } from '$lib/labels'
  import type { InfoItem } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import CopyButton from '$lib/overlays/CopyButton.svelte'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { sanitize_html } from '$lib/sanitize'
  import { colors } from '$lib/state.svelte'
  import type { AnyStructure, Site } from '$lib/structure'
  import { get_density } from '$lib/structure'
  import { wyckoff_positions_from_moyo, WyckoffTable } from '$lib/symmetry'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { create_clipboard_feedback } from '$lib/overlays'

  type SiteDetail = {
    label: string
    value: string
    key: string
    tooltip?: string
  }
  type SiteCard = {
    idx: number
    element: string
    element_name: string
    title: string
    details: SiteDetail[]
    search_text: string
  }

  const SITE_WINDOW_SIZE = 100
  const USAGE_TIP_ITEMS: InfoItem[] = [
    {
      label: `File Drop`,
      value: `Drop POSCAR, XYZ, CIF or JSON files to load structures`,
    },
    {
      label: `Atom Selection`,
      value: `Click atoms to select them, then pick distance or angle mode to measure all pairwise distances/angles`,
    },
    {
      label: `Navigation`,
      value: `Hold Shift/Cmd/Ctrl + drag to pan the scene`,
    },
    {
      label: `Camera Reset`,
      value: `Double-click anywhere to reset camera to default view`,
    },
    {
      label: `Colors`,
      value: `Click legend labels to change colors, double-click to reset, right-click to remap elements`,
    },
    {
      label: `Keyboard`,
      value: `Press 'f' for fullscreen, 'i' to toggle this pane`,
    },
  ]

  let {
    structure,
    pane_open = $bindable(false),
    atom_count_thresholds = [50, 500],
    toggle_props = {},
    pane_props = {},
    highlighted_sites = $bindable([]),
    hovered_site_idx = $bindable(null),
    selected_sites = $bindable([]),
    sym_data = null,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `onclose`> & {
    structure: AnyStructure
    pane_open?: boolean
    atom_count_thresholds?: Vec2 // if atom count is less than min_threshold, show sites, if atom count is greater than max_threshold, hide sites. in between, show sites behind a toggle button.
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
    highlighted_sites?: number[] // Sites highlighted from Wyckoff table hover
    hovered_site_idx?: number | null // Site hovered in this pane or in the 3D scene
    selected_sites?: number[] // Sites selected from Wyckoff table click
    sym_data?: MoyoDataset | null // Symmetry analysis data (bindable for external access)
  } = $props()

  const { copied, copy } = create_clipboard_feedback()
  let sites_expanded = $state(false)
  let site_filter = $state(``)
  let site_window_start = $state(0)
  let site_cards_el = $state<HTMLDivElement>()

  const copy_to_clipboard = (label: string, value: string, key: string): Promise<void> =>
    copy(`${label}: ${value}`, key)

  function copy_event(event: MouseEvent, label: string, value: string, key: string) {
    event.stopPropagation()
    copy_to_clipboard(label, value, key)
  }

  function copy_info_item(item: InfoItem) {
    copy_to_clipboard(item.label, String(item.value), item.key ?? item.label)
  }

  function set_site_hover(site_idx: number | null) {
    highlighted_sites = site_idx === null ? [] : [site_idx]
    hovered_site_idx = site_idx
  }

  function select_site(site_idx: number, event?: MouseEvent | KeyboardEvent) {
    if (event?.shiftKey) {
      selected_sites = selected_sites.includes(site_idx)
        ? selected_sites.filter((idx) => idx !== site_idx)
        : [...selected_sites, site_idx]
      return
    }
    selected_sites =
      selected_sites.length === 1 && selected_sites[0] === site_idx ? [] : [site_idx]
  }

  function update_site_filter(event: Event): void {
    if (!(event.currentTarget instanceof HTMLInputElement)) return
    site_filter = event.currentTarget.value
    site_window_start = 0
  }

  function handle_site_keydown(
    event: KeyboardEvent & { currentTarget: HTMLDivElement },
    card: SiteCard,
  ) {
    const plain_key = !event.altKey && !event.ctrlKey && !event.metaKey
    if ([`Enter`, ` `].includes(event.key)) {
      event.preventDefault()
      select_site(card.idx, event)
      return
    }
    if (event.key === `c` && plain_key) {
      event.preventDefault()
      copy_to_clipboard(card.title, site_summary(card), `site-${card.idx}-summary`)
      return
    }
    if (![`ArrowDown`, `ArrowUp`].includes(event.key)) return
    event.preventDefault()
    const current_card = event.currentTarget
    const sibling_cards = Array.from(
      current_card.parentElement?.querySelectorAll<HTMLDivElement>(`.site-card`) ?? [],
    )
    const current_idx = sibling_cards.indexOf(current_card)
    const next_idx =
      event.key === `ArrowDown`
        ? Math.min(current_idx + 1, sibling_cards.length - 1)
        : Math.max(current_idx - 1, 0)
    sibling_cards[next_idx]?.focus()
  }

  const get_element_name = (element: string): string =>
    element_data?.find((element_record) => element_record.symbol === element)?.name || element

  const site_summary = (card: SiteCard): string =>
    [card.element_name, ...card.details.map(({ label, value }) => `${label}: ${value}`)].join(
      `; `,
    )

  function format_site_property(prop_key: string, prop_value: unknown): SiteDetail | null {
    if (prop_value == null) return null
    const format_numeric_value = (value: unknown, format = `.3~f`): string | null => {
      const numeric_value = Number(value)
      return Number.isNaN(numeric_value) ? null : format_num(numeric_value, format)
    }
    const format_value_list = (values: unknown[]): string =>
      `(${values.map((value) => format_numeric_value(value) ?? String(value)).join(`, `)})`
    let tooltip: string | undefined

    if (
      prop_key === `force` &&
      Array.isArray(prop_value) &&
      prop_value.length === 3 &&
      prop_value.every((value) => typeof value === `number`)
    ) {
      const force_values = prop_value as [number, number, number]
      const value = `${format_num(Math.hypot(...force_values), `.3~f`)} eV/Å`
      tooltip = `Force vector: ${force_values
        .map((force) => format_num(force, `.3~f`))
        .join(`, `)} eV/Å`
      return { label: prop_key, value, key: prop_key, tooltip }
    }
    if (prop_key === `magmom` || prop_key.includes(`magnet`)) {
      const formatted_value = format_numeric_value(prop_value)
      if (!formatted_value) return null
      tooltip = `Magnetic moment in Bohr magnetons`
      return { label: prop_key, value: `${formatted_value} μB`, key: prop_key, tooltip }
    }

    const value = Array.isArray(prop_value)
      ? format_value_list(prop_value)
      : (format_numeric_value(prop_value) ?? String(prop_value))
    return { label: prop_key, value, key: prop_key }
  }

  let pane_data = $derived.by(() => {
    if (!structure) return []
    const sections: { title: string; items: InfoItem[] }[] = []

    // Structure Info
    const structure_items: InfoItem[] = [
      {
        label: `Formula`,
        value: `${get_electro_neg_formula(structure)} (${structure.sites.length} sites)`,
        key: `structure-formula`,
      },
      {
        label: `Charge`,
        value: `${structure.charge || 0}e`,
        key: `structure-charge`,
      },
    ]

    if (`properties` in structure) {
      for (const [key, value] of Object.entries(structure.properties ?? {})) {
        // Only display scalar values (skip arrays and objects)
        if (value == null || typeof value === `object`) continue
        structure_items.push({
          label: key.replaceAll('_', ` `).replaceAll(/\b\w/g, (char) => char.toUpperCase()),
          value: String(value),
          key: `structure-prop-${key}`,
        })
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
            value: `${format_num(volume, `.3~s`)} Å³, ${format_num(get_density(structure), `.3~f`)} g/cm³`,
            key: `cell-volume-density`,
          },
          {
            label: `a, b, c`,
            value: `${format_num(a, `.4~f`)}, ${format_num(b, `.4~f`)}, ${format_num(c, `.4~f`)} Å`,
            key: `cell-abc`,
          },
          {
            label: `α, β, γ`,
            value: `${format_num(alpha, `.2~f`)}°, ${format_num(beta, `.2~f`)}°, ${format_num(gamma, `.2~f`)}°`,
            key: `cell-angles`,
          },
        ],
      })
    }

    // Symmetry Info
    if (`lattice` in structure && sym_data) {
      const { operations } = sym_data
      let translations = 0,
        rotations = 0,
        roto_translations = 0
      for (const op of operations) {
        const has_translation = op.translation.some((offset) => offset !== 0)
        const is_identity = String(op.rotation) === `1,0,0,0,1,0,0,0,1`
        if (is_identity && has_translation) translations++
        else if (!has_translation) rotations++
        else roto_translations++
      }

      const international_symbol = (
        sym_data as MoyoDataset & {
          international_short?: string
        }
      ).international_short
      const space_group_symbol = (sym_data.hm_symbol ?? international_symbol)?.replaceAll(
        /\s+/g,
        ``,
      )
      const space_group_value = space_group_symbol
        ? `${sym_data.number} (${space_group_symbol})`
        : String(sym_data.number)

      sections.push({
        title: `Symmetry`,
        items: [
          { label: `Space Group`, value: space_group_value, key: `symmetry-space-group` },
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
    }

    return sections
  })

  let atom_count = $derived(structure?.sites.length ?? 0)
  let sites_allowed_by_threshold = $derived(atom_count <= atom_count_thresholds[1])
  let sites_need_toggle = $derived(
    sites_allowed_by_threshold && atom_count >= atom_count_thresholds[0],
  )
  let site_cards_visible = $derived(
    sites_allowed_by_threshold && (!sites_need_toggle || sites_expanded),
  )

  let site_cards = $derived.by((): SiteCard[] => {
    if (!structure || !site_cards_visible) return []
    return structure.sites.map((site: Site, idx: number) => {
      const element = site.species?.[0]?.element || `Unknown`
      const element_name = get_element_name(element)
      const details: SiteDetail[] = []
      for (const [label, key, coords, unit] of [
        [`Fractional`, `fractional`, site.abc, ``],
        [`Cartesian`, `cartesian`, site.xyz, ` Å`],
      ] as const) {
        if (!coords) continue
        details.push({
          label,
          key,
          value: `(${coords.map((coord) => format_num(coord, `.4~f`)).join(`, `)})${unit}`,
        })
      }
      if (site.properties) {
        for (const [prop_key, prop_value] of Object.entries(site.properties)) {
          const detail = format_site_property(prop_key, prop_value)
          if (detail) details.push(detail)
        }
      }
      const title = `${element}${idx + 1}`
      return {
        idx,
        element,
        element_name,
        title,
        details,
        search_text: `${title} ${element} ${element_name} ${details
          .map(({ label, value }) => `${label} ${value}`)
          .join(` `)}`.toLowerCase(),
      }
    })
  })

  let visible_site_cards = $derived.by(() => {
    const filter = site_filter.trim().toLowerCase()
    if (!filter) return site_cards
    return site_cards.filter(({ search_text }) => search_text.includes(filter))
  })

  let rendered_site_cards = $derived(
    visible_site_cards.slice(site_window_start, site_window_start + SITE_WINDOW_SIZE),
  )
  let site_window_end = $derived(
    Math.min(site_window_start + SITE_WINDOW_SIZE, visible_site_cards.length),
  )
  let sites_hidden_by_threshold = $derived(sites_need_toggle && !sites_expanded)
  let show_sites_section = $derived(
    site_cards.length > 0 || sites_hidden_by_threshold || sites_need_toggle,
  )

  $effect(() => {
    if (site_window_start >= visible_site_cards.length) {
      site_window_start = Math.max(0, visible_site_cards.length - SITE_WINDOW_SIZE)
    }
  })

  $effect(() => {
    const selected_site_idx = selected_sites[0]
    if (!pane_open || selected_site_idx === undefined) return
    const visible_idx = visible_site_cards.findIndex(({ idx }) => idx === selected_site_idx)
    if (visible_idx === -1) return
    const selected_window_start = Math.floor(visible_idx / SITE_WINDOW_SIZE) * SITE_WINDOW_SIZE
    if (selected_window_start !== site_window_start) {
      site_window_start = selected_window_start
      return
    }
    site_cards_el
      ?.querySelector(`[data-site-idx="${selected_site_idx}"]`)
      ?.scrollIntoView({ block: `nearest` })
  })

  // Compute Wyckoff positions from symmetry data
  let wyckoff_positions = $derived(wyckoff_positions_from_moyo(sym_data))
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
  pane_props={{ ...pane_props, class: `structure-info-pane ${pane_props?.class ?? ``}` }}
  {...rest}
>
  <h4 style="margin-top: 0">Structure Info</h4>
  {#each pane_data as section, sec_idx (section.title)}
    {#if sec_idx > 0}<hr />{/if}
    <section>
      {#if section.title && section.title !== `Structure`}
        <h4>{section.title}</h4>
      {/if}
      {#each section.items as item (item.key ?? item.label)}
        {@const { key, label, value, tooltip } = item}
        <div
          class="info-row clickable"
          title={`Click to copy: ${label}: ${value}`}
          onclick={() => copy_info_item(item)}
          role="button"
          tabindex="0"
          onkeydown={(event) => {
            if ([`Enter`, ` `].includes(event.key)) {
              event.preventDefault()
              copy_info_item(item)
            }
          }}
        >
          <span>{@html sanitize_html(label)}</span>
          <span title={tooltip}>{@html sanitize_html(value)}</span>
          {#if key && copied.has(key)}
            <Icon
              icon="Check"
              style="color: var(--success-color, #10b981); width: 12px; height: 12px"
              class="copy-checkmark"
            />
          {/if}
        </div>
      {/each}

      {#if section.title === `Symmetry` && wyckoff_positions.length > 0}
        <WyckoffTable
          {wyckoff_positions}
          on_hover={(site_indices) => (highlighted_sites = site_indices ?? [])}
          on_click={(site_indices) => (selected_sites = site_indices ?? [])}
          style="width: 100%; margin-top: 0.5em; font-size: 0.8em"
        />
      {/if}
    </section>
  {/each}

  {#if show_sites_section}
    <hr />
    <section class="sites-section">
      <div class="sites-header">
        <h4>Sites</h4>
        {#if sites_need_toggle}
          <button
            type="button"
            class="sites-toggle"
            onclick={() => (sites_expanded = !sites_expanded)}
            title="{sites_expanded ? `Hide` : `Show`} all site information"
          >
            {sites_expanded ? `Hide` : `Show ${structure.sites.length} sites`}
          </button>
        {/if}
      </div>
      {#if sites_hidden_by_threshold}
        <p class="sites-note">
          Site list hidden for this {structure.sites.length}-site structure.
        </p>
      {:else if site_cards.length > 0}
        <input
          class="site-filter"
          type="search"
          value={site_filter}
          oninput={update_site_filter}
          placeholder="Filter sites by element, index, coordinate, or property"
          aria-label="Filter sites"
        />
        {#if visible_site_cards.length === 0}
          <p class="sites-note">No sites match "{site_filter}".</p>
        {:else}
          {#if visible_site_cards.length > SITE_WINDOW_SIZE}
            <div class="site-window-controls">
              <button
                type="button"
                disabled={site_window_start === 0}
                onclick={() =>
                  (site_window_start = Math.max(0, site_window_start - SITE_WINDOW_SIZE))}
              >
                Previous
              </button>
              <span
                >{site_window_start + 1}-{site_window_end} of {visible_site_cards.length}</span
              >
              <button
                type="button"
                disabled={site_window_end >= visible_site_cards.length}
                onclick={() =>
                  (site_window_start = Math.min(
                    Math.max(0, visible_site_cards.length - SITE_WINDOW_SIZE),
                    site_window_start + SITE_WINDOW_SIZE,
                  ))}
              >
                Next
              </button>
            </div>
          {/if}
          <div class="site-cards" bind:this={site_cards_el}>
            {#each rendered_site_cards as card (card.idx)}
              {@const is_highlighted =
                highlighted_sites.includes(card.idx) || hovered_site_idx === card.idx}
              {@const is_selected = selected_sites.includes(card.idx)}
              <div
                class="site-card"
                class:highlighted={is_highlighted}
                class:selected={is_selected}
                data-site-idx={card.idx}
                style:--site-color={colors.element?.[card.element as ElementSymbol] ?? `#888`}
                title="Click to select {card.title}. Press c to copy."
                role="button"
                tabindex="0"
                onmouseenter={() => set_site_hover(card.idx)}
                onmouseleave={() => set_site_hover(null)}
                onfocus={() => set_site_hover(card.idx)}
                onblur={() => set_site_hover(null)}
                onclick={(event) => select_site(card.idx, event)}
                onkeydown={(event) => handle_site_keydown(event, card)}
              >
                <div class="site-card-header">
                  <span class="site-title">
                    <span class="site-color" aria-hidden="true"></span>
                    <strong>{card.title}</strong>
                    <span>{card.element_name}</span>
                  </span>
                  <CopyButton
                    label="Copy {card.title}"
                    title="Copy {card.title}"
                    copied={copied.has(`site-${card.idx}-summary`)}
                    onclick={(event) =>
                      copy_event(
                        event,
                        card.title,
                        site_summary(card),
                        `site-${card.idx}-summary`,
                      )}
                  />
                </div>
                <div class="site-card-details">
                  {#each card.details as detail (`site-${card.idx}-${detail.key}`)}
                    <div class="site-detail">
                      <span>{@html sanitize_html(detail.label)}</span>
                      <span title={detail.tooltip}>{@html sanitize_html(detail.value)}</span>
                      <CopyButton
                        label="Copy {card.title} {detail.label}"
                        title="Copy {detail.label}"
                        copied={copied.has(`site-${card.idx}-${detail.key}`)}
                        onclick={(event) =>
                          copy_event(
                            event,
                            `${card.title} ${detail.label}`,
                            detail.value,
                            `site-${card.idx}-${detail.key}`,
                          )}
                      />
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </section>
  {/if}

  <hr />
  <section>
    <h4>Usage Tips</h4>
    {#each USAGE_TIP_ITEMS as { label, value } (label)}
      <div class="tips-item">
        <span>{@html sanitize_html(label)}</span>
        <span>{@html sanitize_html(value)}</span>
      </div>
    {/each}
  </section>
</DraggablePane>

<style>
  .info-row,
  .tips-item {
    display: flex;
    justify-content: space-between;
    gap: 6pt;
    padding: 1pt;
    line-height: 1.5;
  }
  .info-row.clickable {
    cursor: pointer;
    position: relative;
    &:hover {
      background: var(--pane-btn-bg-hover, rgba(255, 255, 255, 0.03));
    }
  }
  .sites-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6pt;
    h4 {
      margin: 0.5em 0;
    }
  }
  .sites-toggle,
  .site-window-controls button {
    border: 0;
    border-radius: var(--border-radius, 3pt);
    background: color-mix(in srgb, currentColor 8%, transparent);
    color: inherit;
    cursor: pointer;
  }
  .sites-toggle {
    padding: 2pt 5pt;
    font-size: 0.8em;
  }
  .site-filter {
    box-sizing: border-box;
    width: 100%;
    margin-bottom: 5pt;
    padding: 4pt 6pt;
    border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    border-radius: var(--border-radius, 3pt);
    background: color-mix(in srgb, var(--pane-bg, Canvas) 88%, currentColor);
    color: inherit;
  }
  .sites-note {
    margin: 0.25em 0 0.5em;
    opacity: 0.75;
    font-size: 0.85em;
  }
  .site-window-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 5pt;
    margin-bottom: 5pt;
    font-size: 0.8em;
    button {
      padding: 2pt 5pt;
      &:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }
    }
  }
  .site-cards {
    display: grid;
    gap: 5pt;
  }
  .site-card {
    border-left: 3px solid var(--site-color, #888);
    border-radius: var(--border-radius, 3pt);
    background: color-mix(in srgb, currentColor 4%, transparent);
    padding: 5pt;
    cursor: pointer;
    outline: none;
    &:is(:hover, :focus-visible, .highlighted) {
      background: color-mix(in srgb, var(--site-color, currentColor) 18%, transparent);
    }
    &.selected {
      box-shadow: inset 0 0 0 1px var(--site-color, currentColor);
      background: color-mix(in srgb, var(--site-color, currentColor) 25%, transparent);
    }
  }
  .site-card-header,
  .site-title,
  .site-detail {
    display: flex;
    align-items: center;
    gap: 5pt;
  }
  .site-card-header {
    justify-content: space-between;
  }
  .site-title {
    min-width: 0;
    span:last-child {
      opacity: 0.75;
    }
  }
  .site-color {
    width: 0.75em;
    height: 0.75em;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--site-color, #888);
  }
  .site-card-details {
    display: grid;
    gap: 2pt;
    margin-top: 3pt;
    font-size: 0.86em;
  }
  .site-detail {
    justify-content: space-between;
    span:first-child {
      opacity: 0.75;
    }
    span:nth-child(2) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
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
  .tips-item {
    flex-direction: column;
    gap: 2pt;
    span:last-child {
      opacity: 0.8;
    }
  }
</style>
