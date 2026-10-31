<script lang="ts">
  import type { PatternEntry, XrdPattern } from '#lib/xrd/index.js'
  import { XrdPlot } from '#lib/xrd/index.js'
  import TestSection from '../TestSection.svelte'

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

  const single_entries: PatternEntry[] = [{ label: `Material A`, pattern: pattern_a }]

  const multi_entries: PatternEntry[] = [
    ...single_entries,
    { label: `Material B`, pattern: pattern_b },
  ]

  const shared_props = {
    x_axis: { label: `2θ (degrees)` },
    y_axis: { label: `Intensity (a.u.)` },
    style: `height: 360px`,
  }
</script>

<h1>XrdPlot test page</h1>

<TestSection id="single-pattern" title="Single series">
  <XrdPlot
    patterns={single_entries}
    annotate_peaks={3}
    hkl_format="compact"
    {...shared_props}
  />
</TestSection>

<TestSection id="multi-pattern" title="Multiple series with legend">
  <XrdPlot patterns={multi_entries} annotate_peaks={0.5} hkl_format="full" {...shared_props} />
</TestSection>
