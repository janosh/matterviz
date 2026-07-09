<script lang="ts">
  // Temporary repro page for gibbs waste-sunburst label coverage: user ring
  // with pre-baked "name (share%)" labels, job leaves with "name · util%" +
  // label_short, colored by a utilization metric.
  import type { PositionedArc, SunburstNode } from '$lib/plot'
  import { Sunburst } from '$lib/plot'

  interface JobMeta extends Record<string, unknown> {
    util: number
  }

  // (user, share-of-total %, [job gpu counts...], base util)
  const users: [string, number[], number][] = [
    [`rishabh`, [420, 384, 96, 60, 40], 0.34],
    [`killian`, [240, 160, 80, 64, 48, 30, 20], 0.45],
    [`janosh`, [256, 128, 64, 50], 0.43],
    [`jason`, [160, 96, 48, 16], 0.1],
    [`costa`, [180, 60, 40], 0.44],
    [`zijie`, [150, 60, 30], 0.32],
    [`alex`, [130, 80, 24], 0.55],
    [`dmitry`, [50, 30], 0.21],
    [`byron`, [40, 20, 10], 0.61],
    [`arthur`, [30, 16, 8], 0.75],
    [`oleh`, [24, 12], 0.58],
    [`wei`, [16, 8], 0.48],
    [`mina`, [10, 6], 0.25],
    [`kat`, [8, 4], 0.55],
    [`tao`, [6, 3], 0.4],
  ]

  const total = users.reduce(
    (sum, [, jobs]) => sum + jobs.reduce((acc, gpus) => acc + gpus, 0),
    0,
  )

  const tree: SunburstNode<JobMeta>[] = users.map(([user, jobs, base_util]) => {
    const user_total = jobs.reduce((acc, gpus) => acc + gpus, 0)
    const share = Math.round((user_total / total) * 100)
    return {
      id: user,
      label: `${user} (${share}%)`,
      children: jobs.map((gpus, idx) => {
        const util = Math.max(0.02, Math.min(0.98, base_util + (idx % 3) * 0.08 - 0.06))
        const pct = `${Math.round(util * 100)}%`
        return {
          id: `${user}/${idx}`,
          label: `job-${user}-${idx} · ${pct}`,
          label_short: pct,
          value: gpus,
          metadata: { util },
        }
      }),
    }
  })

  const color_value = (arc: PositionedArc<JobMeta>): number | null =>
    arc.is_leaf && arc.metadata ? arc.metadata.util : null
</script>

<div style="width: 900px; height: 700px; background: #f2f2f5; margin: 2em auto">
  <Sunburst
    data={tree}
    color_values={color_value}
    color_scale="interpolateRdYlGn"
    color_range={[0, 1]}
    min_fraction={0.004}
    show_labels
    label_text="label"
    value_format=","
    show_controls={false}
    fullscreen_toggle={false}
    style="--sunburst-arc-stroke: #f2f2f5; --sunburst-arc-stroke-width: 1.2; --sunburst-colorbar-left: 0; --sunburst-colorbar-transform: none"
  />
</div>
