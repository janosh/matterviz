// Three.js render buffers for coordination polyhedra and fat line segments. Kept apart from
// polyhedra.ts, whose detection runs three-free wherever structures are parsed or imaged.
import { display_idx } from '#lib/labels.js'
import { grow_capacity } from '#lib/math.js'
import { css_to_linear_rgb } from '#lib/scene/colors.js'
import type { InterleavedBuffer, InterleavedBufferAttribute } from 'three/webgpu'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Line2NodeMaterial,
  Sphere,
} from 'three/webgpu'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import type { Polyhedron } from './polyhedra'

// Screen-space fat line segments (polyhedra outlines, host-run trajectory trails): they stay
// pronounced when zooming out, independently of face opacity. The caller owns disposal of the
// returned geometry and material.
export function create_fat_segments(
  positions: Float32Array,
  colors: Float32Array,
): LineSegments2 {
  const geometry = new LineSegmentsGeometry().setPositions(positions).setColors(colors)
  const material = new Line2NodeMaterial({
    vertexColors: true,
    linewidth: 1,
    worldUnits: false,
  })
  const edges = new LineSegments2(geometry, material)
  edges.frustumCulled = false
  edges.raycast = () => undefined
  return edges
}

// Keep the mesh/material and GPU attributes across frames. Only growth replaces geometry;
// shrinking changes instanceCount so unused capacity never appears in the rendered lines.
export function update_fat_segments(
  edges: LineSegments2,
  positions: Float32Array,
  colors: Float32Array,
): void {
  const capacity = edges.geometry.getAttribute(`instanceStart`).count * 6
  if (positions.length > capacity) {
    const length = grow_capacity(capacity / 6, positions.length / 6) * 6
    const geometry = new LineSegmentsGeometry()
      .setPositions(new Float32Array(length))
      .setColors(new Float32Array(length))
    edges.geometry.dispose()
    edges.geometry = geometry
  }
  for (const [name, values] of [
    [`instanceStart`, positions],
    [`instanceColorStart`, colors],
  ] as const) {
    const { data } = edges.geometry.getAttribute(name) as InterleavedBufferAttribute
    overwrite(data.setUsage(DynamicDrawUsage), values)
  }
  edges.geometry.instanceCount = positions.length / 6
  set_bounds(edges.geometry, positions)
}

// Merged polyhedra faces as one geometry kept across frames: attributes are overwritten in
// place and the draw range trimmed. Returns `geometry` itself unless it is null or too small,
// in which case it is disposed and replaced by a new one with 1.5x headroom.
export function update_polyhedra_faces(
  geometry: BufferGeometry | null,
  buffers: Pick<MergedPolyhedraBuffers, `positions` | `normals` | `colors`>,
): BufferGeometry {
  const { positions, normals, colors } = buffers
  const capacity = geometry?.getAttribute(`position`).array.length ?? 0
  const grow = !geometry || positions.length > capacity
  if (grow) geometry?.dispose()
  const target = grow ? new BufferGeometry() : geometry
  const length = grow_capacity(capacity / 9, positions.length / 9) * 9
  const attributes = { position: positions, normal: normals, color: colors }
  for (const [name, values] of Object.entries(attributes)) {
    if (grow) {
      const attribute = new BufferAttribute(new Float32Array(length), 3)
      target.setAttribute(name, attribute.setUsage(DynamicDrawUsage))
    }
    overwrite(target.getAttribute(name) as BufferAttribute, values)
  }
  target.setDrawRange(0, positions.length / 3)
  set_bounds(target, positions)
  return target
}

// Overwrite the leading values of a kept buffer and upload only that range
function overwrite(buffer: BufferAttribute | InterleavedBuffer, values: Float32Array): void {
  buffer.array.set(values)
  buffer.clearUpdateRanges()
  buffer.addUpdateRange(0, values.length)
  buffer.needsUpdate = true
}

// Bounds from the drawn positions only: the stock computeBounding* walk every capacity slot,
// stale data from earlier, larger frames included. The sphere encloses the box.
function set_bounds(geometry: BufferGeometry, positions: Float32Array): void {
  geometry.boundingBox = (geometry.boundingBox ?? new Box3()).setFromArray(positions)
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(
    geometry.boundingSphere ?? new Sphere(),
  )
}

interface MergedPolyhedraBuffers {
  positions: Float32Array // 9 floats per triangle (non-indexed, flat-shaded)
  normals: Float32Array // flat per-face unit normals matching positions
  colors: Float32Array // per-vertex rgb matching positions
  edge_positions: Float32Array // 6 floats per crease edge for LineSegments
  edge_colors: Float32Array // per-endpoint rgb matching face vertex colors
  triangle_count: number
  edge_count: number
}

// === Merged render buffers ===

