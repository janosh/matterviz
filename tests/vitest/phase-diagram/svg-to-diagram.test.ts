import { build_diagram, find_phase_at_point } from '$lib/phase-diagram'
import type { DiagramPoint } from '$lib/phase-diagram/diagram-input'
import {
  parse_phase_diagram_svg,
  trace_region_outline,
} from '$lib/phase-diagram/svg-to-diagram'
import { describe, expect, it, vi } from 'vitest'

// Both fixtures draw the same diagram: plot area px x 100..500 ↔ composition 0..1,
// px y 500..100 ↔ temperature 500..1500 K. A vertical boundary at x=0.5 (T 500..1000) and a
// horizontal boundary at T=1000 (x 0..0.5) carve a rectangle out of the bottom-left corner,
// leaving an L-shaped region covering the rest.
const RECT_REGION: DiagramPoint[] = [
  [0, 500],
  [0.5, 500],
  [0.5, 1000],
  [0, 1000],
]
const L_REGION: DiagramPoint[] = [
  [0.5, 500],
  [1, 500],
  [1, 1500],
  [0, 1500],
  [0, 1000],
  [0.5, 1000],
]

const simple_svg = (boundaries: string, extra = ``) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <rect x="100" y="100" width="400" height="400" fill="#aabbcc"/>
    <rect x="100" y="300" width="200" height="200" style="fill: rgb(200, 100, 50); stroke: none"/>
    <g class="y-axis" transform="translate(0, 0)">
      <line class="tick-line" x1="95" y1="500" x2="100" y2="500"/>
      <text class="tick-text" x="90" y="500">500</text>
      <line class="tick-line" x1="95" y1="100" x2="100" y2="100"/>
      <text class="tick-text" x="90" y="100">1500 K</text>
    </g>
    <g class="x-axis">
      <text class="tick-text-x" x="100" y="520">0</text>
      <text class="tick-text-x" x="500" y="520">1.0</text>
    </g>
    ${boundaries}
    ${extra}
    <text class="label-main" x="200" y="400">α + β</text>
    <text class="label-main" x="400" y="400">L + α</text>
  </svg>`

const SIMPLE_BOUNDARIES = `<line class="phase-boundary" x1="300" y1="500" x2="300" y2="300"/>
    <line class="phase-boundary" x1="100" y1="300" x2="300" y2="300"/>`

// Matplotlib export skeleton: ticks are <use> markers with the value in an XML comment,
// boundaries are line2d_N groups, labels are text_N groups with LaTeX in comments
const matplotlib_svg = (boundary_paths: string[], extra = ``) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="600" height="600">
    <defs><path id="m1" d="M 0 0 L 0 3.5" style="stroke: #000000; stroke-width: 0.8"/></defs>
    <g id="figure_1">
      <g id="patch_1"><path d="M 0 0 L 600 0 L 600 600 L 0 600 z" style="fill: #ffffff"/></g>
      <g id="axes_1">
        <g id="patch_2"><path d="M 100 100 L 500 100 L 500 500 L 100 500 z" style="fill: #ffffff"/></g>
        <g id="patch_3"><path d="M 100 300 L 300 300 L 300 500 L 100 500 z" style="fill: #ff0000; opacity: 0.5"/></g>
        ${extra}
        <g id="xtick_1"><g id="line2d_1"><use xlink:href="#m1" x="100" y="500"/></g><g id="text_1"><!-- 0.0 --></g></g>
        <g id="xtick_2"><g id="line2d_2"><use xlink:href="#m1" x="500" y="500"/></g><g id="text_2"><!-- 1.0 --></g></g>
        <g id="ytick_1"><g id="line2d_3"><use xlink:href="#m1" x="100" y="500"/></g><g id="text_3"><!-- 500 --></g></g>
        <g id="ytick_2"><g id="line2d_4"><use xlink:href="#m1" x="100" y="100"/></g><g id="text_4"><!-- 1500 --></g></g>
        ${boundary_paths
          .map(
            (d_attr, idx) =>
              `<g id="line2d_${idx + 5}"><path d="${d_attr}" style="stroke-width: 1.5"/></g>`,
          )
          .join(``)}
        <g id="text_5"><!-- La$_2$O$_3$ + La$_2$NiO$_4$ --><g transform="translate(200 400)"/></g>
        <g id="text_6"><!-- La$_2$NiO$_4$ --><g transform="translate(400, 400)"/></g>
        <g><!-- + NiO --></g>
      </g>
    </g>
  </svg>`

