<script lang="ts">
  import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import type { ComponentProps } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { PhaseDiagramData } from './types'

  let {
    export_pane_open = $bindable(false),
    data,
    wrapper,
    filename = `phase-diagram`,
    png_dpi = $bindable(150),
    icon_style = ``,
    toggle_props: caller_toggle_props = {},
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    export_pane_open?: boolean
    data?: PhaseDiagramData
    wrapper?: HTMLDivElement
    filename?: string
    png_dpi?: number
    icon_style?: string
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
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
  {icon_style}
  toggle_props={{
    class: `pd-export-toggle`,
    title: export_pane_open ? `` : `Export phase diagram`,
    ...caller_toggle_props,
  }}
>
  <div class="export-grid">
    <h4
      {@attach tooltip({
        content: `Download or copy the phase diagram`,
      })}
    >
      Image
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
      <span class="dpi-input"
      >(DPI: <input
          type="number"
          min={50}
          max={600}
          bind:value={png_dpi}
          title="Export resolution in dots per inch"
        />)</span>
    </label>

    <h4
      {@attach tooltip({
        content: `Export phase diagram data as JSON`,
      })}
    >
      Data
    </h4>
    <label>
      JSON
      <button
        type="button"
        onclick={download_json}
        disabled={!data}
        title="Download JSON"
      >
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
  </div>
</DraggablePane>

<style>
  .export-grid {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4pt 10pt;
  }
  .export-grid h4 {
    width: 100%;
    margin: 4pt 0 0;
  }
  .export-grid h4:first-child {
    margin-top: 0;
  }
  label {
    display: flex;
    align-items: center;
    gap: 8pt;
    font-size: 0.95em;
    white-space: nowrap;
  }
  .dpi-input {
    display: inline-flex;
    align-items: center;
    gap: 2pt;
    white-space: nowrap;
  }
  button {
    width: 1.9em;
    height: 1.6em;
    padding: 0 6pt;
    box-sizing: border-box;
  }
  input {
    width: 3.5em;
  }
</style>
