<script lang="ts">
  import { DraggablePane } from '$lib'
  import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { PhaseDiagramData } from './types'

  let {
    export_pane_open = $bindable(false),
    data,
    wrapper,
    filename = `phase-diagram`,
    png_dpi = $bindable(150),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    export_pane_open?: boolean
    data?: PhaseDiagramData
    wrapper?: HTMLDivElement
    filename?: string
    png_dpi?: number
  } = $props()

  // Copy button feedback state
  let copy_status = $state<{ json: boolean; svg: boolean }>({
    json: false,
    svg: false,
  })
  const copy_confirm = `✅`

  // Generate filename with components if available (requires exactly 2 components)
  const full_filename = $derived(
    data?.components?.length === 2
      ? `${filename}-${data.components[0]}-${data.components[1]}`
      : filename,
  )

  const svg = $derived(
    wrapper?.querySelector(`svg.binary-phase-diagram`) as SVGSVGElement | null,
  )

  async function copy_svg() {
    if (!svg) return
    const svg_string = new XMLSerializer().serializeToString(svg)
    await navigator.clipboard.writeText(svg_string)
    copy_status.svg = true
    setTimeout(() => (copy_status.svg = false), 1500)
  }

  function download_json() {
    if (!data) return

    const json_string = JSON.stringify(data, null, 2)
    const blob = new Blob([json_string], { type: `application/json` })
    const url = URL.createObjectURL(blob)

    const link = document.createElement(`a`)
    link.href = url
    link.download = `${full_filename}.json`
    link.click()

    URL.revokeObjectURL(url)
  }

  async function copy_json() {
    if (!data) return

    const json_string = JSON.stringify(data, null, 2)
    await navigator.clipboard.writeText(json_string)

    copy_status.json = true
    setTimeout(() => (copy_status.json = false), 1500)
  }
</script>

<DraggablePane
  bind:show={export_pane_open}
  open_icon="Cross"
  closed_icon="Export"
  pane_props={{ ...rest, class: `export-pane ${rest.class ?? ``}` }}
  toggle_props={{
    class: `pd-export-toggle`,
    title: export_pane_open ? `` : `Export phase diagram`,
  }}
>
  <h4
    {@attach tooltip({
      content: `Download or copy the phase diagram`,
    })}
  >
    Export as image
  </h4>
  <label>
    SVG
    <button
      type="button"
      onclick={() => svg && export_svg_as_svg(svg, `${full_filename}.svg`)}
      disabled={!svg}
      title="Download SVG"
    >
      ⬇
    </button>
    <button
      type="button"
      onclick={copy_svg}
      disabled={!svg}
      title="Copy SVG to clipboard"
    >
      {copy_status.svg ? copy_confirm : `📋`}
    </button>
  </label>
  <label>
    PNG
    <button
      type="button"
      onclick={() => svg && export_svg_as_png(svg, `${full_filename}.png`, png_dpi)}
      disabled={!svg}
      title={`Download PNG (${png_dpi} DPI)`}
    >
      ⬇
    </button>
    &nbsp;(DPI: <input
      type="number"
      min={50}
      max={600}
      bind:value={png_dpi}
      title="Export resolution in dots per inch"
    />)
  </label>

  <h4
    {@attach tooltip({
      content: `Export phase diagram data as JSON`,
    })}
  >
    Export as data
  </h4>
  <label>
    JSON
    <button type="button" onclick={download_json} disabled={!data} title="Download JSON">
      ⬇
    </button>
    <button
      type="button"
      onclick={copy_json}
      disabled={!data}
      title="Copy JSON to clipboard"
    >
      {copy_status.json ? copy_confirm : `📋`}
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
    padding: 0 6pt;
    margin: 0 0 0 4pt;
    box-sizing: border-box;
  }
  input {
    margin: 0 0 0 2pt;
  }
</style>
