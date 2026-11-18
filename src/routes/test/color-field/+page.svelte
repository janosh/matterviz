<script lang="ts">
  import type { Crystal } from '#lib'
  import type { Matrix3x3 } from '#lib/math.js'
  import { DEFAULTS } from '#lib/settings.js'
  import type { AtomColorField } from '#lib/structure/atom-color-field.js'
  import { cell_to_fractional } from '#lib/structure/cutaway.js'
  import { Structure } from '#lib/structure/index.js'
  import { make_site } from '#lib/structure/site.js'
  import TestSection from '../TestSection.svelte'

  // A thin slab (c < a, b) under a uniform cloud, viewed straight down c (orthographic): every
  // ray crosses one input cell along c, so a correct absorption step gives the same alpha at
  // the centre of each supercell. The sheared M (c' = c + a) has local fractional ray length
  // sqrt(2) per input cell, so absorbing over local steps would darken it ~1.4x.
  const matrix: Matrix3x3 = [
    [6, 0, 0],
    [0, 6, 0],
    [0, 0, 3],
  ]
  const structure: Crystal = {
    sites: [make_site(`C`, [0.5, 0.5, 0.5], [3, 3, 1.5], `C`)],
    lattice: {
      matrix,
      pbc: [true, true, true],
      a: 6,
      b: 6,
      c: 3,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: 108,
    },
  }
  const dims: [number, number, number] = [4, 4, 4]
  const colors = new Float32Array(dims[0] * dims[1] * dims[2] * 4)
  for (let offset = 0; offset < colors.length; offset += 4)
    colors.set([0.1, 0.3, 0.9, 0.3], offset) // straight RGB, density
  const field: AtomColorField = {
    colors,
    dims,
    pbc: [true, true, true],
    cartesian_to_fractional: cell_to_fractional(matrix),
  }
  const scene_props = {
    ...DEFAULTS.structure,
    show_atoms: false,
    show_image_atoms: false,
    show_bonds: `never` as const,
    cell_edge_opacity: 0,
    cell_surface_opacity: 0,
    show_cell_vectors: false,
    camera_projection: `orthographic` as const,
    camera_direction: [0, 0, 1] as [number, number, number],
    gizmo: false,
  }
  const cases = [
    { id: `cloud-1x1x1`, scaling: `1x1x1` },
    { id: `cloud-2x1x1`, scaling: `2x1x1` },
    { id: `cloud-sheared`, scaling: `1 0 0, 0 1 0, 1 0 1` },
  ]
</script>

<TestSection
  title="Colour-field cloud across supercells"
  description="Uniform cloud in a 6x6x3 A slab seen down c: each case's centre should match in opacity."
>
  <div style="display: flex; flex-wrap: wrap; gap: 1em">
    {#each cases as { id, scaling } (id)}
      <figure {id} style="margin: 0">
        <figcaption>{scaling}</figcaption>
        <Structure
          {structure}
          {scene_props}
          supercell_scaling={scaling}
          volume_color_field={field}
          volume_opacity={0.8}
          show_image_atoms={false}
          show_controls="never"
          background_color="#ffffff"
          style="width: 320px; height: 320px"
        />
      </figure>
    {/each}
  </div>
</TestSection>
