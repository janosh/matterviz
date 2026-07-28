<script lang="ts">
  import type { ColorSchemeName } from '$lib/colors'
  import type { CompositionType } from '$lib/composition'
  import Icon from '$lib/Icon.svelte'
  import type { IconName } from '$lib/icons'
  import { untrack } from 'svelte'
  import { ContextMenu } from 'svelte-widgets'
  import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
  import type { SVGAttributes } from 'svelte/elements'
  import { get_electro_neg_formula } from './format'
  import { BarChart, BubbleChart, PieChart } from './index'
  import { parse_composition } from './parse'

  type CompositionChartMode = `pie` | `bubble` | `bar`
  let {
    composition,
    mode = `pie`,
    on_composition_change,
    color_scheme = `Vesta`,
    ...rest
  }: SVGAttributes<SVGSVGElement> & {
    composition: string | CompositionType
    mode?: CompositionChartMode
    on_composition_change?: (composition: CompositionType) => void
    color_scheme?: ColorSchemeName
    size?: number
    interactive?: boolean
  } = $props()

  // Using $state with untrack() - initialized from props but mutated by context menu
  let current_color_scheme = $state(untrack(() => color_scheme as ColorSchemeName))
  let current_mode = $state(untrack(() => mode))
  let svg_node = $state<SVGSVGElement | null>(null)

  let Component = $derived({ pie: PieChart, bubble: BubbleChart, bar: BarChart }[current_mode])
  let parsed: CompositionType = $derived.by(() => {
    try {
      return parse_composition(composition)
    } catch (error) {
      console.error(`Failed to parse composition:`, error)
      return {}
    }
  })
  // Call the composition change callback in an effect, not in the derived
  $effect(() => on_composition_change?.(parsed))

  let context_menu_at = $state<{ x: number; y: number } | null>(null)

  const mode_actions = (
    [
      [`pie`, `Circle`, `Pie Chart`],
      [`bubble`, `Circle`, `Bubble Chart`],
      [`bar`, `Graph`, `Bar Chart`],
    ] as const
  ).map(([id, icon, label]) => ({
    id,
    icon,
    label,
    action: () => (current_mode = id),
  }))

  const color_scheme_actions = (
    [`Vesta`, `Jmol`, `Alloy`, `Pastel`, `Muted`, `Dark Mode`] as const
  ).map((id) => ({
    id,
    icon: `ColorPalette`,
    label: id,
    action: () => (current_color_scheme = id),
  }))

  const export_actions = (
    [
      [`copy_formula`, `Copy`, `Copy Formula`],
      [`copy_data`, `Copy`, `Copy Data`],
      [`export_svg`, `Download`, `Export SVG`],
      [`export_png`, `Download`, `Export PNG`],
    ] as const
  ).map(([id, icon, label]) => ({ id, icon, label, action: () => handle_export(id) }))

  const context_menu_actions = $derived([
    { title: `Display Mode`, selected: current_mode, actions: mode_actions },
    { title: `Color Scheme`, selected: current_color_scheme, actions: color_scheme_actions },
    { title: `Export`, actions: export_actions },
  ])

  // Handle export actions
  function handle_export(export_type: string) {
    try {
      if (export_type === `copy_formula`) {
        const formula = get_electro_neg_formula(composition)
        navigator.clipboard.writeText(formula)
      } else if (export_type === `copy_data`) {
        const data = JSON.stringify(parsed, null, 2)
        navigator.clipboard.writeText(data)
      } else if (export_type === `export_svg`) {
        const filename = `${get_electro_neg_formula(composition, true, ``)}.svg`
        if (svg_node) export_svg_as_svg(svg_node, filename)
        else console.warn(`Chart SVG not available for SVG export`)
      } else if (export_type === `export_png`) {
        const filename = `${get_electro_neg_formula(composition, true, ``)}.png`
        if (svg_node) export_svg_as_png(svg_node, filename, 150)
        else console.warn(`Chart SVG not available for PNG export`)
      } else console.warn(`Invalid export type:`, export_type)
    } catch (error) {
      console.error(`Export failed:`, error)
    }
  }
</script>

<!-- the chart itself is the right-click region; `at` is also set from the keyboard
path below, which has no pointer position to read -->
<ContextMenu bind:at={context_menu_at} actions={context_menu_actions}>
  <Component
    composition={parsed}
    color_scheme={current_color_scheme}
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
    {#if typeof action.icon === `string`}
      <Icon icon={action.icon as IconName} />
    {/if}
    <span>{action.label}</span>
  {/snippet}
</ContextMenu>
