// SVG-to-DiagramInput converter
// Parses phase diagram SVGs (matplotlib or simple/Gemini format) into DiagramInput JSON
// for immediate rendering by IsobaricBinaryPhaseDiagram

import type { DiagramInput, DiagramPoint, RegionInput } from './diagram-input'

// Two-phase color keys to cycle through for region assignment
const TWO_PHASE_COLORS = [
  `two_phase`,
  `two_phase_intermetallic`,
  `two_phase_fcc_liquid`,
  `two_phase_intermetallic_alt`,
  `two_phase_alt`,
  `two_phase_gamma`,
  `two_phase_mixed`,
  `two_phase_si`,
  `two_phase_bcc_liquid`,
  `two_phase_hcp_liquid`,
  `two_phase_theta_liquid`,
  `two_phase_eta`,
]

// Round to 6 decimal places for clean floating-point output
const round = (val: number): number => Math.round(val * 1e6) / 1e6

// === Types ===

type SvgFormat = `matplotlib` | `simple` | `mpds`

interface LinearScale {
  to_data: (px: number) => number
  domain: [number, number] // [min_data, max_data]
}

interface Boundary {
  x1: number // data coordinates
  y1: number
  x2: number
  y2: number
  orientation: `horizontal` | `vertical`
}

interface Label {
  text: string // plain text, e.g. "La2NiO4 + NiO"
  px_x: number // pixel position
  px_y: number
}

// === Format Detection ===

// Detect whether the SVG is matplotlib, MPDS, or simple format
function detect_format(doc: Document): SvgFormat {
  // Matplotlib SVGs have xtick/ytick group IDs
  if (
    doc.querySelector(`[id^="xtick_"]`) || doc.querySelector(`[id^="ytick_"]`)
  ) {
    return `matplotlib`
  }
  // MPDS SVGs (from CorelDRAW/Inkscape) have sodipodi namespace or inkscape attributes
  const svg_el = doc.querySelector(`svg`)
  if (
    svg_el?.getAttribute(`sodipodi:docname`) ||
    svg_el?.getAttribute(`inkscape:version`) ||
    svg_el?.getAttributeNS(
      `http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd`,
      `docname`,
    )
  ) {
    return `mpds`
  }
  return `simple`
}

// === Axis Scale Extraction ===

// Extract x and y axis scales from tick marks
function extract_axis_scales(
  doc: Document,
  format: SvgFormat,
): { x_scale: LinearScale; y_scale: LinearScale } {
  const x_ticks: { px: number; value: number }[] = []
  const y_ticks: { px: number; value: number }[] = []

  if (format === `matplotlib`) {
    extract_matplotlib_ticks(doc, x_ticks, y_ticks)
  } else if (format === `mpds`) {
    return extract_mpds_scales(doc)
  } else {
    extract_simple_ticks(doc, x_ticks, y_ticks)
  }

  if (x_ticks.length < 2) {
    throw new Error(`Need at least 2 x-axis ticks, found ${x_ticks.length}`)
  }
  if (y_ticks.length < 2) {
    throw new Error(`Need at least 2 y-axis ticks, found ${y_ticks.length}`)
  }

  return {
    x_scale: build_scale(x_ticks),
    y_scale: build_scale(y_ticks), // y-axis inverted (SVG y down, temp up)
  }
}

// Extract ticks from matplotlib SVG (id="xtick_N", comment-based values)
function extract_matplotlib_ticks(
  doc: Document,
  x_ticks: { px: number; value: number }[],
  y_ticks: { px: number; value: number }[],
): void {
  const axes: [string, string, { px: number; value: number }[]][] = [
    [`xtick_`, `x`, x_ticks],
    [`ytick_`, `y`, y_ticks],
  ]
  for (const [prefix, attr, ticks] of axes) {
    for (const group of Array.from(doc.querySelectorAll(`[id^="${prefix}"]`))) {
      const value = extract_comment_number(group)
      const use_el = group.querySelector(`use`)
      if (value !== null && use_el) {
        const px = parse_float_attr(use_el, attr)
        if (px !== null) ticks.push({ px, value })
      }
    }
  }
}

// Extract ticks from simple SVG (class-based text elements)
function extract_simple_ticks(
  doc: Document,
  x_ticks: { px: number; value: number }[],
  y_ticks: { px: number; value: number }[],
): void {
  // Y-axis ticks: class="tick-text" with text-anchor: end
  for (const text_el of Array.from(doc.querySelectorAll(`.tick-text`))) {
    const value = parseFloat(text_el.textContent?.trim() ?? ``)
    if (isNaN(value)) continue

    // Find the immediately preceding sibling tick line (not just any line in parent)
    const tick_line = text_el.previousElementSibling
    if (!tick_line || !tick_line.matches(`.tick-line, line`)) continue
    const py = parse_float_attr(tick_line, `y1`)
    // Apply parent group transform if present
    const parent = text_el.parentElement
    const transform_y = get_group_translate(parent, `y`)
    if (py !== null) y_ticks.push({ px: py + transform_y, value })
  }

  // X-axis ticks: class="tick-text-x"
  for (const text_el of Array.from(doc.querySelectorAll(`.tick-text-x`))) {
    const value = parseFloat(text_el.textContent?.trim() ?? ``)
    if (isNaN(value)) continue

    const px_x = parse_float_attr(text_el, `x`)
    // Apply parent group transform if present
    const parent = text_el.parentElement
    const transform_x = get_group_translate(parent, `x`)
    if (px_x !== null) x_ticks.push({ px: px_x + transform_x, value })
  }
}

