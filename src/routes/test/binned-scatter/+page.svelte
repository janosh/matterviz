<script lang="ts">
  import type { Vec2 } from '$lib/math'
  import { BinnedScatterPlot, type DensePointSeries } from '$lib/plot'
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'

  type TestMode = `density` | `points` | `singleton`

  let mode = $state<TestMode>(`density`)
  let n_points = $state(0)
  let series = $state<DensePointSeries[]>([])
  let zoom_count = $state(0)
  let point_click_count = $state(0)
  let ready = $state(false)
  let timed_out = $state(false)
  let mount_ms = $state(0)

  // Shared deterministic point cloud; spreads y values without RNG overhead.
  const PSEUDO_RANDOM_MULTIPLIER = 48_271
  // points mode lifts binning limits so every point renders individually
  const unbounded = $derived(mode === `points` ? Number.MAX_SAFE_INTEGER : 0)
  const density = $derived({
    bin_px: mode === `singleton` ? 50 : 2.8,
    color_scale: { type: `log`, scheme: `interpolateViridis` } as const,
    auto_point_mode: { max_points: unbounded, max_points_per_px: unbounded },
  })
  const make_axis = (label: string) =>
    mode === `singleton` ? { range: [0, 1] as Vec2, label } : { label }
  const x_axis = $derived(make_axis(`x`))
  const y_axis = $derived(make_axis(`y`))

  const next_frame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  function make_series(test_mode: TestMode, count: number): DensePointSeries[] {
    if (test_mode === `singleton`) {
      const x = Float32Array.from([0.9, 0.1, 0.2])
      const y = Float32Array.from([0.9, 0.1, 0.8])
      return [{ x, y, point_ids: [`singleton`, `low`, `left-high`] }]
    }

    const x = new Float32Array(count)
    const y = new Float32Array(count)
    for (let idx = 0; idx < count; idx++) {
      x[idx] = (idx % 10_000) / 10_000
      y[idx] = ((idx * PSEUDO_RANDOM_MULTIPLIER) % 1_000_000) / 1_000_000
    }
    return [{ x, y }]
  }

  async function wait_for_plot_ready(
    expected_count: number,
    test_mode: TestMode,
  ): Promise<void> {
    const expected_label = `Density (${expected_count.toLocaleString()} points)`
    const start = performance.now()
    while (performance.now() - start < 10_000) {
      await next_frame()
      const plot = document.querySelector<HTMLElement>(`.binned-scatter`)
      const label = document.querySelector<HTMLElement>(`.colorbar .label`)
      const plot_ready =
        test_mode === `points`
          ? plot?.dataset.renderMode === `points`
          : label?.textContent === expected_label
      if (plot_ready) return
    }
    timed_out = true
  }

  const valid_modes = new SvelteSet<TestMode>([`density`, `points`, `singleton`])
  const MAX_POINTS = 1_000_000

  onMount(async () => {
    const params = new URLSearchParams(location.search)
    const mode_param = params.get(`mode`) as TestMode
    mode = valid_modes.has(mode_param) ? mode_param : `density`

    if (mode === `singleton`) {
      n_points = 3
    } else {
      const default_points = mode === `points` ? 20_000 : MAX_POINTS
      const parsed = Math.floor(Number(params.get(`points`) ?? default_points))
      // Clamp to avoid NaN/negative (RangeError) or oversized typed-array allocations
      n_points = Number.isFinite(parsed)
        ? Math.min(Math.max(parsed, 0), MAX_POINTS)
        : default_points
    }
    const next_series = make_series(mode, n_points)

    const mount_start = performance.now()
    series = next_series
    await wait_for_plot_ready(n_points, mode)
    mount_ms = performance.now() - mount_start
    ready = !timed_out
  })
</script>

<svelte:head>
  <title>Binned Scatter Test</title>
</svelte:head>

<main>
  <output
    data-testid="binned-scatter-status"
    data-ready={ready}
    data-timed-out={timed_out}
    data-mode={mode}
    data-points={n_points}
    data-mount-ms={mount_ms.toFixed(1)}
    data-zoom-count={zoom_count}
    data-point-click-count={point_click_count}
  >
    {mode}
    {n_points.toLocaleString()} mount {mount_ms.toFixed(1)}ms
  </output>

  {#if series.length}
    <BinnedScatterPlot
      {series}
      {x_axis}
      {y_axis}
      {density}
      data-testid="binned-scatter-host"
      style="height: 600px; width: 900px;"
      on_density_zoom={() => (zoom_count += 1)}
      on_point_click={() => (point_click_count += 1)}
    />
  {/if}
</main>

<style>
  main {
    display: grid;
    gap: 1rem;
    padding: 1rem;
  }
  output {
    font: 12px/1.4 monospace;
  }
</style>