// How merged polyhedra are colored: one CSS color for everything, or a per-site color taken
// from each hull vertex's own site (`vertex`) or the polyhedron's center site (`center`).
// site_color must be a pure function of site_idx: it is resolved once per distinct site.
export type PolyhedraColoring =
  | { mode: `uniform`; color: string }
  | { mode: `vertex` | `center`; site_color: (site_idx: number) => string }

// Merge all polyhedra into single non-indexed position/normal/color arrays (one draw call)
// plus crease-edge segments for outlines. Edges interior to coplanar face groups
// (e.g. quad diagonals on a cube) are omitted. Normals are the flat per-face normals
// BufferGeometry.computeVertexNormals would derive from the float32 positions, bit for bit,
// so callers can upload them directly.
export function merge_polyhedra_buffers(
  polyhedra: readonly Polyhedron[],
  coloring: PolyhedraColoring,
): MergedPolyhedraBuffers {
  let [triangle_count, max_faces, max_verts] = [0, 0, 0]
  for (const { faces, vertices } of polyhedra) {
    triangle_count += faces.length
    max_faces = Math.max(max_faces, faces.length)
    max_verts = Math.max(max_verts, vertices.length)
  }
  const positions = new Float32Array(triangle_count * 9)
  const normals = new Float32Array(triangle_count * 9)
  const colors = new Float32Array(triangle_count * 9)
  // A closed triangulated surface has at most 3F/2 unique edges
  const edge_positions = new Float32Array(Math.ceil(triangle_count * 1.5) * 6)
  const edge_colors = new Float32Array(edge_positions.length)
  // Per-polyhedron scratch. Crease detection indexes each undirected hull edge (lo, hi) at
  // cell lo * n_verts + hi of edge_at (edge_idx + 1, 0 = unseen) and records per edge, in
  // first-encounter order, its cell, first adjacent face normal and whether it is hidden.
  const vert_rgb = new Float32Array(max_verts * 3)
  const edge_at = new Int32Array(max_verts * max_verts)
  const edge_cells = new Int32Array(max_faces * 3)
  const edge_normals = new Float64Array(max_faces * 9)
  const edge_hidden = new Uint8Array(max_faces * 3) // 1 = the last face on it is coplanar
  // Linear rgb per site, resolved once per distinct site
  const site_rgb = new Map<number, ArrayLike<number>>()
  const site_color = coloring.mode === `uniform` ? () => coloring.color : coloring.site_color

  let offset = 0
  let edge_offset = 0
  const skipped_sites: string[] = []
  for (const poly of polyhedra) {
    // Rewind marks, in case this polyhedron turns out not to fit the shared edge pool below
    const [poly_offset, poly_edge_offset] = [offset, edge_offset]
    const { vertices: verts, faces } = poly
    const n_verts = verts.length
    for (let v_idx = 0; v_idx < n_verts; v_idx++) {
      const site_idx =
        coloring.mode === `vertex` ? poly.vertex_site_idxs[v_idx] : poly.center_site_idx
      let rgb = site_rgb.get(site_idx)
      if (!rgb) site_rgb.set(site_idx, (rgb = css_to_linear_rgb(site_color(site_idx))))
      vert_rgb[v_idx * 3] = rgb[0]
      vert_rgb[v_idx * 3 + 1] = rgb[1]
      vert_rgb[v_idx * 3 + 2] = rgb[2]
    }

    edge_at.fill(0, 0, n_verts * n_verts)
    let n_poly_edges = 0
    for (const face of faces) {
      // Indexed reads, not destructuring: this loop runs once per rendered triangle
      const vert_a = verts[face[0]]
      const vert_b = verts[face[1]]
      const vert_c = verts[face[2]]
      // Unit face normal (float64, unrounded input) for crease detection
      const side_1_x = vert_b[0] - vert_a[0]
      const side_1_y = vert_b[1] - vert_a[1]
      const side_1_z = vert_b[2] - vert_a[2]
      const side_2_x = vert_c[0] - vert_a[0]
      const side_2_y = vert_c[1] - vert_a[1]
      const side_2_z = vert_c[2] - vert_a[2]
      let normal_x = side_1_y * side_2_z - side_1_z * side_2_y
      let normal_y = side_1_z * side_2_x - side_1_x * side_2_z
      let normal_z = side_1_x * side_2_y - side_1_y * side_2_x
      const len = Math.hypot(normal_x, normal_y, normal_z)
      if (len > 0) {
        normal_x /= len
        normal_y /= len
        normal_z /= len
      }

      // Render normal replicating computeVertexNormals on the stored float32 positions:
      // (c - b) x (a - b), rounded to float32, then Vector3.normalize (length || 1) in float32
      const b_x = Math.fround(vert_b[0])
      const b_y = Math.fround(vert_b[1])
      const b_z = Math.fround(vert_b[2])
      const cb_x = Math.fround(vert_c[0]) - b_x
      const cb_y = Math.fround(vert_c[1]) - b_y
      const cb_z = Math.fround(vert_c[2]) - b_z
      const ab_x = Math.fround(vert_a[0]) - b_x
      const ab_y = Math.fround(vert_a[1]) - b_y
      const ab_z = Math.fround(vert_a[2]) - b_z
      const cross_x = Math.fround(cb_y * ab_z - cb_z * ab_y)
      const cross_y = Math.fround(cb_z * ab_x - cb_x * ab_z)
      const cross_z = Math.fround(cb_x * ab_y - cb_y * ab_x)
      const inv_len =
        // oxlint-disable-next-line eslint-plugin-unicorn/prefer-modern-math-apis -- matches Vector3.length bit for bit
        1 / (Math.sqrt(cross_x * cross_x + cross_y * cross_y + cross_z * cross_z) || 1)
      for (let corner = 0; corner < 3; corner++) {
        const vert = verts[face[corner]]
        const rgb = face[corner] * 3
        positions[offset] = vert[0]
        positions[offset + 1] = vert[1]
        positions[offset + 2] = vert[2]
        colors[offset] = vert_rgb[rgb]
        colors[offset + 1] = vert_rgb[rgb + 1]
        colors[offset + 2] = vert_rgb[rgb + 2]
        normals[offset] = cross_x * inv_len
        normals[offset + 1] = cross_y * inv_len
        normals[offset + 2] = cross_z * inv_len
        offset += 3
      }

      for (let side = 0; side < 3; side++) {
        const from = face[side]
        const target = face[(side + 1) % 3]
        const cell = from < target ? from * n_verts + target : target * n_verts + from
        let edge_idx = edge_at[cell] - 1
        if (edge_idx >= 0) {
          const dot =
            normal_x * edge_normals[edge_idx * 3] +
            normal_y * edge_normals[edge_idx * 3 + 1] +
            normal_z * edge_normals[edge_idx * 3 + 2]
          // the last face to reach an edge decides whether it is hidden
          edge_hidden[edge_idx] = dot < 1 - 1e-3 ? 0 : 1 // coplanar tolerance
        } else {
          edge_idx = n_poly_edges++
          edge_at[cell] = edge_idx + 1
          edge_cells[edge_idx] = cell
          edge_hidden[edge_idx] = 0
          edge_normals[edge_idx * 3] = normal_x
          edge_normals[edge_idx * 3 + 1] = normal_y
          edge_normals[edge_idx * 3 + 2] = normal_z
        }
      }
    }

    // An edge is drawn unless both adjacent faces are coplanar (quad diagonal). Float32Array
    // drops out-of-range writes silently, so a polyhedron whose outline overflows the shared
    // 3F/2 pool is rewound whole, triangles included, else the buffers would gap.
    for (let edge_idx = 0; edge_idx < n_poly_edges; edge_idx++) {
      if (edge_hidden[edge_idx]) continue
      const cell = edge_cells[edge_idx]
      for (let end = 0; end < 2; end++) {
        const v_idx = end ? cell % n_verts : Math.floor(cell / n_verts)
        const vert = verts[v_idx]
        for (let axis = 0; axis < 3; axis++) {
          edge_positions[edge_offset + axis] = vert[axis]
          edge_colors[edge_offset + axis] = vert_rgb[v_idx * 3 + axis]
        }
        edge_offset += 3
      }
    }
    if (edge_offset > edge_positions.length) {
      skipped_sites.push(`site ${display_idx(poly.center_site_idx)} (${poly.center_element})`)
      offset = poly_offset
      edge_offset = poly_edge_offset
    }
  }

  // one unclosed hull exhausts the shared pool for every polyhedron behind it: one tally, not
  // one warning per victim
  if (skipped_sites.length > 0) {
    console.warn(
      `Edge buffer exhausted (${edge_positions.length / 6} edges): dropped ` +
        `polyhedra at ${skipped_sites.join(`, `)}`,
    )
  }
  // Trim only if a polyhedron was dropped: slice copies the whole buffer. Edge outputs are
  // views, not copies, since the pool is almost always larger than the drawn edge count.
  const dropped = offset < positions.length
  return {
    positions: dropped ? positions.slice(0, offset) : positions,
    normals: dropped ? normals.slice(0, offset) : normals,
    colors: dropped ? colors.slice(0, offset) : colors,
    edge_positions: edge_positions.subarray(0, edge_offset),
    edge_colors: edge_colors.subarray(0, edge_offset),
    triangle_count: offset / 9,
    edge_count: edge_offset / 6,
  }
}