// Extract scales from MPDS SVGs using tick mark paths and text values
// MPDS SVGs store tick marks as multi-segment paths with major ticks (longer)
// and minor ticks (shorter). Text values are not positionally useful but
// tell us the data range.
function extract_mpds_scales(
  doc: Document,
): { x_scale: LinearScale; y_scale: LinearScale } {
  // Extract all numeric text values to infer axis ranges
  const numbers: number[] = []
  for (const text_el of Array.from(doc.querySelectorAll(`text`))) {
    const val = parseFloat(text_el.textContent?.trim() ?? ``)
    if (!isNaN(val)) numbers.push(val)
  }

  // Separate composition (0-100 at%) from temperature (typically 100-3000)
  // Note: value 100 appears in both filters (valid as 100 at% and 100°C).
  // This is intentional — only endpoints are used for scale mapping.
  const comp_vals = [
    ...new Set(numbers.filter((v) => v >= 0 && v <= 100 && v % 10 === 0)),
  ].sort((a, b) => a - b)
  const temp_vals = [
    ...new Set(numbers.filter((v) => v >= 100 && v % 100 === 0 && v <= 3000)),
  ].sort((a, b) => a - b)

  if (comp_vals.length < 2 || temp_vals.length < 2) {
    throw new Error(
      `MPDS SVG: could not infer axis ranges (found ${comp_vals.length} composition, ${temp_vals.length} temperature values)`,
    )
  }

  // Find tick mark paths — multi-segment paths with stroke-width ~0.5
  // containing both major (longer) and minor (shorter) tick marks
  const x_major_ticks: number[] = []
  const y_major_ticks: number[] = []

  for (const path of Array.from(doc.querySelectorAll(`path`))) {
    const d = path.getAttribute(`d`) ?? ``
    const stroke_width = parse_stroke_width(path)

    // Tick mark paths have stroke-width ~0.5
    if (stroke_width < 0.3 || stroke_width > 1.0) continue

    // Parse path into absolute line segments (handles both absolute & relative commands)
    const segments = parse_path_segments(d)
    if (segments.length < 3) continue

    for (const [sx1, sy1, sx2, sy2] of segments) {
      const seg_dx = Math.abs(sx2 - sx1)
      const seg_dy = Math.abs(sy2 - sy1)

      // Major ticks are longer (~3.9 px), minor are shorter (~1.7 px)
      if (Math.hypot(seg_dx, seg_dy) < 3) continue

      // Horizontal tick segments → y-axis tick (x changes, y constant)
      if (seg_dy < 0.1 && seg_dx > 2) {
        y_major_ticks.push(Math.round(sy1 * 100) / 100)
      }
      // Vertical tick segments → x-axis tick (y changes, x constant)
      if (seg_dx < 0.1 && seg_dy > 2) {
        x_major_ticks.push(Math.round(sx1 * 100) / 100)
      }
    }
  }

  // Deduplicate and sort
  const x_ticks_sorted = [...new Set(x_major_ticks.map((v) => Math.round(v * 10) / 10))]
    .sort((a, b) => a - b)
  const y_ticks_sorted = [...new Set(y_major_ticks.map((v) => Math.round(v * 10) / 10))]
    .sort((a, b) => a - b)

  if (x_ticks_sorted.length < 2 || y_ticks_sorted.length < 2) {
    throw new Error(
      `MPDS SVG: could not find tick marks (found ${x_ticks_sorted.length} x-ticks, ${y_ticks_sorted.length} y-ticks)`,
    )
  }

  // Map tick positions to data values using endpoints
  // Only the first and last tick+value need to match for a linear scale
  // x-axis: composition in at% → fraction; y-axis: temperature (SVG y inverted)
  const x_ticks = [
    { px: x_ticks_sorted[0], value: comp_vals[0] / 100 },
    {
      px: x_ticks_sorted[x_ticks_sorted.length - 1],
      value: comp_vals[comp_vals.length - 1] / 100,
    },
  ]
  const y_ticks = [
    { px: y_ticks_sorted[0], value: temp_vals[temp_vals.length - 1] }, // top = highest temp
    { px: y_ticks_sorted[y_ticks_sorted.length - 1], value: temp_vals[0] }, // bottom = lowest temp
  ]

  return {
    x_scale: build_scale(x_ticks),
    y_scale: build_scale(y_ticks),
  }
}

