<script lang="ts">
  import type { BarSeries } from '#lib/plot/index.js'
  import { BarPlot } from '#lib/plot/index.js'
  import type { ComponentProps } from 'svelte'
  import TestSection from '../TestSection.svelte'

  // Most series share x positions and a bar width; only label, color and y vary
  const make_bars =
    (x: number[], bar_width: number) =>
    (
      label: string,
      color: string,
      y: number[],
      extra: Partial<BarSeries> = {},
    ): BarSeries => ({ x, y, label, color, bar_width, ...extra })
  const bars_4 = make_bars([1, 2, 3, 4], 0.6)
  const bars_3 = make_bars([1, 2, 3], 0.8)

  const basic_series = [bars_4(`Series 1`, `steelblue`, [10, 30, 20, 40])]
  const legend_series = [
    bars_4(`Alpha`, `#4e79a7`, [10, 30, 20, 40]),
    bars_4(`Beta`, `#e15759`, [20, 10, 35, 25]),
  ]
  // Mixed positive/negative values for stacked-mode testing
  const stacked_mixed_series = [
    bars_3(`Sposneg`, `#8cd17d`, [2, -3, 4]),
    bars_3(`Snegpos`, `#76b7b2`, [3, -2, -1]),
  ]
  const width_array_series: BarSeries[] = [
    {
      x: [1, 2, 3, 4],
      y: [4, 6, 5, 3],
      label: `VarWidth`,
      color: `#ff9da7`,
      bar_width: [0.3, 0.6, 1.0, 0.4],
    },
  ]
  const handlers_series = [bars_4(`With Handlers`, `#9467bd`, [12, 25, 18, 32])]

  let hover_msg = $state(`Hover over a bar`)
  let click_msg = $state(`Click on a bar`)

  const y2 = { y_axis: `y2` } as const
  const y2_cases: (ComponentProps<typeof BarPlot> & { id: string; title: string })[] = [
    {
      id: `y2-axis-bar`,
      title: `Y2 axis`,
      series: [
        bars_4(`Y1 Series`, `#4e79a7`, [10, 20, 15, 25]),
        bars_4(`Y2 Series`, `#e15759`, [100, 200, 150, 250], y2),
      ],
      y_axis: { label: `Y1` },
      y2_axis: { label: `Y2` },
    },
    {
      id: `y2-different-scale`,
      title: `Y2 different scale`,
      series: [
        bars_4(`Small Scale`, `#59a14f`, [5, 10, 8, 12]),
        bars_4(`Large Scale`, `#f28e2b`, [500, 1000, 800, 1200], y2),
      ],
      y_axis: { label: `Small` },
      y2_axis: { label: `Large` },
    },
    {
      id: `y2-stacked`,
      title: `Y2 stacked mode`,
      series: [
        bars_3(`Y1-A`, `#edc948`, [3, 5, 4]),
        bars_3(`Y1-B`, `#b07aa1`, [2, 3, 3]),
        bars_3(`Y2-A`, `#76b7b2`, [30, 50, 40], y2),
        bars_3(`Y2-B`, `#ff9da7`, [20, 30, 30], y2),
      ],
      y_axis: { label: `Y1` },
      y2_axis: { label: `Y2` },
      mode: `stacked`,
    },
    {
      id: `y2-line-series`,
      title: `Y2 line series`,
      series: [
        bars_4(`Bar Series`, `#4e79a7`, [10, 20, 15, 25]),
        {
          x: [1, 2, 3, 4],
          y: [100, 200, 150, 250],
          label: `Line Series`,
          color: `#e15759`,
          y_axis: `y2`,
          render_mode: `line`,
        },
      ],
      y_axis: { label: `Bars` },
      y2_axis: { label: `Line` },
    },
  ]

  // Categorical bar chart series — string x values with different categories per series
  const categorical_series: BarSeries[] = [
    {
      x: [`Si`, `GaAs`, `GaN`, `ZnO`, `Diamond`],
      y: [1.12, 1.43, 3.4, 3.37, 5.47],
      label: `Experimental`,
      color: `#4c6ef5`,
    },
    {
      x: [`Si`, `GaAs`, `GaN`, `ZnO`, `Diamond`, `CdTe`],
      y: [0.56, 0.55, 1.87, 0.73, 4.14, 0.58],
      label: `DFT (PBE)`,
      color: `#e15759`,
    },
    {
      x: [`Si`, `GaAs`, `Diamond`],
      y: [1.17, 1.52, 5.48],
      label: `GW`,
      color: `#59a14f`,
    },
  ]
  const categorical_cases: (ComponentProps<typeof BarPlot> & { id: string; title: string })[] =
    [
      { id: `categorical-bar`, title: `Categorical bar chart`, mode: `grouped` },
      { id: `categorical-stacked`, title: `Categorical stacked`, mode: `stacked` },
      {
        id: `categorical-horizontal`,
        title: `Categorical horizontal`,
        mode: `grouped`,
        orientation: `horizontal`,
      },
      {
        id: `categorical-custom-order`,
        title: `Categorical custom order`,
        mode: `grouped`,
        x_axis: { label: `Material`, categories: [`Diamond`, `GaN`, `Si`, `GaAs`] },
      },
    ]

  const categorical_single_series: BarSeries[] = [
    {
      x: [`Oxygen`, `Silicon`, `Aluminum`, `Iron`],
      y: [461000, 277200, 82300, 50000],
      label: `Abundance`,
      color: `#845ef7`,
    },
  ]
  let cat_hover_msg = $state(`Hover over a bar`)
  let cat_click_msg = $state(`Click on a bar`)

  const xy_axes = { x_axis: { label: `X` }, y_axis: { label: `Y` } }
  const tall = { style: `height: 360px` }
  const short = { style: `height: 300px` }
