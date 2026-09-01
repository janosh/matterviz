<script lang="ts">
  // Playwright perf harness: a seeded synthetic 3-level hierarchy built in-page from URL
  // params (?top=12&mid=12&leaf=10 gives 12*12*10 leaves + branches), so the spec needs no
  // fixture. Mount time is published in the DOM; hover/zoom frame timings are measured by
  // the spec itself via requestAnimationFrame.
  import { Sunburst, type SunburstNode } from '$lib'
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import { onMount } from 'svelte'

  // url.searchParams is off-limits during prerender (it would 500 the static build) and the
  // run is only meaningful in a browser anyway, so the defaults stand until the client runs
  const param = (name: string, fallback: number) =>
    browser ? Number(page.url.searchParams.get(name) ?? fallback) : fallback
  const n_top = param(`top`, 12)
  const n_mid = param(`mid`, 12)
  const n_leaf = param(`leaf`, 10)
  const labels = param(`labels`, 1) !== 0

  // mulberry32 so every run sees identical values
  const make_rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }

  const build_tree = (): SunburstNode[] => {
    const rng = make_rng(11)
    return Array.from({ length: n_top }, (_top, top_idx) => ({
      id: `T${top_idx}`,
      label: `Group ${top_idx}`,
      children: Array.from({ length: n_mid }, (_mid, mid_idx) => ({
        id: `T${top_idx}/M${mid_idx}`,
        label: `Sub ${top_idx}.${mid_idx}`,
        children: Array.from({ length: n_leaf }, (_leaf, leaf_idx) => ({
          id: `T${top_idx}/M${mid_idx}/L${leaf_idx}`,
          label: `Leaf ${leaf_idx}`,
          value: 1 + Math.floor(rng() * 20),
        })),
      })),
    }))
  }

  const build_start = browser ? performance.now() : 0
  const data = browser ? build_tree() : []
  const build_ms = browser ? performance.now() - build_start : null
  const n_nodes = n_top * (1 + n_mid * (1 + n_leaf))

  let mount_ms = $state<number | null>(null)
  let zoom_root_id = $state<string | number | null>(null)
  onMount(() => {
    mount_ms = performance.now() - build_start - (build_ms ?? 0)
  })
</script>

{#if browser}
  <Sunburst {data} bind:zoom_root_id show_labels={labels} style="height: 700px" />
{/if}

<pre data-testid="perf-metrics">{JSON.stringify({
    n_nodes,
    build_ms,
    mount_ms,
    zoom_root_id,
  })}</pre>