// Build a linear scale from tick data points
function build_scale(ticks: { px: number; value: number }[]): LinearScale {
  ticks.sort((a, b) => a.value - b.value)
  const first = ticks[0]
  const last = ticks[ticks.length - 1]

  const range = last.value - first.value
  if (range === 0) {
    return { to_data: () => first.value, domain: [first.value, last.value] }
  }
  const px_per_unit = (last.px - first.px) / range

  return {
    to_data: (px: number) => first.value + (px - first.px) / px_per_unit,
    domain: [first.value, last.value],
  }
}

// === Boundary Extraction ===

// Extract phase boundary lines from SVG and convert to data coordinates
function extract_boundaries(
  doc: Document,
  format: SvgFormat,
  x_scale: LinearScale,
  y_scale: LinearScale,
): Boundary[] {
  const boundaries: Boundary[] = []
  const epsilon = 0.5 // pixel tolerance for classifying horizontal/vertical

  if (format === `mpds`) {
    extract_mpds_boundaries(doc, boundaries, x_scale, y_scale, epsilon)
  } else if (format === `matplotlib`) {
    // Matplotlib: look for line2d_N groups with path elements (skip tick marks at line2d_1..12ish)
    for (const group of Array.from(doc.querySelectorAll(`[id^="line2d_"]`))) {
      const path_el = group.querySelector(`path`)
      if (!path_el) continue

      const d_attr = path_el.getAttribute(`d`)
      if (!d_attr) continue

      // Parse "M x1 y1 L x2 y2" path data
      const coords = parse_ml_path(d_attr)
      if (!coords) continue

      // Skip tick mark lines (short lines, typically < 10px)
      const dx = Math.abs(coords.x2 - coords.x1)
      const dy = Math.abs(coords.y2 - coords.y1)
      if (dx < 15 && dy < 15) continue

      // Check stroke-width to distinguish boundaries from axis lines
      const stroke_width = parse_stroke_width(path_el) || 1

      // Axis patches (id="patch_*") are axis borders, not phase boundaries
      const parent_id = group.getAttribute(`id`) ?? ``
      if (parent_id.startsWith(`patch_`)) continue

      // Only include lines with meaningful stroke
      if (stroke_width < 1) continue

      add_boundary(boundaries, coords, x_scale, y_scale, epsilon)
    }
  } else {
    // Simple: <line class="phase-boundary">
    for (
      const line_el of Array.from(
        doc.querySelectorAll(`.phase-boundary, line[class*="phase-boundary"]`),
      )
    ) {
      const x1 = parse_float_attr(line_el, `x1`)
      const y1 = parse_float_attr(line_el, `y1`)
      const x2 = parse_float_attr(line_el, `x2`)
      const y2 = parse_float_attr(line_el, `y2`)
      if (x1 === null || y1 === null || x2 === null || y2 === null) continue

      add_boundary(boundaries, { x1, y1, x2, y2 }, x_scale, y_scale, epsilon)
    }
  }

  return boundaries
}

// Extract boundaries from MPDS SVGs — simple M x1,y1 L x2,y2 path elements
// inside the plot area with thin stroke (0.216) and dark color
function extract_mpds_boundaries(
  doc: Document,
  boundaries: Boundary[],
  x_scale: LinearScale,
  y_scale: LinearScale,
  epsilon: number,
): void {
  // Find the plot border to filter boundaries inside it
  const plot_rect = find_mpds_plot_rect(doc)
  if (!plot_rect) return

  const { left, right, top, bottom } = plot_rect

  for (const path of Array.from(doc.querySelectorAll(`path`))) {
    const d = path.getAttribute(`d`) ?? ``
    const style = path.getAttribute(`style`) ?? ``

    // Skip tick mark paths (stroke-width > 0.3)
    const stroke_width = parse_stroke_width(path)
    if (stroke_width > 0.3 || stroke_width === 0) continue

    // Skip filled regions (phase region fills)
    if (
      style.includes(`fill-rule`) || style.includes(`fill: #`) || style.includes(`fill:#`)
    ) {
      if (!style.includes(`fill: none`) && !style.includes(`fill:none`)) continue
    }

    // Skip red annotation lines
    if (style.includes(`#e30016`) || style.includes(`#E30016`)) continue

    // Parse as simple M...L line
    const coords = parse_ml_path(d)
    if (!coords) continue

    // Must be inside the plot area
    const inside = coords.x1 >= left - 1 && coords.x1 <= right + 1 &&
      coords.x2 >= left - 1 && coords.x2 <= right + 1 &&
      coords.y1 >= top - 1 && coords.y1 <= bottom + 1 &&
      coords.y2 >= top - 1 && coords.y2 <= bottom + 1
    if (!inside) continue

    // Skip very short segments (< 10px)
    const dx = Math.abs(coords.x2 - coords.x1)
    const dy = Math.abs(coords.y2 - coords.y1)
    if (dx < 10 && dy < 10) continue

    // Skip the plot border itself (connects all 4 edges)
    const touches_left = Math.abs(coords.x1 - left) < 2 || Math.abs(coords.x2 - left) < 2
    const touches_right = Math.abs(coords.x1 - right) < 2 ||
      Math.abs(coords.x2 - right) < 2
    if (touches_left && touches_right) continue // spans full width = likely axis

    add_boundary(boundaries, coords, x_scale, y_scale, epsilon)
  }
}