</script>

<h1>BarPlot test page</h1>

<TestSection id="basic-bar" title="Basic">
  <BarPlot
    series={basic_series}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y`, range: [0, 50] }}
    controls_open={false}
    {...tall}
  />
</TestSection>

<TestSection id="legend-bar" title="Legend and overlay">
  <BarPlot
    series={legend_series}
    x_axis={{ label: `Category` }}
    y_axis={{ label: `Value` }}
    {...tall}
  />
</TestSection>

<TestSection id="modes-bar" title="Modes and orientation">
  <BarPlot
    id="stacked-mixed"
    series={stacked_mixed_series}
    mode="stacked"
    {...xy_axes}
    {...short}
  />
  <BarPlot id="width-array" series={width_array_series} {...xy_axes} {...short} />
  <BarPlot
    id="stacked-mixed-horizontal"
    series={stacked_mixed_series}
    x_axis={{ label: `Y` }}
    y_axis={{ label: `X` }}
    mode="stacked"
    orientation="horizontal"
    {...short}
  />
</TestSection>

<TestSection id="handlers-bar" title="With handlers">
  <BarPlot
    series={handlers_series}
    on_bar_hover={(data) =>
      (hover_msg = data
        ? `Hovering: bar ${data.bar_idx + 1} (x=${data.x}, y=${data.y})`
        : `Hover over a bar`)}
    on_bar_click={(data) =>
      (click_msg = `Clicked: bar ${data.bar_idx + 1} (x=${data.x}, y=${data.y})`)}
    {...xy_axes}
    {...tall}
  />
  <div class="handler-info">
    <p>{hover_msg}</p>
    <p>{click_msg}</p>
  </div>
</TestSection>

{#each y2_cases as { id, title, ...props } (id)}
  <TestSection {id} {title}>
    <BarPlot x_axis={{ label: `X` }} {...props} {...tall} />
  </TestSection>
{/each}

{#each categorical_cases as { id, title, ...props } (id)}
  <TestSection {id} {title}>
    <BarPlot
      series={categorical_series}
      x_axis={{ label: `Material` }}
      y_axis={{ label: `Band Gap (eV)` }}
      {...props}
      {...tall}
    />
  </TestSection>
{/each}

<TestSection id="categorical-handlers" title="Categorical with handlers">
  <BarPlot
    series={categorical_single_series}
    x_axis={{ label: `Element` }}
    y_axis={{ label: `Abundance (ppm)` }}
    on_bar_hover={(data) =>
      (cat_hover_msg = data
        ? `Hovering: ${data.category_label} (y=${data.y})`
        : `Hover over a bar`)}
    on_bar_click={(data) => (cat_click_msg = `Clicked: ${data.category_label} (y=${data.y})`)}
    {...tall}
  />
  <div class="handler-info categorical-handler-info">
    <p>{cat_hover_msg}</p>
    <p>{cat_click_msg}</p>
  </div>
</TestSection>
