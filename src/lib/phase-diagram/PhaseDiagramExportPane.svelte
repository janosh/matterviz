<script lang="ts">
  import { DEFAULT_PNG_DPI } from '#lib/constants.js'
  import type { PaneToggleProps } from '#lib/overlays/index.js'
  import ExportPane from '#lib/io/ExportPane.svelte'
  import { json_source, svg_sources, type ExportProps } from '#lib/io/export.js'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { PhaseDiagramData } from './types'

  let {
    export_pane_open = $bindable(false),
    data,
    wrapper,
    filename: source_filename = `phase-diagram`,
    png_dpi = $bindable(DEFAULT_PNG_DPI),
    icon_style = ``,
    toggle_props: caller_toggle_props = {},
    export_formats,
    on_export,
    ...rest
  }: HTMLAttributes<HTMLDivElement> &
    Omit<ExportProps, `export_filename`> & {
      export_pane_open?: boolean
      data?: PhaseDiagramData
      wrapper?: HTMLDivElement
      filename?: string
      png_dpi?: number
      icon_style?: string
      toggle_props?: PaneToggleProps
    } = $props()

  // Generate filename with components if available (requires exactly 2 components)
  const full_filename = $derived(
    data?.components?.length === 2
      ? `${source_filename}-${data.components[0]}-${data.components[1]}`
      : source_filename,
  )

  // Looked up per action: the SVG mounts after this pane (a sibling further down the diagram
  // template) and re-mounts when the diagram is cleared and reloaded, so a cached element
  // would be stale or missing
  const get_svg = (): SVGSVGElement | null =>
    wrapper?.querySelector<SVGSVGElement>(`svg.binary-phase-diagram`) ?? null

  const sources = $derived({
    ...svg_sources(get_svg),
    ...(data && { json: json_source(() => data) }),
  })
</script>

<ExportPane
  filename={full_filename}
  bind:export_pane_open
  bind:png_dpi
  {sources}
  {export_formats}
  {on_export}
  {icon_style}
  toggle_props={{
    class: `pd-export-toggle`,
    title: export_pane_open ? `` : `Export phase diagram`,
    ...caller_toggle_props,
  }}
  {...rest}
/>