// Find the plot area rectangle in an MPDS SVG
// Handles both M...L...L...L...Z and M...V...H...V...Z formats
function find_mpds_plot_rect(
  doc: Document,
): { left: number; right: number; top: number; bottom: number } | null {
  for (const path of Array.from(doc.querySelectorAll(`path`))) {
    const d = path.getAttribute(`d`) ?? ``
    const style = path.getAttribute(`style`) ?? ``
    if (!style.includes(`fill: none`) && !style.includes(`fill:none`)) continue
    if (!d.includes(`Z`) && !d.includes(`z`)) continue

    // Parse path into absolute segments and extract corner points
    const segments = parse_path_segments(d)
    if (segments.length < 3) continue // rectangle needs at least 3 segments (4th is Z)

    // Collect all x and y coordinates from segment endpoints
    const xs: number[] = []
    const ys: number[] = []
    for (const [x1, y1, x2, y2] of segments) {
      xs.push(Math.round(x1 * 10) / 10, Math.round(x2 * 10) / 10)
      ys.push(Math.round(y1 * 10) / 10, Math.round(y2 * 10) / 10)
    }

    const unique_x = [...new Set(xs)]
    const unique_y = [...new Set(ys)]

    // Rectangle has exactly 2 unique x and 2 unique y values
    if (unique_x.length === 2 && unique_y.length === 2) {
      return {
        left: Math.min(...unique_x),
        right: Math.max(...unique_x),
        top: Math.min(...unique_y),
        bottom: Math.max(...unique_y),
      }
    }
  }
  return null
}

// Add a boundary line, classifying as horizontal or vertical
function add_boundary(
  boundaries: Boundary[],
  px: { x1: number; y1: number; x2: number; y2: number },
  x_scale: LinearScale,
  y_scale: LinearScale,
  epsilon: number,
): void {
  const is_vertical = Math.abs(px.x1 - px.x2) < epsilon
  const is_horizontal = Math.abs(px.y1 - px.y2) < epsilon

  if (!is_vertical && !is_horizontal) return // skip diagonal lines

  const data_x1 = x_scale.to_data(px.x1)
  const data_y1 = y_scale.to_data(px.y1)
  const data_x2 = x_scale.to_data(px.x2)
  const data_y2 = y_scale.to_data(px.y2)

  boundaries.push({
    x1: Math.min(data_x1, data_x2),
    y1: Math.min(data_y1, data_y2),
    x2: Math.max(data_x1, data_x2),
    y2: Math.max(data_y1, data_y2),
    orientation: is_vertical ? `vertical` : `horizontal`,
  })
}

// === Label Extraction ===

// Extract phase region labels with their pixel positions
function extract_labels(doc: Document, format: SvgFormat): Label[] {
  const labels: Label[] = []

  if (format === `matplotlib`) {
    extract_matplotlib_labels(doc, labels)
  } else if (format === `mpds`) {
    // MPDS labels use garbled encoding; skip label extraction
    // Regions will get auto-generated names from infer_regions
  } else {
    extract_simple_labels(doc, labels)
  }

  return labels
}

// Extract labels from matplotlib SVG using XML comments
function extract_matplotlib_labels(doc: Document, labels: Label[]): void {
  // Find text groups with comments containing phase names
  // Matplotlib may split multi-line labels (especially rotated ones) into
  // separate <g> groups: text_N has "La$_2$NiO$_4$", followed by a sibling
  // with "+ La$_3$Ni$_2$O$_7$". We concatenate these continuation groups.
  for (const group of Array.from(doc.querySelectorAll(`[id^="text_"]`))) {
    let comment = find_comment_text(group)
    if (!comment) continue

    // Check following sibling groups for continuation comments starting with "+"
    let sibling = group.nextElementSibling
    while (sibling) {
      // Stop at the next text_N group (that's a separate label)
      if (sibling.id?.startsWith(`text_`)) break
      const continuation = find_comment_text(sibling)
      if (continuation?.trimStart().startsWith(`+`)) {
        comment += ` ${continuation.trim()}`
        sibling = sibling.nextElementSibling
      } else {
        break
      }
    }

    if (!comment.includes(`+`)) continue // skip axis labels (no "+")

    // Clean LaTeX: "La$_2$NiO$_4$ + NiO" -> "La2NiO4 + NiO"
    const text = clean_latex(comment.trim())

    // Get position from transform="translate(x, y)"
    const pos = parse_translate(group.querySelector(`g[transform]`)) ??
      parse_translate(group)
    if (!pos) continue

    labels.push({ text, px_x: pos[0], px_y: pos[1] })
  }
}

