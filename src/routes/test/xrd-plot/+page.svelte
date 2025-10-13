<script lang="ts">
  import type { PatternEntry, XrdPattern } from '$lib/xrd'
  import { XrdPlot } from '$lib/xrd'

  // Deterministic synthetic XRD-like patterns (angles in degrees, intensities arbitrary)
  const pattern_a: XrdPattern = {
    x: [20, 30, 40, 50, 60],
    y: [10, 80, 50, 30, 15],
    hkls: [
      [{ hkl: [1, 0, 0] }],
      [{ hkl: [1, 1, 0] }],
      [{ hkl: [1, 1, 1] }],
      [{ hkl: [2, 0, 0] }],
      [{ hkl: [2, 1, 0] }],
    ],
    d_hkls: [4.45, 2.98, 2.25, 1.83, 1.54],
  }
  const pattern_b: XrdPattern = {
    x: [22, 33, 44, 55, 66],
    y: [15, 60, 70, 25, 10],
    hkls: [
      [{ hkl: [1, 0, 1] }],
      [{ hkl: [1, 1, 1] }],
      [{ hkl: [2, 1, 1] }],
      [{ hkl: [2, 2, 0] }],
      [{ hkl: [3, 1, 0] }],
    ],
    d_hkls: [4.05, 2.72, 2.06, 1.67, 1.41],
  }

  const single_entries: PatternEntry[] = [
    { label: `Material A`, pattern: pattern_a },
  ]

  const multi_entries: PatternEntry[] = [
    { label: `Material A`, pattern: pattern_a },
    { label: `Material B`, pattern: pattern_b },
  ]
</script>

<svelte:head>
  <title>XrdPlot Test Page</title>
</svelte:head>

<h1>XrdPlot Component Playwright Tests</h1>

<section id="single-pattern">
  <h2>Single Series</h2>
  <XrdPlot
    patterns={single_entries}
    annotate_peaks={3}
    hkl_format="compact"
    x_axis={{ label: `2θ (degrees)` }}
    y_axis={{ label: `Intensity (a.u.)` }}
    style="height: 360px"
  />
</section>

<section id="multi-pattern">
  <h2>Multiple Series with Legend</h2>
  <XrdPlot
    patterns={multi_entries}
    annotate_peaks={0.5}
    hkl_format="full"
    x_axis={{ label: `2θ (degrees)` }}
    y_axis={{ label: `Intensity (a.u.)` }}
    style="height: 360px"
  />
</section>
