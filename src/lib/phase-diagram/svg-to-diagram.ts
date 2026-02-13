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

// Round to 6 decimal places (microsecond precision for compositions/temperatures)
const round = (val: number): number => Math.round(val * 1e6) / 1e6

// === Types ===

type SvgFormat = `matplotlib` | `simple`

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

// Detect whether the SVG is matplotlib (glyph-based) or simple (plain text/line)
function detect_format(doc: Document): SvgFormat {
  // Matplotlib SVGs have xtick/ytick group IDs
  if (
    doc.querySelector(`[id^="xtick_"]`) || doc.querySelector(`[id^="ytick_"]`)
  ) {
    return `matplotlib`
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
  // Process xtick groups
  for (const group of Array.from(doc.querySelectorAll(`[id^="xtick_"]`))) {
    const value = extract_comment_number(group)
    const use_el = group.querySelector(`use`)
    if (value !== null && use_el) {
      const px = parse_float_attr(use_el, `x`)
      if (px !== null) x_ticks.push({ px, value })
    }
  }

  // Process ytick groups
  for (const group of Array.from(doc.querySelectorAll(`[id^="ytick_"]`))) {
    const value = extract_comment_number(group)
    const use_el = group.querySelector(`use`)
    if (value !== null && use_el) {
      const px = parse_float_attr(use_el, `y`)
      if (px !== null) y_ticks.push({ px, value })
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

// Build a linear scale from tick data points
function build_scale(ticks: { px: number; value: number }[]): LinearScale {
  ticks.sort((a, b) => a.value - b.value)
  const first = ticks[0]
  const last = ticks[ticks.length - 1]

  const px_per_unit = (last.px - first.px) / (last.value - first.value)

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

  if (format === `matplotlib`) {
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
      const style = path_el.getAttribute(`style`) ?? ``
      const stroke_width_match = style.match(/stroke-width:\s*([\d.]+)/)
      const stroke_width = stroke_width_match ? parseFloat(stroke_width_match[1]) : 1

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
function extract_labels(
  doc: Document,
  format: SvgFormat,
): Label[] {
  const labels: Label[] = []

  if (format === `matplotlib`) {
    extract_matplotlib_labels(doc, labels)
  } else {
    extract_simple_labels(doc, labels)
  }

  return labels
}

// Extract labels from matplotlib SVG using XML comments
function extract_matplotlib_labels(doc: Document, labels: Label[]): void {
  // Find text groups with comments containing phase names (contain "$" for subscripts)
  for (const group of Array.from(doc.querySelectorAll(`[id^="text_"]`))) {
    // Look for comment nodes preceding or inside the group
    const comment = find_comment_text(group)
    if (!comment || !comment.includes(`+`)) continue // skip axis labels (no "+")

    // Clean LaTeX: "La$_2$NiO$_4$ + NiO" -> "La2NiO4 + NiO"
    const text = clean_latex(comment.trim())

    // Get position from transform="translate(x, y)"
    const inner_g = group.querySelector(`g[transform]`)
    const transform = inner_g?.getAttribute(`transform`) ??
      group.getAttribute(`transform`) ?? ``
    const translate_match = transform.match(
      /translate\(\s*([\d.-]+)\s*[,\s]\s*([\d.-]+)/,
    )
    if (!translate_match) continue

    labels.push({
      text,
      px_x: parseFloat(translate_match[1]),
      px_y: parseFloat(translate_match[2]),
    })
  }
}

// Extract labels from simple SVG using class="label-main"
function extract_simple_labels(doc: Document, labels: Label[]): void {
  for (const text_el of Array.from(doc.querySelectorAll(`.label-main`))) {
    // Get plain text content (strips tspan tags)
    const text = (text_el.textContent ?? ``).replace(/\s+/g, ` `).trim()
    if (!text.includes(`+`)) continue // skip non-phase labels

    // Get position - either x/y attributes or transform
    let px_x = parse_float_attr(text_el, `x`)
    let px_y = parse_float_attr(text_el, `y`)

    // Check for transform="translate(x, y)"
    const transform = text_el.getAttribute(`transform`) ?? ``
    const translate_match = transform.match(
      /translate\(\s*([\d.-]+)\s*[,\s]\s*([\d.-]+)/,
    )
    if (translate_match) {
      px_x = parseFloat(translate_match[1])
      px_y = parseFloat(translate_match[2])
    }

    if (px_x !== null && px_y !== null) {
      labels.push({ text, px_x, px_y })
    }
  }
}

// === Component Inference ===

// Infer binary components from region labels
function infer_components(labels: Label[]): [string, string] {
  // Split each label into constituent phases
  const labeled_phases: { phases: string[]; px_x: number }[] = labels.map((
    label,
  ) => ({
    phases: label.text.split(/\s*\+\s*/).map((p) => p.trim()),
    px_x: label.px_x,
  }))

  // Sort by x position to find leftmost and rightmost
  labeled_phases.sort((a, b) => a.px_x - b.px_x)

  // Component A: the unique phase in the leftmost region that doesn't appear in the next region
  // Component B: the unique phase in the rightmost region that doesn't appear in the previous region
  let comp_a = `A`
  let comp_b = `B`

  if (labeled_phases.length >= 2) {
    const leftmost = labeled_phases[0].phases
    const rightmost = labeled_phases[labeled_phases.length - 1].phases

    // Component A: appears only in left-side regions, candidate is the one
    // in the leftmost label that has the smallest x composition
    // For "La2NiO4 + La2O3", La2O3 is the pure A endpoint
    if (leftmost.length === 2) {
      // The phase that appears less frequently on the right side is likely the pure endpoint
      const right_phases = labeled_phases.slice(-3).flatMap((lp) => lp.phases)
      comp_a = leftmost.find((p) => !right_phases.includes(p)) ?? leftmost[1] ??
        `A`
    }

    if (rightmost.length === 2) {
      const left_phases = labeled_phases.slice(0, 3).flatMap((lp) => lp.phases)
      comp_b = rightmost.find((p) => !left_phases.includes(p)) ??
        rightmost[1] ?? `B`
    }
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
      flood_fill(
        cell_ids,
        h_walls,
        v_walls,
        col,
        row,
        n_cols,
        n_rows,
        next_region_id,
      )
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
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, `_`).replace(
      /^_|_$/g,
      ``,
    )

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
function generate_curves(
  boundaries: Boundary[],
): Record<string, DiagramPoint[]> {
  const curves: Record<string, DiagramPoint[]> = {}
  let vert_idx = 0
  let horiz_idx = 0

  for (const boundary of boundaries) {
    if (boundary.orientation === `vertical`) {
      const name = `vertical_${vert_idx++}`
      curves[name] = [
        [round(boundary.x1), round(boundary.y1)],
        [round(boundary.x1), round(boundary.y2)],
      ]
    } else {
      const name = `horizontal_${horiz_idx++}`
      curves[name] = [
        [round(boundary.x1), round(boundary.y1)],
        [round(boundary.x2), round(boundary.y1)],
      ]
    }
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
  const components = infer_components(labels)

  if (boundaries.length === 0) {
    throw new Error(`No phase boundaries found in SVG`)
  }

  const regions = infer_regions(boundaries, labels, x_scale, y_scale)
  const curves = generate_curves(boundaries)

  return {
    meta: {
      components,
      temp_range: y_scale.domain,
      temp_unit: `K`,
      comp_unit: `fraction`,
      title: `Imported Phase Diagram`,
    },
    curves,
    regions,
  }
}

// === Utility Functions ===

// Parse a float attribute from an SVG element
function parse_float_attr(el: Element, attr: string): number | null {
  const val = el.getAttribute(attr)
  if (val === null) return null
  const parsed = parseFloat(val)
  return isNaN(parsed) ? null : parsed
}

// Extract a number from XML comment nodes inside a group element
function extract_comment_number(group: Element): number | null {
  const walker = document.createTreeWalker(group, NodeFilter.SHOW_COMMENT)
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
  const walker = document.createTreeWalker(group, NodeFilter.SHOW_COMMENT)
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

// Parse "M x1 y1 L x2 y2" path data (simple 2-point lines only)
function parse_ml_path(
  d: string,
): { x1: number; y1: number; x2: number; y2: number } | null {
  // Normalize whitespace and parse M/L commands
  const cleaned = d.replace(/\s+/g, ` `).trim()
  const match = cleaned.match(
    /M\s*([\d.-]+)\s*[,\s]\s*([\d.-]+)\s*L\s*([\d.-]+)\s*[,\s]\s*([\d.-]+)/,
  )
  if (!match) return null

  return {
    x1: parseFloat(match[1]),
    y1: parseFloat(match[2]),
    x2: parseFloat(match[3]),
    y2: parseFloat(match[4]),
  }
}

// Get translate X or Y from a group's transform attribute
function get_group_translate(el: Element | null, axis: `x` | `y`): number {
  if (!el) return 0
  const transform = el.getAttribute(`transform`) ?? ``
  const match = transform.match(/translate\(\s*([\d.-]+)\s*[,\s]\s*([\d.-]+)/)
  if (!match) return 0
  return parseFloat(match[axis === `x` ? 1 : 2])
}

// Collect unique sorted values from an array (with epsilon deduplication)
function collect_unique_sorted(values: number[]): number[] {
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