// Extract labels from simple SVG using class="label-main"
function extract_simple_labels(doc: Document, labels: Label[]): void {
  for (const text_el of Array.from(doc.querySelectorAll(`.label-main`))) {
    // Get plain text content (strips tspan tags)
    const text = (text_el.textContent ?? ``).replace(/\s+/g, ` `).trim()
    if (!text.includes(`+`)) continue // skip non-phase labels

    // Get position from transform or x/y attributes
    const pos = parse_translate(text_el)
    const px_x = pos?.[0] ?? parse_float_attr(text_el, `x`)
    const px_y = pos?.[1] ?? parse_float_attr(text_el, `y`)

    if (px_x !== null && px_y !== null) {
      labels.push({ text, px_x, px_y })
    }
  }
}

// === Component Inference ===

// Infer binary components from region labels
function infer_components(labels: Label[]): [string, string] {
  // Sort labels by x position, split each into phases
  const sorted = [...labels].sort((a, b) => a.px_x - b.px_x)
  if (sorted.length < 2) return [`A`, `B`]

  const split = (label: Label) => label.text.split(/\s*\+\s*/)
  const leftmost = split(sorted[0])
  const rightmost = split(sorted[sorted.length - 1])

  // Component A: the unique phase in the leftmost region that doesn't appear on the right
  // For "La2NiO4 + La2O3", La2O3 is the pure A endpoint
  let comp_a = `A`
  if (leftmost.length === 2) {
    const right_phases = sorted.slice(-3).flatMap(split)
    comp_a = leftmost.find((p) => !right_phases.includes(p)) ?? leftmost[1] ?? `A`
  }

  // Component B: the unique phase in the rightmost region that doesn't appear on the left
  let comp_b = `B`
  if (rightmost.length === 2) {
    const left_phases = sorted.slice(0, 3).flatMap(split)
    comp_b = rightmost.find((p) => !left_phases.includes(p)) ?? rightmost[1] ?? `B`
  }

  return [comp_a, comp_b]
}

// === Region Inference ===

