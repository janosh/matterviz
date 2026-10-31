<script lang="ts">
  import { BrillouinZone, type Crystal } from '#lib'
  import type { IrreducibleBZData } from '#lib/brillouin/types.js'
  import mp1_struct from '#site/structures/mp-1.json' with { type: 'json' }
  import { type Camera, OrthographicCamera } from 'three/webgpu'
  import TestControls from '../TestControls.svelte'
  import TestSection from '../TestSection.svelte'
  import TestStatus from '../TestStatus.svelte'

  let controls_open = $state(false)
  let camera_projection = $state<`perspective` | `orthographic`>(`perspective`)
  // non-default so the controls pane test has an edge reset to click
  let edge_width = $state(0.05)
  let show_ibz = $state(false)
  let ibz_data = $state<IrreducibleBZData | null>(null)

  let structure = $state<Crystal | undefined>(mp1_struct as unknown as Crystal)
  let source = $state<string | undefined>(undefined)
  let event_calls = $state<{ event: string; data: unknown }[]>([])
  let camera = $state<Camera>()
  $effect(() => {
    Reflect.set(globalThis, `read_bz_zoom`, () =>
      camera instanceof OrthographicCamera ? camera.zoom : Number.NaN,
    )
    // else the hook outlives a client-side navigation and reports a stale camera
    return () => Reflect.deleteProperty(globalThis, `read_bz_zoom`)
  })

  const log_event = (event_name: string) => (data: unknown) => {
    event_calls = [...event_calls, { event: event_name, data }]
  }

  $effect(() => {
    const params = new URLSearchParams(window.location.search)
    const source_param = params.get(`source`)
    if (source_param) {
      source = source_param
      structure = undefined
    }
    if (params.has(`show_ibz`)) show_ibz = params.get(`show_ibz`) === `true`
  })
  // separate from the URL effect above, which re-applied the URL params (resetting e.g. a
  // show_ibz toggled since) after every logged event when it read event_calls
  $effect(() => {
    ;(globalThis as Record<string, unknown>).event_calls = event_calls
  })
</script>

<h1>BrillouinZone test page</h1>

<TestSection title="Controls">
  <TestControls>
    <label
      >Controls open <input
        id="controls-open"
        type="checkbox"
        bind:checked={controls_open}
      /></label
    >
    <label
      >Camera projection
      <select id="camera-projection" bind:value={camera_projection}>
        <option value="perspective">perspective</option>
        <option value="orthographic">orthographic</option>
      </select>
    </label>
    <label
      >Show IBZ
      <input
        id="show-ibz"
        data-testid="show-ibz-checkbox"
        type="checkbox"
        bind:checked={show_ibz}
      />
    </label>
  </TestControls>
</TestSection>

<TestStatus
  values={{
    'controls-open': controls_open,
    'camera-projection': camera_projection,
    'show-ibz': show_ibz,
    'ibz-data-status': ibz_data ? `loaded` : `null`,
    'ibz-vertices-count': ibz_data?.vertices?.length ?? 0,
    events: event_calls.map((event_call) => event_call.event).join(`, `),
  }}
/>

<TestSection title="Viewer">
  <BrillouinZone
    id="test-brillouin-zone"
    {structure}
    {source}
    bind:controls_open
    bind:camera_projection
    bind:edge_width
    bind:show_ibz
    bind:ibz_data
    bind:camera
    on_file_load={log_event(`on_file_load`)}
    on_error={log_event(`on_error`)}
    style="--bz-height: 500px; --bz-width: 800px"
  />
</TestSection>
