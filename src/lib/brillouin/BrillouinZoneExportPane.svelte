<script lang="ts">
  import type { ExportSection } from '$lib/io'
  import ExportPane from '$lib/io/ExportPane.svelte'
  import { export_canvas_as_png } from '$lib/io/export'
  import { download } from '$lib/io/fetch'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Camera, Scene } from 'three'
  import type { BrillouinZoneData } from './types'

  let {
    export_pane_open = $bindable(false),
    bz_data,
    wrapper,
    scene,
    camera,
    filename = `brillouin-zone`,
    png_dpi = $bindable(150),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    export_pane_open?: boolean
    bz_data?: BrillouinZoneData
    wrapper?: HTMLDivElement
    scene?: Scene
    camera?: Camera
    filename?: string
    png_dpi?: number
  } = $props()

  function export_as_png() {
    const canvas = wrapper?.querySelector(`canvas`)
    if (!canvas || !scene || !camera) return
    const png_name = `${filename}-${bz_data?.order ?? `1`}.png`
    export_canvas_as_png(canvas, png_name, png_dpi, scene, camera)
  }

  function get_json_data() {
    if (!bz_data) return null
    return {
      order: bz_data.order,
      volume: bz_data.volume,
      vertices: bz_data.vertices,
      faces: bz_data.faces,
      edges: bz_data.edges,
      reciprocal_lattice: bz_data.k_lattice,
    }
  }

  function export_as_json() {
    const json_data = get_json_data()
    if (!json_data || !bz_data) return
    download(
      JSON.stringify(json_data, null, 2),
      `${filename}-bz-order-${bz_data.order}.json`,
      `application/json`,
    )
  }

  const sections = $derived<ExportSection[]>([
    {
      title: `Export as image`,
      items: [
        {
          label: `PNG`,
          disabled: !scene || !camera,
          show_dpi: true,
          on_download: export_as_png,
        },
      ],
    },
    {
      title: `Export as data`,
      tooltip: `Includes vertices, faces, edges, and reciprocal lattice vectors`,
      items: [
        {
          label: `JSON`,
          disabled: !bz_data,
          on_download: export_as_json,
          copy_text: () => {
            const json_data = get_json_data()
            return json_data ? JSON.stringify(json_data, null, 2) : null
          },
        },
      ],
    },
  ])
</script>

<ExportPane
  bind:export_pane_open
  bind:png_dpi
  {sections}
  toggle_props={{
    class: `bz-export-toggle`,
    title: export_pane_open ? `` : `Export Brillouin zone`,
  }}
  {...rest}
/>
