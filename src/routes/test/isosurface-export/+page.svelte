<script lang="ts">
  import { DEFAULT_ISOSURFACE_SETTINGS, make_volume } from '#lib/isosurface/types.js'
  import type { IsosurfaceSettings } from '#lib/isosurface/types.js'
  import Structure from '#lib/structure/Structure.svelte'
  import { make_site } from '#lib/structure/site.js'

  const size = 96 // Above the 500k-point preview cap and worker threshold.
  const values = new Float64Array(size ** 3)
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++)
      for (let z = 0; z < size; z++) {
        const radial = ((y - 48) ** 2 + (z - 48) ** 2) / 180
        values[(x * size + y) * size + z] =
          Math.exp(-((x - 28) ** 2) / 180 - radial) - Math.exp(-((x - 68) ** 2) / 180 - radial)
      }
  let volume = $state.raw(
    make_volume(values, [size, size, size], {
      id: `signed`,
      periodic: false,
      origin: [0, 0, 0],
      lattice: [
        [8, 0, 0],
        [0, 8, 0],
        [0, 0, 8],
      ],
    }),
  )
  // Frame the volume's full extent, rather than fitting the camera to a single atom.
  const structure = {
    sites: [
      make_site(`H`, [0, 0, 0], [0, 0, 0], `H1`),
      make_site(`H`, [1, 1, 1], [8, 8, 8], `H2`),
    ],
  }
  let mounted = $state(true)
  let show_volume = $state(true)
  let settings = $state<IsosurfaceSettings>({
    ...DEFAULT_ISOSURFACE_SETTINGS,
    layers: [
      {
        volume_id: `signed`,
        isovalue: 0.3,
        color: `#2563eb`,
        negative_color: `#ef4444`,
        show_negative: true,
        opacity: 1,
        visible: true,
      },
    ],
  })
</script>

<h1>Isosurface PNG export</h1>
<button onclick={() => (volume = { ...volume, values: volume.values.slice() })}
  >Rebuild volume</button
>
<button onclick={() => (settings.layers[0].isovalue = 0.4)}>Change isovalue</button>
<button onclick={() => (settings.layers[0].isovalue = 2)}>Empty surface</button>
<button onclick={() => (show_volume = false)}>Remove volume</button>
<button onclick={() => (mounted = false)}>Unmount viewer</button>
{#if mounted}
  <Structure
    id="test-structure"
    {structure}
    volumetric_data={show_volume ? [volume] : []}
    bind:isosurface_settings={settings}
    show_controls="always"
    analyze_symmetry={false}
    png_dpi={72}
    style="height: 480px; width: 640px;"
  />
{/if}
