<script lang="ts">
  import { export_canvas_as_png } from '$lib/io/export'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import type { ComponentProps } from 'svelte'
  import { CopyButton } from 'svelte-multiselect'
  import { tooltip } from 'svelte-multiselect/attachments'
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

  let json_copy_state = $state<ComponentProps<typeof CopyButton>[`state`]>(`ready`)

  function export_as_png() {
    const canvas = wrapper?.querySelector(`canvas`)
    if (!canvas || !scene || !camera) return

    const dpi = Math.max(50, Math.min(600, Math.trunc(png_dpi)))
    const png_name = `${filename}-${bz_data?.order ?? `1`}.png`
    export_canvas_as_png(canvas, png_name, dpi, scene, camera)
  }

  function export_as_json() {
    const json_data = get_json_data()
    if (!json_data || !bz_data) return

    const blob = new Blob([JSON.stringify(json_data, null, 2)], {
      type: `application/json`,
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement(`a`)
    link.href = url
    link.download = `${filename}-bz-order-${bz_data.order}.json`
    link.click()
    URL.revokeObjectURL(url)
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

  let json_string = $derived.by(() => {
    const json_data = get_json_data()
    return json_data ? JSON.stringify(json_data, null, 2) : null
  })
</script>

<DraggablePane
  bind:show={export_pane_open}
  open_icon="Cross"
  closed_icon="Export"
  pane_props={{ ...rest, class: `export-pane ${rest.class ?? ``}` }}
  toggle_props={{
    class: `bz-export-toggle`,
    title: export_pane_open ? `` : `Export Brillouin zone`,
  }}
>
  <h4>Export as image</h4>
  <label>
    PNG
    <button
      type="button"
      onclick={export_as_png}
      disabled={!scene || !camera}
      title="PNG ({png_dpi} DPI)"
    >
      ⬇
    </button>
    &nbsp;(DPI: <input
      type="number"
      min={72}
      max={600}
      bind:value={png_dpi}
      title="Export resolution in dots per inch"
    />)
  </label>

  <h4
    {@attach tooltip({
      content: `Includes vertices, faces, edges, and reciprocal lattice vectors`,
    })}
  >
    Export as data
  </h4>
  <label>
    JSON
    <button
      type="button"
      onclick={export_as_json}
      disabled={!bz_data}
      title="Download JSON"
    >
      ⬇
    </button>
    <CopyButton
      content={json_string ?? undefined}
      bind:state={json_copy_state}
      title="Copy JSON to clipboard"
    />
  </label>
</DraggablePane>

<style>
  label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4pt;
    font-size: 0.95em;
  }
  button {
    width: 1.9em;
    height: 1.6em;
    padding: 0 6pt;
    margin: 0 0 0 4pt;
    box-sizing: border-box;
  }
  input {
    margin: 0 0 0 2pt;
  }
</style>
