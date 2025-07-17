<script lang="ts">
  import type { ColorSchemeName, CompositionType } from '$lib'
  import { ContextMenu } from '$lib'
  import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
  import { BarChart, BubbleChart, PieChart } from './index'
  import { get_electro_neg_formula, parse_composition } from './parse'

  type CompositionChartMode = `pie` | `bubble` | `bar`
  interface Props {
    composition: string | CompositionType
    mode?: CompositionChartMode
    on_composition_change?: (composition: CompositionType) => void
    color_scheme?: ColorSchemeName
    [key: string]: unknown
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

  // Context menu state
  let context_menu_open = $state(false)
  let context_menu_position = $state({ x: 0, y: 0 })

  function handle_double_click(event: MouseEvent) { // open context menu
    event.preventDefault()
    // Convert viewport coords to document coords
    const x = event.clientX + (window.scrollX || document.documentElement.scrollLeft)
    const y = event.clientY + (window.scrollY || document.documentElement.scrollTop)
    context_menu_position = { x, y }
    context_menu_open = true
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

  const context_menu_sections = [
    { title: `Display Mode`, options: mode_options },
    { title: `Color Scheme`, options: color_scheme_options },
    { title: `Export`, options: export_options },
  ] as const

  function handle_context_menu_select(
    section_title: string,
    option: { value: string },
  ) {
    if (section_title === `Display Mode`) {
      current_mode = option.value as CompositionChartMode
    } else if (section_title === `Color Scheme`) {
      current_color_scheme = option.value as ColorSchemeName
    } else if (section_title === `Export`) handle_export(option.value)
    context_menu_open = false
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
        export_svg_as_svg(svg_node, filename)
      } else if (export_type === `export_png`) {
        const filename = `${get_electro_neg_formula(composition, true, ``)}.png`
        export_svg_as_png(svg_node, filename, 150)
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
  ondblclick={handle_double_click}
  role="button"
  tabindex="0"
  aria-label="Double-click to open context menu"
  {...rest}
  class="composition {rest.class ?? ``}"
/>

{#if context_menu_open}
  <ContextMenu
    sections={context_menu_sections}
    selected_values={{
      'Display Mode': current_mode,
      'Color Scheme': current_color_scheme,
    }}
    on_select={handle_context_menu_select}
    position={context_menu_position}
    visible={context_menu_open}
    on_close={() => context_menu_open = false}
  />
{/if}
