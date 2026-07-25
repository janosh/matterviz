<script lang="ts">
  // Renders N independent Structure viewers on one page. Browsers cap simultaneous live WebGL
  // contexts (~16) and silently evict the oldest, which used to blank out earlier canvases and
  // forced StructureViewport to carry context-loss recovery. WebGPU has no equivalent cap, so
  // this route exists to keep that regression visible: every canvas should stay drawn.
  import type { Crystal, ElementSymbol } from '$lib'
  import { renderer_registry } from '$lib/io/export'
  import { calc_lattice_params, type Matrix3x3, type Vec3 } from '$lib/math'
  import type { Pbc } from '$lib/structure'
  import Structure from '$lib/structure/Structure.svelte'

  let viewer_count = $state(24)
  let grid: HTMLDivElement | undefined = $state()
  // Which backend the viewers actually got: three falls back to WebGL when it can't acquire a
  // device, so navigator.gpu alone doesn't tell the test what ran.
  let backend: string | undefined = $state()

  // A structure of its own per viewer: distinct enough that a blanked canvas stands out, and
  // small enough that 24 of them still paint promptly.
  const cell = 5
  const matrix: Matrix3x3 = [
    [cell, 0, 0],
    [0, cell, 0],
    [0, 0, cell],
  ]
  const elements: ElementSymbol[] = [`Fe`, `Cu`, `O`, `Si`, `C`, `N`]
  const lattice = { matrix, pbc: [true, true, true] as Pbc, ...calc_lattice_params(matrix) }
  const make_structure = (seed: number): Crystal => ({
    lattice,
    charge: 0,
    sites: Array.from({ length: 8 }, (_, idx) => {
      const abc: Vec3 = [
        (idx % 2) * 0.5,
        (Math.trunc(idx / 2) % 2) * 0.5,
        Math.trunc(idx / 4) * 0.5,
      ]
      const element = elements[(seed + idx) % elements.length]
      return {
        species: [{ element, occu: 1, oxidation_state: 0 }],
        abc,
        xyz: abc.map((frac) => frac * cell) as Vec3,
        label: `${element}${idx + 1}`,
        properties: {},
      }
    }),
  })

  let structures = $derived(
    Array.from({ length: viewer_count }, (_, idx) => make_structure(idx)),
  )

  $effect(() => {
    const requested = Number(new URLSearchParams(globalThis.location.search).get(`count`))
    if (Number.isFinite(requested) && requested >= 1 && requested <= 64) {
      viewer_count = Math.trunc(requested)
    }
  })

  $effect(() => {
    const grid_el = grid
    const expected = viewer_count
    if (!grid_el) return
    let cancelled = false
    // Every viewer, not just the first: a backend degrading under load would fall back on the
    // later canvases only. Poll since bind_renderer registers each canvas in its own effect,
    // and await init() since that's when three settles on a backend.
    const timer = setInterval(async () => {
      const canvases = [...grid_el.querySelectorAll(`canvas`)]
      // One registered renderer per canvas, no filtering: a canvas still awaiting registration
      // would otherwise let a partial grid pass as ready.
      if (canvases.length !== expected) return
      const renderers = canvases.map((canvas) => renderer_registry.get(canvas))
      if (!renderers.every((renderer) => renderer !== undefined)) return
      clearInterval(timer)
      try {
        await Promise.all(renderers.map((renderer) => renderer.init()))
      } catch (error) {
        console.error(`renderer init failed`, error)
        if (!cancelled) backend = `error`
        return
      }
      const all_webgpu = renderers.every(
        (renderer) => (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend,
      )
      if (!cancelled) backend = all_webgpu ? `webgpu` : `webgl`
    }, 100)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  })
</script>

<h1>Viewer Grid ({viewer_count} canvases)</h1>

<div class="grid" data-testid="viewer-grid" data-backend={backend} bind:this={grid}>
  {#each structures as structure, idx (idx)}
    <div class="cell" data-testid="viewer-{idx}">
      <Structure {structure} style="height: 160px" />
    </div>
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 8px;
  }
  .cell {
    border: 1px solid rgba(128, 128, 128, 0.35);
    border-radius: 4px;
    overflow: hidden;
  }
</style>
