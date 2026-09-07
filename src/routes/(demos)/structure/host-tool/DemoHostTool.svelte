<script lang="ts">
  import { Trajectory } from '$lib/trajectory'
  import type {
    StructureToolOverlay,
    StructureToolProps,
    StructureToolRun,
    StructureToolViewProps,
  } from '$lib/structure'
  import { onDestroy } from 'svelte'
  import { make_demo_trajectory } from './demo'

  let { structure, start_run }: StructureToolProps = $props()
  let run = $state.raw<StructureToolRun>()
  let status = $state(`Ready`)
  let current_step_idx = $state(0)
  const trajectory = $derived(make_demo_trajectory(structure))

  let delay_ms = $state(100)
  let fail = $state(false)
  let running = $state(false)
  function predict(): void {
    const current = start_run({
      model: `Deterministic host example`,
      version: `1`,
      units: { charge: `e`, dipole: `e A`, density: `e/A^3` },
      settings: { grid_size: 12, seed: 0 },
    })
    run = current
    running = true
    status = `Prediction ${current.id} running`
    let worker: Worker
    try {
      worker = new Worker(new URL(`prediction-worker.ts`, import.meta.url), {
        type: `module`,
      })
    } catch (error) {
      status = String(error)
      running = false
      return
    }
    const stop = () => {
      worker.terminate()
      current.signal.removeEventListener(`abort`, stop)
      if (run === current) {
        running = false
        if (current.signal.aborted) status = `Prediction ${current.id} cancelled`
      }
    }
    const finish = (error?: string) => {
      if (run === current && !current.signal.aborted)
        status = error ?? `Prediction ${current.id} ready: charges, dipoles and density`
      stop()
    }
    worker.addEventListener(
      `message`,
      ({ data }: MessageEvent<{ result?: StructureToolOverlay; error?: string }>) => {
        try {
          if (data.result) current.on_overlay(data.result)
          finish(data.error)
        } catch (error) {
          finish(String(error))
        }
      },
    )
    worker.addEventListener(`error`, (event) => {
      event.preventDefault()
      finish(event.message)
    })
    current.signal.addEventListener(`abort`, stop, { once: true })
    if (current.signal.aborted) stop()
    else {
      try {
        // Worker messages have no Window targetOrigin.
        // oxlint-disable-next-line eslint-plugin-unicorn/require-post-message-target-origin
        worker.postMessage({ structure: current.structure, delay_ms, fail })
      } catch (error) {
        finish(String(error))
      }
    }
  }
  function show_trajectory(): void {
    if (!run || run.signal.aborted) predict()
    current_step_idx = 0
    run?.on_view({ content: trajectory_view })
  }
  onDestroy(() => run?.cancel())
</script>

<div class="demo-tool" data-testid="host-tool-controls">
  <button onclick={predict}>Run prediction</button>
  <button onclick={() => run?.cancel()} disabled={!running}>Cancel prediction</button>
  <label>Delay (ms) <input type="number" min="0" max="10000" bind:value={delay_ms} /></label>
  <label><input type="checkbox" bind:checked={fail} /> Fail prediction</label>
  <button onclick={show_trajectory}>Show predicted trajectory</button>
  <span role="status">{status}</span>
</div>

{#snippet trajectory_view(view: StructureToolViewProps)}
  <div class="trajectory-view" data-testid="predicted-trajectory">
    <div style="display: flex; align-items: center; gap: 1rem">
      <button onclick={() => run?.on_view(null)}>Return to structure</button>
      <output aria-label="Trajectory frame">Frame {current_step_idx + 1}</output>
    </div>
    <Trajectory
      {trajectory}
      bind:current_step_idx
      auto_play={false}
      display_mode="structure"
      show_controls="always"
      structure_props={{ ...view, show_host_tool: false, show_controls: `always` }}
      style="height: 100%; min-height: 0"
    />
  </div>
{/snippet}

<style>
  .demo-tool {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    z-index: 2;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    max-width: 75%;
    background: var(--pane-bg, white);
    padding: 0.5rem;
  }
  .demo-tool input[type='number'] {
    width: 5rem;
  }
  .trajectory-view {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
  }
</style>