// Infer phase regions from orthogonal boundaries using flood-fill on a cell grid
function infer_regions(
  boundaries: Boundary[],
  labels: Label[],
  x_scale: LinearScale,
  y_scale: LinearScale,
): RegionInput[] {
  const verticals = boundaries.filter((b) => b.orientation === `vertical`)
  const horizontals = boundaries.filter((b) => b.orientation === `horizontal`)

  // Collect all unique x and y coordinates (boundaries + domain edges)
  const x_coords = collect_unique_sorted([
    x_scale.domain[0],
    x_scale.domain[1],
    ...verticals.map((b) => b.x1), // x1 === x2 for vertical
  ])

  const y_coords = collect_unique_sorted([
    y_scale.domain[0],
    y_scale.domain[1],
    ...horizontals.map((b) => b.y1), // y1 === y2 for horizontal
  ])

  // Build cell grid: cells[col][row]
  const n_cols = x_coords.length - 1
  const n_rows = y_coords.length - 1
  const cell_ids = Array.from(
    { length: n_cols },
    () => new Array<number>(n_rows).fill(-1),
  )

  // Check which cell edges have boundaries
  const h_walls = Array.from(
    { length: n_cols },
    () => new Array<boolean>(n_rows + 1).fill(false),
  )
  const v_walls = Array.from(
    { length: n_cols + 1 },
    () => new Array<boolean>(n_rows).fill(false),
  )

  // Mark horizontal walls (bottom/top of cells)
  for (const hb of horizontals) {
    const row = find_coord_index(y_coords, hb.y1)
    if (row === -1) continue
    for (let col = 0; col < n_cols; col++) {
      const cell_x_min = x_coords[col]
      const cell_x_max = x_coords[col + 1]
      // Check if the boundary spans this cell's x range
      if (hb.x1 <= cell_x_min + 1e-6 && hb.x2 >= cell_x_max - 1e-6) {
        h_walls[col][row] = true
      }
    }
  }

  // Mark vertical walls (left/right of cells)
  for (const vb of verticals) {
    const col = find_coord_index(x_coords, vb.x1)
    if (col === -1) continue
    for (let row = 0; row < n_rows; row++) {
      const cell_y_min = y_coords[row]
      const cell_y_max = y_coords[row + 1]
      // Check if the boundary spans this cell's y range
      if (vb.y1 <= cell_y_min + 1e-6 && vb.y2 >= cell_y_max - 1e-6) {
        v_walls[col][row] = true
      }
    }
  }

  // Plot edges are always walls
  for (let col = 0; col < n_cols; col++) {
    h_walls[col][0] = true // bottom edge
    h_walls[col][n_rows] = true // top edge
  }
  for (let row = 0; row < n_rows; row++) {
    v_walls[0][row] = true // left edge
    v_walls[n_cols][row] = true // right edge
  }

  // Flood-fill to assign region IDs
  let next_region_id = 0
  for (let col = 0; col < n_cols; col++) {
    for (let row = 0; row < n_rows; row++) {
      if (cell_ids[col][row] !== -1) continue
      flood_fill(cell_ids, h_walls, v_walls, col, row, n_cols, n_rows, next_region_id)
      next_region_id++
    }
  }

  // Assign labels to regions by checking which region contains each label's position
  const region_labels = new Map<number, string>()
  for (const label of labels) {
    const data_x = x_scale.to_data(label.px_x)
    const data_y = y_scale.to_data(label.px_y)

    const col = find_cell_index(x_coords, data_x)
    const row = find_cell_index(y_coords, data_y)
    if (col >= 0 && col < n_cols && row >= 0 && row < n_rows) {
      const region_id = cell_ids[col][row]
      if (region_id !== -1) {
        region_labels.set(region_id, label.text)
      }
    }
  }

  // Build region polygons from merged cells
  const regions: RegionInput[] = []
  for (let region_id = 0; region_id < next_region_id; region_id++) {
    const name = region_labels.get(region_id) ?? `Region ${region_id + 1}`
    // Slug can be empty for non-ASCII labels like "α + β" — fall back to region_N
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, `_`).replace(
      /^_|_$/g,
      ``,
    ) || `region_${region_id + 1}`

    // Find bounding box of all cells in this region
    let min_x = Infinity
    let max_x = -Infinity
    let min_y = Infinity
    let max_y = -Infinity
    for (let col = 0; col < n_cols; col++) {
      for (let row = 0; row < n_rows; row++) {
        if (cell_ids[col][row] !== region_id) continue
        min_x = Math.min(min_x, x_coords[col])
        max_x = Math.max(max_x, x_coords[col + 1])
        min_y = Math.min(min_y, y_coords[row])
        max_y = Math.max(max_y, y_coords[row + 1])
      }
    }

    if (min_x === Infinity) continue

    const bounds: DiagramPoint[] = [
      [round(min_x), round(min_y)],
      [round(max_x), round(min_y)],
      [round(max_x), round(max_y)],
      [round(min_x), round(max_y)],
    ]

    regions.push({
      id: slug,
      name,
      color: TWO_PHASE_COLORS[region_id % TWO_PHASE_COLORS.length],
      bounds,
    })
  }

  return regions
}

// Flood-fill connected cells that share an open edge
function flood_fill(
  cell_ids: number[][],
  h_walls: boolean[][],
  v_walls: boolean[][],
  start_col: number,
  start_row: number,
  n_cols: number,
  n_rows: number,
  region_id: number,
): void {
  const stack: [number, number][] = [[start_col, start_row]]

  for (let item = stack.pop(); item; item = stack.pop()) {
    const [col, row] = item
    if (col < 0 || col >= n_cols || row < 0 || row >= n_rows) continue
    if (cell_ids[col][row] !== -1) continue

    cell_ids[col][row] = region_id

    // Check neighbors (no wall between them)
    // Left neighbor: check v_walls[col][row]
    if (col > 0 && !v_walls[col][row]) stack.push([col - 1, row])
    // Right neighbor: check v_walls[col+1][row]
    if (col < n_cols - 1 && !v_walls[col + 1][row]) stack.push([col + 1, row])
    // Bottom neighbor: check h_walls[col][row]
    if (row > 0 && !h_walls[col][row]) stack.push([col, row - 1])
    // Top neighbor: check h_walls[col][row+1]
    if (row < n_rows - 1 && !h_walls[col][row + 1]) stack.push([col, row + 1])
  }
}

// === Curve Generation ===

// Generate named curves from boundaries for the DiagramInput format
function generate_curves(boundaries: Boundary[]): Record<string, DiagramPoint[]> {
  const curves: Record<string, DiagramPoint[]> = {}
  const counts = { vertical: 0, horizontal: 0 }

  for (const bnd of boundaries) {
    const is_vert = bnd.orientation === `vertical`
    const name = `${bnd.orientation}_${counts[bnd.orientation]++}`
    curves[name] = [
      [round(bnd.x1), round(bnd.y1)],
      [round(is_vert ? bnd.x1 : bnd.x2), round(is_vert ? bnd.y2 : bnd.y1)],
    ]
  }

  return curves
}

// === Main Entry Point ===