const MPL_BOUNDARIES = [`M 300 500 L 300 300`, `M 100 300 L 300 300`]

const expect_points_close = (actual: DiagramPoint[], expected: DiagramPoint[]) =>
  expect(actual).toEqual(
    expected.map(([exp_x, exp_y]) => [expect.closeTo(exp_x, 6), expect.closeTo(exp_y, 6)]),
  )

describe(`parse_phase_diagram_svg`, () => {
  it.each([
    { format: `simple`, svg: simple_svg(SIMPLE_BOUNDARIES) },
    { format: `matplotlib`, svg: matplotlib_svg(MPL_BOUNDARIES) },
  ])(`traces region outlines as polygons, not bounding boxes ($format)`, ({ svg }) => {
    const input = parse_phase_diagram_svg(svg)
    expect(input.meta.temp_range).toEqual([500, 1500])
    expect(input.curves).toEqual({
      vertical_0: [
        [0.5, 500],
        [0.5, 1000],
      ],
      horizontal_0: [
        [0, 1000],
        [0.5, 1000],
      ],
    })
    expect(input.regions).toHaveLength(2)
    const [rect, l_shape] = input.regions
    // Regions are inline point polygons, so the bounds are the vertices
    expect_points_close(rect.bounds as DiagramPoint[], RECT_REGION)
    expect_points_close(l_shape.bounds as DiagramPoint[], L_REGION)

    // The rectangle's centroid must resolve to the rectangle even though the L-shaped
    // region is defined later (a bounding box for the L would swallow it)
    const data = build_diagram(input)
    expect(find_phase_at_point(0.25, 750, data)?.id).toBe(rect.id)
    expect(find_phase_at_point(0.75, 750, data)?.id).toBe(l_shape.id)
    expect(find_phase_at_point(0.25, 1250, data)?.id).toBe(l_shape.id)
  })

  // Grid vertices at px 100/200/300/400/500 ↔ x 0/0.25/0.5/0.75/1 and T 500/750/1000/1250/1500
  it.each([
    {
      label: `pinch vertex: two cells touching only diagonally stay on one outer loop`,
      // Region A is a hook: cells (1,1) and (2,2) touch only at the vertex (0.5, 1000 K); the
      // enclosed cell (1,2) is a hole whose edges also meet at that vertex, so a wrong turn
      // there would drag the hole's corners into the outer polygon
      boundaries: `<line class="phase-boundary" x1="100" y1="400" x2="300" y2="400"/>
        <line class="phase-boundary" x1="300" y1="400" x2="300" y2="200"/>
        <line class="phase-boundary" x1="200" y1="300" x2="500" y2="300"/>
        <line class="phase-boundary" x1="200" y1="300" x2="200" y2="200"/>
        <line class="phase-boundary" x1="200" y1="200" x2="300" y2="200"/>`,
      region_idx: 1,
      expected: [
        [0, 750],
        [0.5, 750],
        [0.5, 1000],
        [1, 1000],
        [1, 1500],
        [0, 1500],
      ] as DiagramPoint[],
      n_regions: 3,
    },
    {
      label: `enclosed region: the surrounding region's polygon drops the hole edges`,
      boundaries: `<line class="phase-boundary" x1="200" y1="400" x2="400" y2="400"/>
        <line class="phase-boundary" x1="200" y1="200" x2="400" y2="200"/>
        <line class="phase-boundary" x1="200" y1="400" x2="200" y2="200"/>
        <line class="phase-boundary" x1="400" y1="400" x2="400" y2="200"/>`,
      region_idx: 0,
      expected: [
        [0, 500],
        [1, 500],
        [1, 1500],
        [0, 1500],
      ] as DiagramPoint[],
      n_regions: 2,
    },
  ])(`traces $label`, ({ boundaries, region_idx, expected, n_regions }) => {
    const input = parse_phase_diagram_svg(simple_svg(boundaries))
    expect(input.regions).toHaveLength(n_regions)
    expect_points_close(input.regions[region_idx].bounds as DiagramPoint[], expected)
  })

  it(`assigns labels to regions and cleans matplotlib LaTeX subscripts`, () => {
    const simple = parse_phase_diagram_svg(simple_svg(SIMPLE_BOUNDARIES))
    expect(simple.regions.map((region) => region.name)).toEqual([`α + β`, `L + α`])
    // Non-ASCII names slug to nothing, so ids fall back to region_N
    expect(simple.regions.map((region) => region.id)).toEqual([`region_1`, `l`])

    const mpl = parse_phase_diagram_svg(matplotlib_svg(MPL_BOUNDARIES))
    expect(mpl.regions.map((region) => region.name)).toEqual([
      `La2O3 + La2NiO4`,
      `La2NiO4 + NiO`,
    ])
    expect(mpl.regions.map((region) => region.id)).toEqual([`la2o3_la2nio4`, `la2nio4_nio`])
  })

  it(`reads region colours from the filled SVG shape under each region centroid`, () => {
    const simple = parse_phase_diagram_svg(simple_svg(SIMPLE_BOUNDARIES))
    // Smallest fill containing the rectangle centroid (px 200,400) is the inner rect;
    // the L-shape centroid (px ~333,267) only lies in the outer rect
    const simple_colors = [`rgb(200, 100, 50)`, `#aabbcc`]
    expect(simple.regions.map((region) => region.color)).toEqual(simple_colors)

    const mpl = parse_phase_diagram_svg(matplotlib_svg(MPL_BOUNDARIES))
    // White figure/axes patches are backgrounds, not region fills → no colour for the L
    expect(mpl.regions.map((region) => region.color)).toEqual([`#ff0000`, undefined])
    expect(`color` in mpl.regions[1]).toBe(false)

    // matplotlib fill_between: polygon in <defs> with a y offset, fill on the <use>; a
    // transformed shape has an unknown pixel bbox and must not be picked up
    const fill_between = `<g id="FillBetweenPolyCollection_1">
        <defs><path id="mfb1" d="M 100 -500 L 100 -100 L 500 -100 L 500 -500 z" style="stroke: #00ff00"/></defs>
        <g clip-path="url(#p1)"><use xlink:href="#mfb1" x="0" y="600" style="fill: #00ff00; stroke: #00ff00"/></g>
      </g>
      <rect x="100" y="100" width="10" height="10" transform="scale(40)" fill="#0000ff"/>`
    const mpl_fills = parse_phase_diagram_svg(matplotlib_svg(MPL_BOUNDARIES, fill_between))
    expect(mpl_fills.regions.map((region) => region.color)).toEqual([`#ff0000`, `#00ff00`])

    // A thin L tucked inside the rectangle region: its bbox, px (150,350)-(250,450), is a
    // quarter the area of the rectangle's own fill and holds the probe at px 200,400, but the
    // probe sits in the L's notch. Choosing by bounding box painted the rectangle the L's colour.
    const thin_l = `<polygon points="150,350 250,350 250,360 160,360 160,450 150,450" fill="#ff00ff"/>`
    const concave = parse_phase_diagram_svg(simple_svg(SIMPLE_BOUNDARIES, thin_l))
    expect(concave.regions.map((region) => region.color)).toEqual(simple_colors)
  })

  it(`probes region colour inside the region even when its centroid falls outside`, () => {
    // Thin L: arms 0.1 wide along the left and bottom edges. Its area centroid (~0.29, ~790 K)
    // lies in the big square region, so a centroid probe would borrow that region's fill.
    const boundaries = `<line class="phase-boundary" x1="140" y1="460" x2="140" y2="100"/>
      <line class="phase-boundary" x1="140" y1="460" x2="500" y2="460"/>`
    const fills = `<rect x="140" y="100" width="360" height="360" fill="#112233"/>`
    const input = parse_phase_diagram_svg(simple_svg(boundaries, fills))
    const thin_l = input.regions.find((region) => region.bounds.length === 6)
    expect(thin_l?.color).toBe(`#aabbcc`)
    expect(input.regions.find((region) => region.bounds.length === 4)?.color).toBe(`#112233`)
  })

  it.each([
    { label: `relative l`, d_attr: `m 300 500 l 0 -200` },
    { label: `vertical V`, d_attr: `M 300 500 V 300` },
    { label: `compact commas`, d_attr: `M300,500L300,300` },
    { label: `implicit lineto after M`, d_attr: `M 300 500 300 300` },
    { label: `cubic curve endpoint`, d_attr: `M 300 500 C 300 450 300 350 300 300` },
    { label: `relative arc endpoint`, d_attr: `m 300 500 a 1 1 0 0 1 0 -200` },
  ])(`parses boundary path variant: $label`, ({ d_attr }) => {
    const input = parse_phase_diagram_svg(matplotlib_svg([d_attr, MPL_BOUNDARIES[1]]))
    expect(input.curves.vertical_0).toEqual([
      [0.5, 500],
      [0.5, 1000],
    ])
  })

  it.each([
    { d_attr: `M 100 100 L 300`, reason: /missing a coordinate/ },
    { d_attr: `M 100 100 L 300 foo`, reason: /unexpected characters "foo"/ },
    { d_attr: `M 100 100 X 300 300`, reason: /unexpected characters "X"/ },
    { d_attr: `100 100 300 300`, reason: /coordinates before any command/ },
    { d_attr: ``, reason: /no path commands/ },
  ])(`throws on malformed path data "$d_attr"`, ({ d_attr, reason }) => {
    const svg = matplotlib_svg([d_attr, MPL_BOUNDARIES[1]])
    expect(() => parse_phase_diagram_svg(svg)).toThrow(reason)
    expect(() => parse_phase_diagram_svg(svg)).toThrow(/Malformed SVG path data/)
  })

  it.each([
    {
      label: `phase-boundary line missing coordinates`,
      svg: simple_svg(`<line class="phase-boundary" x1="300" y1="500"/>`),
      reason: /missing numeric x1\/y1\/x2\/y2/,
    },
    {
      label: `no boundaries`,
      svg: simple_svg(``),
      reason: /No phase boundaries found/,
    },
    {
      label: `too few x ticks`,
      svg: simple_svg(SIMPLE_BOUNDARIES).replaceAll(`tick-text-x`, `other`),
      reason: /could not find x-axis tick marks in this SVG \(need at least 2, found 0\)/,
    },
    {
      label: `a single y tick`,
      svg: simple_svg(SIMPLE_BOUNDARIES).replace(`class="tick-text" x="90" y="100"`, ``),
      reason: /could not find y-axis tick marks in this SVG \(need at least 2, found 1\)/,
    },
    {
      // Neither matplotlib xtick_N groups nor class-based tick text (e.g. an MPDS export)
      label: `no tick marks at all`,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
        <text x="90" y="500">500</text><text x="90" y="100">1500</text>
        <line class="phase-boundary" x1="300" y1="500" x2="300" y2="300"/>
      </svg>`,
      reason: /could not find x-axis tick marks in this SVG/,
    },
    {
      label: `zero-range y ticks`,
      svg: simple_svg(SIMPLE_BOUNDARIES).replace(`>1500 K<`, `>500<`),
      reason: /y-axis ticks span a zero range/,
    },
    {
      label: `malformed filled path`,
      svg: simple_svg(SIMPLE_BOUNDARIES, `<path d="M 1 2 L" fill="#123456"/>`),
      reason: /Malformed SVG path data "M 1 2 L"/,
    },
  ])(`throws with context: $label`, ({ svg, reason }) => {
    expect(() => parse_phase_diagram_svg(svg)).toThrow(reason)
  })
})

describe(`trace_region_outline`, () => {
  it.each([
    {
      label: `single cell`,
      cells: [[0]],
      n_cols: 1,
      n_rows: 1,
      expected: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    },
    {
      label: `L of three cells`,
      cells: [
        [0, 0],
        [0, 1],
      ],
      n_cols: 2,
      n_rows: 2,
      expected: [
        [0, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 2],
        [0, 2],
      ],
    },
  ])(`traces a closed outline ($label)`, ({ cells, n_cols, n_rows, expected }) => {
    expect(trace_region_outline(cells, 0, n_cols, n_rows)).toEqual(expected)
  })

  it(`falls back to the bounding box with a warning when the outline cannot be closed`, () => {
    // Flood-filled regions always close, so break the invariant synthetically: cell (1, 0)
    // claims region 0 only on its first read (the neighbour check from cell (0, 0), which
    // therefore emits no right edge) and then denies it, so its own edges are never added
    // and the chain dead-ends at grid vertex (1, 0)
    let reads_of_cell_1_0 = 0
    const cell_ids = [
      [0],
      new Proxy([-1], {
        get: (_target, prop) => (prop === `0` && reads_of_cell_1_0++ === 0 ? 0 : -1),
      }),
    ]
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const outline = trace_region_outline(cell_ids, 0, 2, 1, `α + β`)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toBe(
      `Phase region "α + β": outline is not closed at grid vertex (1,0); using its bounding box instead`,
    )
    // Bounding box of the cells seen in region 0 (cell (0, 0) only)
    expect(outline).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ])
    warn.mockRestore()
  })

  it(`throws when the region has no cells`, () => {
    expect(() => trace_region_outline([[1]], 0, 1, 1)).toThrow(/Region 0 has no cells/)
  })
})
