<script lang="ts">
  import ExportPane from '#lib/io/ExportPane.svelte'

  import { ELEMENT_COLOR_SCHEMES, ELEMENT_COLOR_SCHEME_NAMES } from '#lib/colors/index'
  import ActionMenu from 'svelte-widgets/ActionMenu.svelte'
  import Icon from 'svelte-widgets/Icon.svelte'
  import { copy_text } from 'svelte-widgets/browser'
  import type { CmdAction, CmdSection, IconData } from 'svelte-widgets'
  import {
    BarPlot,
    Braces,
    BubblePlot,
    Download,
    Molecule,
    PieChart as PieIcon,
  } from 'svelte-widgets/icons'
  import { figure_sources } from '#lib/io/export'
  import { type CompositionChartProps, MISSING_ELEMENT_COLOR } from './chart'
  import BarChart from './BarChart.svelte'
  import BubbleChart from './BubbleChart.svelte'
  import { get_species_formula } from './format'
  import type { SpeciesComposition } from './parse'
  import { parse_species_composition, parse_species_key } from './parse'
  import PieChart from './PieChart.svelte'

  type CompositionChartMode = `pie` | `bubble` | `bar`
  // color schemes show swatches of the charted elements in place of an icon
  type CompositionAction = CmdAction & { icon?: IconData; swatches?: string[] }
  let {
    composition,
    mode = $bindable(`pie`),
    on_parse,
    color_scheme = $bindable(`Vesta`),
    ...rest
  }: Omit<CompositionChartProps, `composition` | `svg_node`> & {
    // Formula string (parsed, charges like Fe2+O2- kept) or amounts keyed by element or
    // species ({ Fe: 2, O: 3 }, { 'Fe2+': 1, 'O2-': 1 }) to chart.
    composition: string | SpeciesComposition
    // Chart type: `pie`, `bubble` or `bar`. Bindable, also changed from the context menu.
    mode?: CompositionChartMode
    // Called with the parsed composition (canonical species keys) whenever it changes.
    on_parse?: (composition: SpeciesComposition) => void
  } = $props()

  let svg_node = $state<SVGSVGElement | null>(null)

  let Component = $derived({ pie: PieChart, bubble: BubbleChart, bar: BarChart }[mode])
  let parsed = $derived(parse_species_composition(composition))
  $effect(() => on_parse?.(parsed))

  let context_menu_at = $state<{ x: number; y: number } | null>(null)
  let export_pane_open = $state(false)

  const mode_actions = (
    [
      [`pie`, PieIcon, `Pie Chart`],
      [`bubble`, BubblePlot, `Bubble Chart`],
      [`bar`, BarPlot, `Bar Chart`],
    ] as const
  ).map(([id, icon, label]) => ({ id, icon, label, action: () => (mode = id) }))

  const color_scheme_actions = $derived(
    ELEMENT_COLOR_SCHEME_NAMES.map((identifier) => ({
      id: identifier,
      // one swatch per element: Fe2+ and Fe3+ share a color
      swatches: [...new Set(Object.keys(parsed).map((key) => parse_species_key(key).element))]
        .slice(0, 4)
        .map((elem) => ELEMENT_COLOR_SCHEMES[identifier][elem] ?? MISSING_ELEMENT_COLOR),
      label: identifier,
      action: () => (color_scheme = identifier),
    })),
  )

  const export_actions = (
    [
      [
        `copy_formula`,
        Molecule,
        `Copy Formula`,
        () => copy_text(get_species_formula(parsed, { amount_format: `.12~g` })),
      ],
      [`copy_data`, Braces, `Copy Data`, () => copy_text(JSON.stringify(parsed, null, 2))],
      [
        `export_files`,
        Download,
        `Export files…`,
        () => {
          if (svg_node) export_pane_open = true
          else console.warn(`Chart SVG not available for export`)
        },
      ],
    ] as const
  ).map(([id, icon, label, action]) => ({ id, icon, label, action }))

  const context_menu_actions = $derived<CmdSection<CompositionAction>[]>([
    { title: `Display Mode`, selected: mode, actions: mode_actions },
    { title: `Color Scheme`, selected: color_scheme, actions: color_scheme_actions },
    { title: `Export`, actions: export_actions },
  ])
</script>

<!-- the chart itself is the right-click region; `at` is also set from the keyboard
path below, which has no pointer position to read -->
<ActionMenu bind:at={context_menu_at} actions={context_menu_actions}>
  <Component
    composition={parsed}
    {color_scheme}
    bind:svg_node
    role="button"
    tabindex={0}
    onkeydown={(event: KeyboardEvent) => {
      if ([`Enter`, ` `].includes(event.key)) {
        event.preventDefault()
        const target = event.currentTarget
        if (!(target instanceof Element)) return
        const rect = target.getBoundingClientRect()
        context_menu_at = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        }
      }
    }}
    aria-label="Open context menu (Right-click or Enter/Space)"
    aria-haspopup="menu"
    aria-expanded={context_menu_at !== null}
    {...rest}
    class={[`composition`, rest.class]}
  />
  {#snippet item({ action })}
    {#if action.icon}
      <Icon icon={action.icon} />
    {:else if action.swatches}
      <span class="swatches">
        {#each action.swatches as color, idx (idx)}
          <span style:background={color}></span>
        {/each}
      </span>
    {/if}
    {action.label}
  {/snippet}
</ActionMenu>

<ExportPane
  bind:export_pane_open
  filename={get_species_formula(parsed, { delim: `` })}
  toggle_props={{ style: `display: none` }}
  sources={figure_sources(() => svg_node)}
/>

<style>
  .swatches {
    display: inline-flex;
    width: 1em; /* as wide as the icons above, so labels line up */
    height: 1em;
    border-radius: 2px;
    overflow: hidden;
    span {
      flex: 1;
    }
  }
</style>