// Parse a phase diagram SVG string and return a DiagramInput
export function parse_phase_diagram_svg(svg_string: string): DiagramInput {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svg_string, `image/svg+xml`)

  // Check for parse errors
  const parse_error = doc.querySelector(`parsererror`)
  if (parse_error) {
    throw new Error(`Invalid SVG: ${parse_error.textContent}`)
  }

  const format = detect_format(doc)
  const { x_scale, y_scale } = extract_axis_scales(doc, format)
  const boundaries = extract_boundaries(doc, format, x_scale, y_scale)
  const labels = extract_labels(doc, format)
  const components = format === `mpds`
    ? infer_mpds_components(doc)
    : infer_components(labels)

  if (boundaries.length === 0) {
    throw new Error(`No phase boundaries found in SVG`)
  }

  const regions = infer_regions(boundaries, labels, x_scale, y_scale)
  const curves = generate_curves(boundaries)

  // MPDS SVGs use °C for temperature
  const temp_unit = format === `mpds` ? `°C` : `K`

  return {
    meta: {
      components,
      temp_range: y_scale.domain,
      temp_unit,
      comp_unit: `fraction`,
      title: `Imported Phase Diagram`,
    },
    curves,
    regions,
  }
}

// Infer components from MPDS SVGs by finding element-like text content
// MPDS SVGs have readable element names as text (e.g., "Cu", "Si")
function infer_mpds_components(doc: Document): [string, string] {
  const elements = new Set<string>()
  for (const text_el of Array.from(doc.querySelectorAll(`text`))) {
    const content = text_el.textContent?.trim() ?? ``
    // Match single/two-letter element symbols, exclude common non-element text
    if (/^[A-Z][a-z]?$/.test(content) && content !== `L` && content !== `M`) {
      elements.add(content)
    }
  }
  const unique = [...elements]
  return [unique[0] ?? `A`, unique[1] ?? `B`]
}

// === Utility Functions ===

// Parse stroke-width from style attribute or direct attribute (returns 0 if not found)
function parse_stroke_width(el: Element): number {
  const style_match = (el.getAttribute(`style`) ?? ``).match(/stroke-width:\s*([\d.]+)/)
  if (style_match) return parseFloat(style_match[1])
  const attr = el.getAttribute(`stroke-width`)
  return attr ? parseFloat(attr) || 0 : 0
}

// Parse a float attribute from an SVG element
function parse_float_attr(el: Element, attr: string): number | null {
  const val = el.getAttribute(attr)
  if (val === null) return null
  const parsed = parseFloat(val)
  return isNaN(parsed) ? null : parsed
}

// Extract a number from XML comment nodes inside a group element
function extract_comment_number(group: Element): number | null {
  const walker = group.ownerDocument.createTreeWalker(group, NodeFilter.SHOW_COMMENT)
  let node: Comment | null
  while ((node = walker.nextNode() as Comment | null)) {
    const value = parseFloat(node.textContent?.trim() ?? ``)
    if (!isNaN(value)) return value
  }
  return null
}

// Find the first XML comment text inside or preceding a group
function find_comment_text(group: Element): string | null {
  // Check comment nodes inside the group
  const walker = group.ownerDocument.createTreeWalker(group, NodeFilter.SHOW_COMMENT)
  let node: Comment | null
  while ((node = walker.nextNode() as Comment | null)) {
    const text = node.textContent?.trim()
    if (text && text.length > 1) return text
  }

  // Check preceding sibling comments
  let sibling = group.previousSibling
  while (sibling) {
    if (sibling.nodeType === Node.COMMENT_NODE) {
      const text = sibling.textContent?.trim()
      if (text && text.length > 1) return text
    }
    if (sibling.nodeType === Node.ELEMENT_NODE) break // stop at previous element
    sibling = sibling.previousSibling
  }

  return null
}

// Clean LaTeX subscript notation: "La$_2$NiO$_4$" -> "La2NiO4"
function clean_latex(text: string): string {
  return text
    .replace(/\$_\{([^}]*)\}\$/g, `$1`) // $_{10}$ -> 10
    .replace(/\$_(\d)\$/g, `$1`) // $_2$ -> 2
    .replace(/\$/g, ``) // remove any remaining $
    .replace(/\s+/g, ` `)
    .trim()
}

