<script lang="ts">
  import ExportPane from '$lib/io/ExportPane.svelte'

  import { DEFAULT_PNG_DPI, ELEMENT_COLOR_SCHEME_NAMES } from '$lib/constants'
  import type { CompositionType } from '$lib/composition'
  import { ActionMenu, Icon } from 'svelte-widgets'
  import type { CmdAction, CmdSection, IconData } from 'svelte-widgets'
  import {
    Circle,
    ColorPalette,
    Copy,
    Download,
    Graph,
    ScatterPlot,
  } from 'svelte-widgets/icons'
  import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
  import type { CompositionChartProps } from './chart'
  import BarChart from './BarChart.svelte'
  import BubbleChart from './BubbleChart.svelte'
  import { get_electro_neg_formula } from './format'
  import { parse_composition } from './parse'
  import PieChart from './PieChart.svelte'

  type CompositionChartMode = `pie` | `bubble` | `bar`
  type CompositionAction = CmdAction & { icon: IconData }
  let {
    composition,
    mode = $bindable(`pie`),
    on_parse,
    color_scheme = $bindable(`Vesta`),
    ...rest
  }: Omit<CompositionChartProps, `composition` | `svg_node`> & {
    composition: string | CompositionType
    mode?: CompositionChartMode
    on_parse?: (composition: CompositionType) => void
  } = $props()

  let svg_node = $state<SVGSVGElement | null>(null)

  let Component = $derived({ pie: PieChart, bubble: BubbleChart, bar: BarChart }[mode])
  let parsed = $derived(parse_composition(composition))
  $effect(() => on_parse?.(parsed))

  let context_menu_at = $state<{ x: number; y: number } | null>(null)
  let export_pane_open = $state(false)

  async function copy_text(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      console.error(`Export failed:`, error)
    }
  }

  const mode_actions = (
    [
      [`pie`, Circle, `Pie Chart`],
      [`bubble`, ScatterPlot, `Bubble Chart`],
      [`bar`, Graph, `Bar Chart`],
    ] as const
  ).map(([id, icon, label]) => ({ id, icon, label, action: () => (mode = id) }))

  const color_scheme_actions = ELEMENT_COLOR_SCHEME_NAMES.map((identifier) => ({
    id: identifier,
    icon: ColorPalette,
    label: identifier,
    action: () => (color_scheme = identifier),
  }))

  const export_actions = (
    [
      [
        `copy_formula`,
        Copy,
        `Copy Formula`,
        () =>
          copy_text(
            get_electro_neg_formula(parsed, { plain_text: true, amount_format: `.12~g` }),
          ),
      ],
      [`copy_data`, Copy, `Copy Data`, () => copy_text(JSON.stringify(parsed, null, 2))],
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
    <Icon icon={action.icon} />
    {action.label}
  {/snippet}
</ActionMenu>

<ExportPane
  bind:export_pane_open
  filename={get_electro_neg_formula(parsed, { plain_text: true, delim: `` })}
  toggle_props={{ style: `display: none` }}
  sections={[
    {
      title: `Export composition`,
      items: [
        {
          label: `SVG`,
          on_download: ({ filename, save }) =>
            export_svg_as_svg(svg_node, `${filename}.svg`, [], {}, save),
        },
        {
          label: `PNG`,
          on_download: ({ filename, save }) =>
            export_svg_as_png(svg_node, `${filename}.png`, DEFAULT_PNG_DPI, [], {}, save),
        },
      ],
    },
  ]}
/>
