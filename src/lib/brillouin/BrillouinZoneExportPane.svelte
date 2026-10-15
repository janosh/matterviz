<script lang="ts">
  import { DEFAULT_PNG_DPI } from '#lib/constants.js'
  import ExportPane from '#lib/io/ExportPane.svelte'
  import { canvas_sources, json_source, type ExportProps } from '#lib/io/export.js'
  import type { BrillouinZoneData } from './types'

  let {
    export_pane_open = $bindable(false),
    bz_data,
    wrapper,
    filename = `brillouin-zone`,
    png_dpi = $bindable(DEFAULT_PNG_DPI),
    export_formats,
    on_export,
  }: Omit<ExportProps, `export_filename`> & {
    export_pane_open?: boolean
    bz_data?: BrillouinZoneData
    wrapper?: HTMLDivElement
    filename?: string
    png_dpi?: number
  } = $props()

  // PNG re-renders the registered scene at the export DPI; JSON holds vertices, faces, edges
  // and reciprocal lattice vectors
  const sources = $derived({
    ...canvas_sources(() => wrapper?.querySelector(`canvas`)),
    ...(bz_data && {
      json: json_source(() => {
        const { order, volume, vertices, faces, edges, k_lattice } = bz_data
        return { order, volume, vertices, faces, edges, reciprocal_lattice: k_lattice }
      }),
    }),
  })
</script>

<ExportPane
  filename="{filename}-bz-order-{bz_data?.order ?? 1}"
  bind:export_pane_open
  bind:png_dpi
  {sources}
  {export_formats}
  {on_export}
  toggle_props={{
    class: `bz-export-toggle`,
    title: export_pane_open ? `` : `Export Brillouin zone`,
  }}
/>
