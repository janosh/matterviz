<script lang="ts">
  import { InformationOutline } from 'svelte-widgets/icons'
  import { format_num } from 'svelte-widgets/format'
  import type { PaneProps, PaneToggleProps } from '#lib/overlays/index.js'
  import { ViewerPane } from '#lib/overlays/index.js'
  import InfoPaneCards from '#lib/overlays/InfoPaneCards.svelte'
  import { untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { ShortcutScope } from '#lib/shortcuts.js'
  import type { CompositionType } from '#lib/composition/index.js'
  import { parse_composition } from '#lib/composition/parse.js'
  import type { ElementSymbol } from '#lib/element/index.js'
  import { type OpenElements, to_model_composition } from './model'
  import ConvexHullStats from './ConvexHullStats.svelte'
  import {
    get_entry_label,
    type HullProbe,
    visible_entries as filter_visible,
  } from './helpers'
  import { to_error } from 'svelte-widgets/utils'
  import type { ConvexHullEntry, EntryCategoryConfig, PhaseStats } from './types'
  import { MAGNETIC_ORDERING_CATEGORY } from './types'

  let {
    phase_stats,
    stable_entries,
    unstable_entries,
    show_stable = true,
    show_unstable = true,
    entry_category = MAGNETIC_ORDERING_CATEGORY,
    hidden_categories = [],
    max_hull_dist_show_phases,
    max_hull_dist_show_labels,
    label_threshold,
    pane_open = $bindable(false),
    probe_composition = $bindable(null),
    probe_submission = $bindable(null),
    probe = null,
    elements = [],
    components,
    open_elements,
    toggle_props = {},
    pane_props = {},
    shortcut_scopes,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    phase_stats: PhaseStats | null
    stable_entries: ConvexHullEntry[]
    unstable_entries: ConvexHullEntry[]
    show_stable?: boolean
    show_unstable?: boolean
    entry_category?: EntryCategoryConfig | null
    hidden_categories?: string[]
    max_hull_dist_show_phases: number
    max_hull_dist_show_labels: number
    label_threshold: number
    pane_open?: boolean
    // Composition entered in the probe field, and its decomposition (null: none or outside)
    probe_composition?: CompositionType | null
    // The last submitted formula and the model composition it gave, kept by the hull across
    // remounts of this pane
    probe_submission?: { text: string; model: string } | null
    probe?: HullProbe | null
    elements?: ElementSymbol[]
    // the hull's composition keys, which typed formulas are converted to before probing
    components?: readonly string[]
    open_elements?: OpenElements
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
    shortcut_scopes?: readonly ShortcutScope[] // the hull's, listed at the pane's bottom
  } = $props()

  // "visible / total"; show flags true: filter_visible only applies the category filter here
  const visible_of = (entries: ConvexHullEntry[], shown: boolean): string => {
    const n_visible = shown
      ? filter_visible(entries, true, true, entry_category, hidden_categories).length
      : 0
    return `${n_visible} / ${entries.length}`
  }
  const energy = (value: number): string => `${format_num(value, `.3~f`)} eV/atom`

  let settings_rows = $derived(
    [
      [`Visible stable`, visible_of(stable_entries, show_stable), `visible-stable`],
      [`Visible unstable`, visible_of(unstable_entries, show_unstable), `visible-unstable`],
      [`Points threshold`, energy(max_hull_dist_show_phases), `show-threshold`],
      [`Label threshold`, energy(max_hull_dist_show_labels), `label-threshold`],
      [`Entry limit for labels`, `${label_threshold} entries`, `entry-limit-labels`],
    ].map(([label, value, key]) => ({ label, value, key: `hull-${key}` })),
  )

  // Pointer gestures only: the pane's shortcuts list covers the keys of the hull's dimension
  const usage_tips = $derived([
    { label: `Single click`, value: `Select point`, key: `tip-click` },
    { label: `Double click`, value: `Copy info`, key: `tip-double-click` },
    // the 2D scatter plot has no camera to rotate or pan
    ...(shortcut_scopes?.includes(`camera`)
      ? [
          { label: `Drag`, value: `Rotate view`, key: `tip-drag` },
          { label: `Shift drag`, value: `Pan view`, key: `tip-pan` },
        ]
      : []),
  ])
  // === Composition probe ===
  let probe_text = $state(``)
  let parse_error = $state<string | null>(null)
  const apply_probe = (text: string) => {
    parse_error = null
    try {
      const parsed = text ? parse_composition(text) : null
      probe_composition = parsed && to_model_composition(parsed, components, open_elements)
      if (parsed && !probe_composition) {
        parse_error = `${text} is outside the ${elements.join(`-`)} system`
      }
    } catch (err) {
      parse_error = `Can't parse ${text}: ${to_error(err).message}`
    }
    probe_submission = { text, model: JSON.stringify(probe_composition) }
  }
  const submit_probe = (event: SubmitEvent) => {
    event.preventDefault()
    apply_probe(probe_text.trim())
  }
  // A new component basis or set of open elements gives the submitted formula other model
  // coordinates: project it again. A probe the host has set since stays as given, and so does
  // every probe when only a chemical potential changes.
  const basis = $derived(JSON.stringify([components, Object.keys(open_elements ?? {})]))
  $effect(() => {
    void basis
    untrack(() => {
      if (probe_submission && JSON.stringify(probe_composition) === probe_submission.model) {
        apply_probe(probe_submission.text)
      }
    })
  })
  // a composition set here or by the host that the hull can't decompose is outside its system
  const probe_error = $derived(
    parse_error ??
      (probe_composition && !probe
        ? `${get_entry_label({ composition: probe_composition }, elements)} is outside the ${elements.join(`-`)} system`
        : null),
  )
  let probe_card = $derived(
    probe && {
      title: `Decomposition`,
      rows: [
        { label: `Hull E<sub>form</sub>`, value: energy(probe.energy), key: `probe-energy` },
        ...probe.decomposition.map(({ phase, atom_fraction }, idx) => ({
          label: get_entry_label(phase, elements),
          value: format_num(atom_fraction, `.1~%`),
          key: `probe-product-${idx}`,
        })),
      ],
    },
  )

  let info_cards = $derived([
    { title: `Visualization Settings`, rows: settings_rows },
    { title: `Usage Tips`, rows: usage_tips },
  ])

  const info_card_style = [
    `--info-card-padding: 3pt`,
    `--info-card-bg: var(--pane-bg, white)`,
    `--info-card-heading-gap: 6px`,
    `--info-row-padding: 1pt`,
    `--info-row-label-color: var(--text-color-muted, #666)`,
  ].join(`; `)
</script>

<ViewerPane
  bind:open={pane_open}
  pane_name="convex hull info"
  class_prefix="convex-hull-info"
  max_width="24em"
  {toggle_props}
  {pane_props}
  closed_icon={InformationOutline}
  {shortcut_scopes}
  {...rest}
>
  <form class="composition-probe" onsubmit={submit_probe}>
    <label>
      Probe composition
      <input
        type="text"
        bind:value={probe_text}
        placeholder="e.g. {elements.join(``)}"
        aria-invalid={probe_error !== null}
      />
    </label>
    <button type="submit">Decompose</button>
  </form>
  {#if probe_error}
    <p class="probe-error" role="alert">{probe_error}</p>
  {:else if probe_card}
    <InfoPaneCards
      cards={[probe_card]}
      show_filter={false}
      empty_label="decomposition"
      heading_level={5}
      style={info_card_style}
    />
  {/if}

  <!-- A closed pane stays mounted (hidden), and these stats rebuild their entry table on every
    threshold step, so they only exist while someone can see them -->
  {#if pane_open}
    <ConvexHullStats
      model={{ entries: [...stable_entries, ...unstable_entries], phase_stats }}
      {show_stable}
      {show_unstable}
      {entry_category}
      {hidden_categories}
      style="padding: 3pt; background: var(--pane-bg); --hull-stats-table-height: 30rem"
    />
  {/if}

  <InfoPaneCards
    cards={info_cards}
    filter_placeholder="Filter hull info"
    empty_label="hull info"
    heading_level={5}
    style={info_card_style}
  />
</ViewerPane>

<style>
  .composition-probe {
    display: flex;
    gap: 4pt;
    align-items: end;
    padding: 3pt;
    label {
      display: flex;
      flex-direction: column;
      flex: 1;
      font-size: 0.9em;
    }
    input {
      min-width: 0;
    }
  }
  .probe-error {
    margin: 0 3pt;
    color: var(--error-color, #c00);
    font-size: 0.85em;
  }
</style>
