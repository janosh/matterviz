<script lang="ts">
  import type { PositionedArc, SunburstNode } from '#lib/plot/index.js'
  import { Sunburst, sunburst_from_labels_parents } from '#lib/plot/index.js'
  import { spacegroup_sunburst_data } from '#lib/symmetry/index.js'
  import TestSection from '../TestSection.svelte'
  import TestStatus from '../TestStatus.svelte'

  // Three-level energy tree: sector -> source -> technology
  const energy: SunburstNode[] = [
    {
      label: `Renewable`,
      children: [
        {
          label: `Solar`,
          children: [
            { label: `PV`, value: 8 },
            { label: `CSP`, value: 2 },
          ],
        },
        { label: `Wind`, value: 12 },
        { label: `Hydro`, value: 6 },
      ],
    },
    {
      label: `Fossil`,
      children: [
        { label: `Coal`, value: 10 },
        { label: `Gas`, value: 12 },
      ],
    },
  ]

  // plotly trace format (matbench-discovery / pymatviz export style)
  const flat = sunburst_from_labels_parents(
    [`triclinic`, `1`, `2`, `cubic`, `225`, `229`],
    [``, `triclinic`, `triclinic`, ``, `cubic`, `cubic`],
    [10, 4, 6, 12, 8, 4],
    { ids: [`triclinic`, `triclinic/1`, `triclinic/2`, `cubic`, `cubic/225`, `cubic/229`] },
  )

  // Synthetic spacegroup distribution covering all 7 crystal systems
  const spacegroups = [
    ...Array(40).fill(225),
    ...Array(25).fill(227),
    ...Array(20).fill(2),
    ...Array(15).fill(14),
    ...Array(12).fill(62),
    ...Array(10).fill(139),
    ...Array(8).fill(166),
    ...Array(6).fill(194),
    ...Array(4).fill(1),
  ]

  // Large 3-level hierarchy (40 groups + 480 branches + 2400 leaves -> 2920 arcs;
  // the root isn't rendered) to exercise render pruning + zoom animation at scale
  const large: SunburstNode[] = Array.from({ length: 40 }, (_grp_el, grp) => ({
    label: `group-${grp}`,
    children: Array.from({ length: 12 }, (_sub_el, sub) => ({
      label: `g${grp}-s${sub}`,
      children: Array.from({ length: 5 }, (_leaf_el, leaf) => ({
        label: `g${grp}-s${sub}-l${leaf}`,
        value: 1 + ((grp + sub + leaf) % 5),
      })),
    })),
  }))

  const plot_style = `height: 360px`
  let hover_msg = $state(`Hover over an arc`)
  let click_msg = $state(`Click an arc`)
  let zoom_msg = $state(`Zoom root: (root)`)
</script>

<h1>Sunburst test page</h1>

<TestSection title="Basic (nested data)" id="basic-sunburst">
  <Sunburst data={energy} style={plot_style} />
</TestSection>

<TestSection title="Flat plotly-trace input, value_mode total, legend" id="flat-sunburst">
  <Sunburst data={flat} value_mode="total" show_legend style={plot_style} />
</TestSection>

<TestSection title="Click-to-zoom with handlers" id="zoom-sunburst">
  <Sunburst
    data={energy}
    tween={{ duration: 50 }}
    on_node_hover={(data) =>
      (hover_msg = data
        ? `Node: ${data.label_path.join(` > `)} = ${data.value}`
        : `Hover over an arc`)}
    on_node_click={(data) => (click_msg = `Clicked: ${data.label}`)}
    on_zoom={(data) => (zoom_msg = `Zoom root: ${data.root?.label ?? `(root)`}`)}
    style={plot_style}
  />
  <div class="handler-info">
    <TestStatus
      values={{
        'sunburst-hover': hover_msg,
        'sunburst-click': click_msg,
        'sunburst-zoom': zoom_msg,
      }}
    />
  </div>
</TestSection>

<TestSection title="Icicle shape" id="icicle-sunburst">
  <Sunburst shape="icicle" data={energy} tween={{ duration: 50 }} style={plot_style} />
</TestSection>

<TestSection title="Min-fraction bucketing, percent labels" id="other-sunburst">
  <Sunburst
    data={[
      { label: `big`, value: 80 },
      { label: `mid`, value: 12 },
      { label: `t1`, value: 3 },
      { label: `t2`, value: 3 },
      { label: `t3`, value: 2 },
    ]}
    min_fraction={0.05}
    label_text="label+percent"
    style={plot_style}
  />
</TestSection>

<TestSection title="Large hierarchy (2920 arcs)" id="large-sunburst">
  <Sunburst data={large} tween={{ duration: 50 }} show_labels={false} style="height: 400px" />
</TestSection>

<TestSection
  title="Metric coloring (colorbar reserves space, no overlap)"
  id="metric-sunburst"
>
  <Sunburst
    data={energy}
    color_values={(arc: PositionedArc) => arc.value}
    style={plot_style}
  />
</TestSection>

<TestSection title="Spacegroups (crystal system → spacegroup)" id="spacegroup-sunburst">
  <Sunburst data={spacegroup_sunburst_data(spacegroups)} style="height: 400px" />
</TestSection>
