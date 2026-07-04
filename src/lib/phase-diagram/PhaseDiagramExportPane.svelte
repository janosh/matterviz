<script lang="ts">
  import type { PaneToggleProps } from '$lib/overlays'
  import type { ExportSection } from '$lib/io'
  import ExportPane from '$lib/io/ExportPane.svelte'
  import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
  import { download } from '$lib/io/fetch'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { PhaseDiagramData } from './types'

  let {
    export_pane_open = $bindable(false),
    data,
    json_payload = undefined,
    wrapper,
    svg_element = undefined,
    svg_query_selector = `svg.binary-phase-diagram`,
    filename = `phase-diagram`,
    png_dpi = $bindable(150),
    icon_style = ``,
    toggle_props: caller_toggle_props = {},
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    export_pane_open?: boolean
    data?: PhaseDiagramData
    json_payload?: unknown
    wrapper?: HTMLDivElement
    svg_element?: SVGSVGElement | null
    svg_query_selector?: string
    filename?: string
    png_dpi?: number
    icon_style?: string
    toggle_props?: PaneToggleProps
  } = $props()

  // Generate filename with components if available (requires exactly 2 components)
  const full_filename = $derived(
    data?.components?.length === 2
      ? `${filename}-${data.components[0]}-${data.components[1]}`
      : filename,
  )

  const svg = $derived(
    svg_element ?? (wrapper?.querySelector(svg_query_selector) as SVGSVGElement | null),
  )

  const json_export_data = $derived(json_payload ?? data)
  const json_string = (): string | null =>
    json_export_data ? JSON.stringify(json_export_data, null, 2) : null

  const sections = $derived<ExportSection[]>([
    {
      title: `Image`,
      tooltip: `Download or copy the phase diagram`,
      items: [
        {
          label: `SVG`,
          disabled: !svg,
          on_download: () => svg && export_svg_as_svg(svg, `${full_filename}.svg`),
          copy_text: () => (svg ? new XMLSerializer().serializeToString(svg) : null),
        },
        {
          label: `PNG`,
          disabled: !svg,
          show_dpi: true,
          on_download: () => svg && export_svg_as_png(svg, `${full_filename}.png`, png_dpi),
        },
      ],
    },
    {
      title: `Data`,
      tooltip: `Export phase diagram data as JSON`,
      items: [
        {
          label: `JSON`,
          disabled: !json_export_data,
          on_download: () => {
            const content = json_string()
            if (content) download(content, `${full_filename}.json`, `application/json`)
          },
          copy_text: json_string,
        },
      ],
    },
  ])
</script>

<ExportPane
  bind:export_pane_open
  bind:png_dpi
  {sections}
  {icon_style}
  toggle_props={{
    class: `pd-export-toggle`,
    title: export_pane_open ? `` : `Export phase diagram`,
    ...caller_toggle_props,
  }}
  {...rest}
/>
