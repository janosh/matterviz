<script lang="ts">
  import { DraggablePane } from '$lib'
  import { export_canvas_as_png } from '$lib/io/export'
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

  let copy_status = $state(false)
  const copy_confirm = `✅`

  async function export_as_png() {
    const canvas = wrapper?.querySelector(`canvas`)
    if (!canvas || !scene || !camera) {
      console.error(`Cannot export PNG: missing canvas, scene, or camera`)
      return
    }
    try {
      export_canvas_as_png(canvas, undefined, png_dpi, scene, camera)
    } catch (error) {
      console.error(`Failed to export PNG:`, error)
    }
  }

  function export_as_json() {
    if (!bz_data) {
      console.error(`Cannot export JSON: no BZ data available`)
      return
    }
    const json_data = {
      order: bz_data.order,
      volume: bz_data.volume,
      vertices: bz_data.vertices,
      faces: bz_data.faces,
      edges: bz_data.edges,
      reciprocal_lattice: bz_data.k_lattice,
    }
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

  async function copy_k_vectors() {
    if (!bz_data?.k_lattice) return
    const text = bz_data.k_lattice
      .map((vec, idx) => `b${idx + 1}: [${vec.map((x) => x.toFixed(6)).join(`, `)}]`)
      .join(`\n`)
    try {
      await navigator.clipboard.writeText(text)
      copy_status = true
      setTimeout(() => {
        copy_status = false
      }, 1000)
    } catch (error) {
      console.error(`Failed to copy to clipboard:`, error)
    }
  }
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
  </label>

  <h4>Quick copy</h4>
  <label>
    k-vectors
    <button
      type="button"
      onclick={copy_k_vectors}
      disabled={!bz_data}
      title="Copy k-vectors to clipboard"
    >
      {copy_status ? copy_confirm : `📋`}
    </button>
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
    padding: 0;
    margin: 0 0 0 4pt;
    box-sizing: border-box;
  }
  input {
    margin: 0 0 0 2pt;
  }
</style>
