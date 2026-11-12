<script lang="ts">
  // Export pane shared by the phase diagram viewers: the figure through the `image_sources`
  // its viewer renders with (SVG or canvas), the diagram itself as JSON
  import { DEFAULT_PNG_DPI } from '#lib/constants.js'
  import type { PaneToggleProps } from '#lib/overlays/index.js'
  import ExportPane from '#lib/io/ExportPane.svelte'
  import { json_source, type ExportProps, type ExportSources } from '#lib/io/export.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    export_pane_open = $bindable(false),
    data,
    components,
    image_sources = {},
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
      // The diagram, offered as JSON when set
      data?: unknown
      // Appended to the filename, e.g. phase-diagram-Al-Cu
      components?: readonly string[]
      // The live figure's serializers, see svg_sources and canvas_sources
      image_sources?: ExportSources
      filename?: string
      png_dpi?: number
      icon_style?: string
      toggle_props?: PaneToggleProps
    } = $props()

  const full_filename = $derived([source_filename, ...(components ?? [])].join(`-`))
  const sources = $derived({
    ...image_sources,
    ...(data !== undefined && data !== null && { json: json_source(() => data) }),
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
