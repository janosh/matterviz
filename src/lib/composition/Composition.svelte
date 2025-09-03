<script lang="ts">
  import type { ColorSchemeName, CompositionType } from '$lib'
  import { ContextMenu } from '$lib'
  import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
  import type { SVGAttributes } from 'svelte/elements'
  import { BarChart, BubbleChart, PieChart } from './index'
  import { get_electro_neg_formula, parse_composition } from './parse'

  type CompositionChartMode = `pie` | `bubble` | `bar`
  interface Props extends SVGAttributes<SVGSVGElement> {
    composition: string | CompositionType
    mode?: CompositionChartMode
    on_composition_change?: (composition: CompositionType) => void
    color_scheme?: ColorSchemeName
  }
  let {
    composition,
    mode = `pie`,
    on_composition_change,
    color_scheme = `Vesta`,
    ...rest
  }: Props = $props()

  // Make these reactive so context menu changes propagate
  let current_color_scheme = $state(color_scheme as ColorSchemeName)
  let current_mode = $state(mode)
  let svg_node = $state<SVGSVGElement | null>(null)

  let Component = $derived(
    { pie: PieChart, bubble: BubbleChart, bar: BarChart }[current_mode],
  )
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

  let context_menu = $state({ open: false, x: 0, y: 0 })

  function handle_right_click(event: MouseEvent) { // open context menu
    event.preventDefault()
    context_menu.open = false // Close any existing context menu first
    context_menu.x = event.pageX
    context_menu.y = event.pageY
    // Use a small delay to ensure the prev context menu closes happens before opening new one
    setTimeout(() => context_menu.open = true, 0)
  }

  const mode_options = [
    { value: `pie`, icon: `Circle`, label: `Pie Chart` },
    { value: `bubble`, icon: `Circle`, label: `Bubble Chart` },
    { value: `bar`, icon: `Graph`, label: `Bar Chart` },
  ] as const

  const color_scheme_options = [
    { value: `Vesta`, icon: `ColorPalette`, label: `Vesta` },
    { value: `Jmol`, icon: `ColorPalette`, label: `Jmol` },
    { value: `Alloy`, icon: `ColorPalette`, label: `Alloy` },
    { value: `Pastel`, icon: `ColorPalette`, label: `Pastel` },
    { value: `Muted`, icon: `ColorPalette`, label: `Muted` },
    { value: `Dark Mode`, icon: `ColorPalette`, label: `Dark Mode` },
  ] as const

  const export_options = [
    { value: `copy_formula`, icon: `Copy`, label: `Copy Formula` },
    { value: `copy_data`, icon: `Copy`, label: `Copy Data` },
    { value: `export_svg`, icon: `Download`, label: `Export SVG` },
    { value: `export_png`, icon: `Download`, label: `Export PNG` },
  ] as const

  const sec_titles = {
    display_mode: `Display Mode`,
    color_scheme: `Color Scheme`,
    export: `Export`,
  } as const

  const context_menu_sections = [
    { title: sec_titles.display_mode, options: mode_options },
    { title: sec_titles.color_scheme, options: color_scheme_options },
    { title: sec_titles.export, options: export_options },
  ] as const

  function handle_context_menu_select(
    section_title: string,
    option: { value: string },
  ) {
    if (section_title === sec_titles.display_mode) {
      current_mode = option.value as CompositionChartMode
    } else if (section_title === sec_titles.color_scheme) {
      current_color_scheme = option.value as ColorSchemeName
    } else if (section_title === sec_titles.export) handle_export(option.value)
    context_menu.open = false
  }

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

<Component
  composition={parsed}
  color_scheme={current_color_scheme}
  bind:svg_node
  oncontextmenu={handle_right_click}
  role="button"
  tabindex={0}
  onkeydown={(event: KeyboardEvent) => {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      const target = event.currentTarget as Element
      const rect = target.getBoundingClientRect()
      context_menu.x = window.scrollX + rect.left + rect.width / 2
      context_menu.y = window.scrollY + rect.top + rect.height / 2
      context_menu.open = true
    }
  }}
  aria-label="Open context menu (Right-click or Enter/Space)"
  aria-haspopup="menu"
  aria-expanded={context_menu.open}
  {...rest}
  class="composition {rest.class ?? ``}"
/>

{#if context_menu.open}
  <ContextMenu
    sections={context_menu_sections}
    selected_values={{
      [sec_titles.display_mode]: current_mode,
      [sec_titles.color_scheme]: current_color_scheme,
    }}
    on_select={handle_context_menu_select}
    position={context_menu}
    visible={context_menu.open}
    on_close={() => context_menu.open = false}
  />
{/if}