// Parse SVG path data into absolute line segments [x1,y1,x2,y2]
// Handles all SVG path commands (M/L/H/V/C/S/Q/T/A/Z, both absolute and relative)
// Curves (C/S/Q/T/A) are approximated as straight lines from start to endpoint
// After M/m, implicit coordinates are treated as L/l per SVG spec
function parse_path_segments(d: string): [number, number, number, number][] {
  const segments: [number, number, number, number][] = []
  let [cursor_x, cursor_y] = [0, 0]
  let [start_x, start_y] = [0, 0]
  let last_cmd = ``

  // Numbers to skip before the endpoint x,y for each curve command
  const curve_skip: Record<string, number> = { C: 4, S: 2, Q: 2, T: 0, A: 5 }
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?[\d]*\.?[\d]+(?:[eE][-+]?\d+)?/g)
  if (!tokens) return segments

  let idx = 0
  const peek = () => tokens[idx]
  const next_num = () => parseFloat(tokens[idx++] ?? `0`)

  while (idx < tokens.length) {
    let cmd = peek() ?? ``

    if (cmd.length === 1 && /[A-Za-z]/.test(cmd)) {
      idx++
      last_cmd = cmd
    } else {
      // Implicit repeat: after M→L, after m→l, others repeat themselves
      cmd = last_cmd === `M` ? `L` : last_cmd === `m` ? `l` : last_cmd
    }

    if (cmd === `M` || cmd === `m`) {
      const next_x = next_num()
      const next_y = next_num()
      cursor_x = cmd === `M` ? next_x : cursor_x + next_x
      cursor_y = cmd === `M` ? next_y : cursor_y + next_y
      start_x = cursor_x
      start_y = cursor_y
      last_cmd = cmd
    } else if (cmd === `L` || cmd === `l`) {
      const next_x = next_num()
      const next_y = next_num()
      const x2 = cmd === `L` ? next_x : cursor_x + next_x
      const y2 = cmd === `L` ? next_y : cursor_y + next_y
      segments.push([cursor_x, cursor_y, x2, y2])
      cursor_x = x2
      cursor_y = y2
    } else if (cmd === `H` || cmd === `h`) {
      const next_x = next_num()
      const x2 = cmd === `H` ? next_x : cursor_x + next_x
      segments.push([cursor_x, cursor_y, x2, cursor_y])
      cursor_x = x2
    } else if (cmd === `V` || cmd === `v`) {
      const next_y = next_num()
      const y2 = cmd === `V` ? next_y : cursor_y + next_y
      segments.push([cursor_x, cursor_y, cursor_x, y2])
      cursor_y = y2
    } else if (cmd === `Z` || cmd === `z`) {
      if (cursor_x !== start_x || cursor_y !== start_y) {
        segments.push([cursor_x, cursor_y, start_x, start_y])
      }
      cursor_x = start_x
      cursor_y = start_y
    } else {
      // Curve commands: skip control/arc params, use endpoint as straight line
      // C=4 skip, S=2, Q=2, T=0, A=5 (numbers before the final x,y endpoint)
      const upper = cmd.toUpperCase()
      const skip = curve_skip[upper]
      if (skip !== undefined) {
        for (let _skip = 0; _skip < skip; _skip++) next_num()
        const end_x = next_num()
        const end_y = next_num()
        const x2 = cmd === upper ? end_x : cursor_x + end_x
        const y2 = cmd === upper ? end_y : cursor_y + end_y
        segments.push([cursor_x, cursor_y, x2, y2])
        cursor_x = x2
        cursor_y = y2
      } else {
        idx++ // skip unknown tokens
      }
    }
  }
  return segments
}

// Parse a simple 2-point line path (M...L only). Returns null for multi-segment paths
// to enforce the single-line contract expected by boundary extraction.
function parse_ml_path(
  d: string,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const segments = parse_path_segments(d)
  if (segments.length !== 1) return null
  const [x1, y1, x2, y2] = segments[0]
  return { x1, y1, x2, y2 }
}

// Parse translate(x, y) or translate(x) from a transform attribute
// Single-arg translate uses implicit y=0 per SVG spec
function parse_translate(el: Element | null): [number, number] | null {
  const match = (el?.getAttribute(`transform`) ?? ``).match(
    /translate\(\s*([\d.eE+-]+)(?:\s*[,\s]\s*([\d.eE+-]+))?\s*\)/,
  )
  if (!match) return null
  return [parseFloat(match[1]), match[2] ? parseFloat(match[2]) : 0]
}

// Get translate X or Y from a group's transform attribute
function get_group_translate(el: Element | null, axis: `x` | `y`): number {
  const coords = parse_translate(el)
  return coords ? coords[axis === `x` ? 0 : 1] : 0
}

// Collect unique sorted values from an array (with epsilon deduplication)
function collect_unique_sorted(values: number[]): number[] {
  if (values.length === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  const unique: number[] = [sorted[0]]
  for (let idx = 1; idx < sorted.length; idx++) {
    if (Math.abs(sorted[idx] - unique[unique.length - 1]) > 1e-4) {
      unique.push(sorted[idx])
    }
  }
  return unique
}

// Find the index of a coordinate in a sorted array (with epsilon tolerance)
function find_coord_index(coords: number[], value: number): number {
  for (let idx = 0; idx < coords.length; idx++) {
    if (Math.abs(coords[idx] - value) < 1e-4) return idx
  }
  return -1
}

// Find which cell interval a value falls into
function find_cell_index(coords: number[], value: number): number {
  for (let idx = 0; idx < coords.length - 1; idx++) {
    if (value >= coords[idx] - 1e-4 && value <= coords[idx + 1] + 1e-4) {
      return idx
    }
  }
  return -1
}
