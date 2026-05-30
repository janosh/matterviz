<script lang="ts">
  import { BinnedScatterPlot, type DensePointSeries } from '$lib/plot'
  import { onMount } from 'svelte'

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
  const max_points = $derived(mode === `points` ? Number.MAX_SAFE_INTEGER : 0)
  const bin_px = $derived(mode === `singleton` ? 50 : 2.8)
  const density = $derived({
    bin_px,
    color_scale: { type: `log`, scheme: `interpolateViridis` } as const,
    auto_point_mode: {
      max_points,
      max_points_per_px: mode === `points` ? Number.MAX_SAFE_INTEGER : 0,
    },
  })
  const x_axis = $derived(
    mode === `singleton` ? { range: [0, 1] as [number, number], label: `x` } : { label: `x` },
  )
  const y_axis = $derived(
    mode === `singleton` ? { range: [0, 1] as [number, number], label: `y` } : { label: `y` },
  )

  const next_frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  function make_series(test_mode: TestMode, count: number): DensePointSeries[] {
    if (test_mode === `singleton`) {
      return [
        {
          x: Float32Array.from([0.9, 0.1, 0.2]),
          y: Float32Array.from([0.9, 0.1, 0.8]),
          point_ids: [`singleton`, `low`, `left-high`],
        },
      ]
    }

    const x = new Float32Array(count)
    const y = new Float32Array(count)
    for (let idx = 0; idx < count; idx++) {
      x[idx] = (idx % 10_000) / 10_000
      y[idx] = ((idx * PSEUDO_RANDOM_MULTIPLIER) % 1_000_000) / 1_000_000
    }
    return [{ x, y }]
  }

  async function wait_for_plot_ready(expected_count: number, test_mode: TestMode): Promise<void> {
    const expected_label = `Density (${expected_count.toLocaleString()} points)`
    const start = performance.now()
    while (performance.now() - start < 10_000) {
      await next_frame()
      const plot = document.querySelector<HTMLElement>(`.binned-scatter`)
      const label = document.querySelector<HTMLElement>(`.colorbar .label`)
      const plot_ready = test_mode === `points`
        ? plot?.dataset.renderMode === `points`
        : label?.textContent === expected_label
      if (plot_ready) return
    }
    timed_out = true
  }

  onMount(async () => {
    const params = new URLSearchParams(location.search)
    mode = (params.get(`mode`) ?? `density`) as TestMode
    n_points = mode === `singleton`
      ? 3
      : Number(params.get(`points`) ?? (mode === `points` ? 20_000 : 1_000_000))
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
    {mode} {n_points.toLocaleString()} mount {mount_ms.toFixed(1)}ms
  </output>

  <section data-testid="binned-scatter-host">
    {#if series.length}
      <BinnedScatterPlot
        {series}
        {x_axis}
        {y_axis}
        {density}
        style="height: 600px; width: 900px;"
        on_density_zoom={() => zoom_count += 1}
        on_point_click={() => point_click_count += 1}
      />
    {/if}
  </section>
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
  section {
    height: 600px;
    width: 900px;
  }
</style>
