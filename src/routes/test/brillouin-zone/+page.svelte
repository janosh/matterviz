<script lang="ts">
  import { BrillouinZone, type Crystal } from '$lib'
  import type { IrreducibleBZData } from '$lib/brillouin/types'
  import mp1_struct from '$site/structures/mp-1.json' with { type: 'json' }

  let controls_open = $state(false)
  let info_pane_open = $state(false)
  let bz_order = $state(1)
  let surface_color = $state(`#4488ff`)
  let surface_opacity = $state(0.3)
  let edge_color = $state(`#000000`)
  let edge_width = $state(0.05)
  let show_vectors = $state(true)
  let vector_scale = $state(1.0)
  let camera_projection = $state<`perspective` | `orthographic`>(`perspective`)
  let show_controls = $state<`always` | `hover` | `never`>(`hover`)
  let png_dpi = $state(150)
  let fullscreen = $state(false)
  // IBZ state
  let show_ibz = $state(false)
  let ibz_color = $state(`#ff8844`)
  let ibz_opacity = $state(0.5)
  let ibz_data = $state<IrreducibleBZData | null>(null)

  let structure = $state<Crystal | undefined>(
    mp1_struct as unknown as Crystal,
  )
  let data_url = $state<string | undefined>(undefined)
  let event_calls = $state<{ event: string; data: unknown }[]>([])

  const log_event = (event_name: string) => (data: unknown) => {
    event_calls = [...event_calls, { event: event_name, data }]
  }

  $effect(() => {
    if (typeof window === `undefined`) return
    const params = new URLSearchParams(window.location.search)

    if (params.has(`data_url`)) {
      const url_data = params.get(`data_url`)
      if (url_data) {
        data_url = url_data
        structure = undefined
      }
    }

    if (params.has(`bz_order`)) {
      const order = parseInt(params.get(`bz_order`) || `1`)
      if (!isNaN(order)) bz_order = order
    }

    if (params.has(`camera_projection`)) {
      const cam = params.get(`camera_projection`)
      if (cam === `perspective` || cam === `orthographic`) camera_projection = cam
    }

    if (params.has(`show_controls`)) {
      const param = params.get(`show_controls`) as `always` | `hover` | `never` | null
      if (param && [`always`, `hover`, `never`].includes(param)) show_controls = param
    }

    if (params.has(`show_ibz`)) {
      show_ibz = params.get(`show_ibz`) === `true`
    }

    ;(globalThis as Record<string, unknown>).event_calls = event_calls
  })
</script>

<h1>BrillouinZone Component Test Page</h1>

<section>
  <h2>Controls</h2>
  <label>Controls Open: <input
      id="controls-open"
      type="checkbox"
      bind:checked={controls_open}
    /></label><br />
  <label>Info Pane Open: <input
      id="info-pane-open"
      type="checkbox"
      bind:checked={info_pane_open}
    /></label><br />
  <label>BZ Order: <input
      id="bz-order"
      type="number"
      bind:value={bz_order}
      min="1"
      max="5"
    /></label><br />
  <label>Show Controls: <select
      id="show-controls"
      bind:value={show_controls}
    >
      <option value="always">always</option>
      <option value="hover">hover</option>
      <option value="never">never</option>
    </select></label><br />
  <label>Camera Projection: <select id="camera-projection" bind:value={camera_projection}>
      <option value="perspective">perspective</option>
      <option value="orthographic">orthographic</option>
    </select></label><br />
  <label>Fullscreen: <input
      data-testid="fullscreen-checkbox"
      type="checkbox"
      bind:checked={fullscreen}
    /></label><br />
  <label>Show IBZ: <input
      id="show-ibz"
      data-testid="show-ibz-checkbox"
      type="checkbox"
      bind:checked={show_ibz}
    /></label><br />
  <label>IBZ Color: <input
      id="ibz-color"
      type="color"
      bind:value={ibz_color}
    /></label><br />
  <label>IBZ Opacity: <input
      id="ibz-opacity"
      type="range"
      min="0"
      max="1"
      step="0.1"
      bind:value={ibz_opacity}
    /></label>
</section>

<section>
  <h2>Status</h2>
  <p data-testid="controls-open">{controls_open}</p>
  <p data-testid="info-pane-open">{info_pane_open}</p>
  <p data-testid="bz-order">{bz_order}</p>
  <p data-testid="show-controls">{show_controls}</p>
  <p data-testid="camera-projection">{camera_projection}</p>
  <p data-testid="fullscreen-status">{fullscreen}</p>
  <p data-testid="show-ibz">{show_ibz}</p>
  <p data-testid="ibz-color">{ibz_color}</p>
  <p data-testid="ibz-opacity">{ibz_opacity}</p>
  <p data-testid="ibz-data-status">{ibz_data ? `loaded` : `null`}</p>
  <p data-testid="ibz-vertices-count">{ibz_data?.vertices?.length ?? 0}</p>
  <p data-testid="events">{event_calls.map((ec) => ec.event).join(`, `)}</p>
</section>

<BrillouinZone
  id="test-brillouin-zone"
  {structure}
  {data_url}
  bind:bz_order
  bind:controls_open
  bind:info_pane_open
  bind:surface_color
  bind:surface_opacity
  bind:edge_color
  bind:edge_width
  bind:show_vectors
  bind:vector_scale
  bind:camera_projection
  bind:png_dpi
  bind:fullscreen
  bind:show_ibz
  bind:ibz_color
  bind:ibz_opacity
  bind:ibz_data
  {show_controls}
  on_file_load={log_event(`on_file_load`)}
  on_error={log_event(`on_error`)}
  on_fullscreen_change={log_event(`on_fullscreen_change`)}
  style="--bz-height: 500px; --bz-width: 800px; margin-top: 2em"
/>

<style>
  section {
    margin-bottom: 2em;
    padding: 1em;
    border: 1px solid var(--sms-border);
    border-radius: var(--border-radius);
  }
</style>
