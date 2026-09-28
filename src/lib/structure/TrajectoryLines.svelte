<!-- Per-atom trajectory trails (OVITO's "generate trajectory lines") as a scene layer.

Drop this inside a Threlte scene that renders the structure in absolute Cartesian
coordinates — StructureScene's rotation group preserves world coordinates, so trails line
up with the atoms without any extra transform.

The whole run's polylines are uploaded ONCE per stream and options (trajectory-lines.ts lays
them out frame-major), so playback only moves a draw range, rewrites the off-grid window
ends and uploads one offset texel per atom. The shader applies those anchor offsets and the
time ramp, which depend on the window. One LineSegments, one draw call for the grid part of
the window plus one for its off-grid ends, regardless of atom or frame count.

WebGPU rasterizes lines at 1 device pixel. The fat-line alternative expands every segment
into an instanced quad and costs three times the attributes, so this layer keeps a fixed
subtle opacity instead of exposing width and opacity controls. -->
<script lang="ts">
  import type { ElementSymbol } from '$lib/element'
  import { DEFAULTS } from '$lib/settings'
  import type {
    TrajectoryLineColorMode,
    TrajectoryLinesStats,
    TrajectoryLineWrapMode,
  } from '$lib/structure/trajectory-lines'
  import {
    TIME_RAMP_SIZE,
    TRAIL_TEXEL_ROW,
    TrajectoryTrail,
    trail_color_texels,
  } from '$lib/structure/trajectory-lines'
  import type { TrajectoryPositionStream } from '$lib/trajectory'
  import { T, useThrelte } from '@threlte/core'
  import {
    positionGeometry,
    select,
    textureLoad,
    uint,
    uniform,
    uvec2,
    vertexIndex,
    vertexStage,
  } from 'three/tsl'
  import type { Node } from 'three/webgpu'
  import {
    Box3,
    BufferAttribute,
    BufferGeometry,
    DataTexture,
    FloatType,
    LineBasicNodeMaterial,
    LineSegments,
    RGBAFormat,
    Sphere,
  } from 'three/webgpu'

  let {
    position_stream = null,
    end_frame = undefined,
    trail_frames = DEFAULTS.structure.trajectory_line_trail_frames,
    frame_stride = DEFAULTS.structure.trajectory_line_frame_stride,
    elements = null,
    color_mode = DEFAULTS.structure.trajectory_line_color_mode as TrajectoryLineColorMode,
    element_colors = undefined,
    wrap_mode = DEFAULTS.structure.trajectory_line_wrap_mode as TrajectoryLineWrapMode,
    anchor_positions = null,
    build_result = $bindable(null),
  }: {
    // Whole-trajectory positions from TrajectoryRun.collect_positions.
    // Collect it ONCE per file and cache it — this component never loads frames itself.
    position_stream?: TrajectoryPositionStream | null
    // Newest collected frame the trail reaches; defaults to the last frame in the stream.
    // Drive this from the playhead to get a comet tail during playback.
    end_frame?: number
    // Collected frames the trail spans back from `end_frame`; 0 or null draws the whole run
    trail_frames?: number | null
    // Keep every Nth collected frame, on top of the stream's own frame_stride
    frame_stride?: number
    // Species to draw. null = all, [] = none.
    elements?: readonly ElementSymbol[] | null
    color_mode?: TrajectoryLineColorMode
    // Normally the viewer's element palette so trails match their spheres
    element_colors?: Partial<Record<ElementSymbol, string>>
    wrap_mode?: TrajectoryLineWrapMode
    // Displayed Cartesian positions to glue the trail heads to, one xyz per stream atom.
    // The scene wraps atoms into the cell while trails are unwrapped, so without these a
    // head can sit a whole cell from its sphere.
    anchor_positions?: Float64Array | null
    // (output) vertex/segment counts and the longest drawn segment, for readouts and tests
    build_result?: TrajectoryLinesStats | null
  } = $props()

  const { invalidate } = useThrelte()

  // === Shader ===
  // Mirrors TrajectoryTrail's layout: vertex v is atom slot v % atoms_per_row in vertex row
  // v / atoms_per_row, whose frame is on the stride grid or one of the two window-end rows.
  // All u32, so the time-ramp step is d3's floor(t * 256) exactly, not a float estimate.
  const atoms_per_row = uniform(1, `uint`)
  const grid_rows = uniform(1, `uint`)
  const grid_stride = uniform(1, `uint`)
  const window_start = uniform(0, `uint`)
  const window_end = uniform(1, `uint`)
  const time_colors = uniform(0, `uint`)
  const texel = (idx: Node<`uint`>) =>
    uvec2(idx.mod(uint(TRAIL_TEXEL_ROW)), idx.div(uint(TRAIL_TEXEL_ROW)))
  const atom_slot = vertexIndex.mod(atoms_per_row)
  const row = vertexIndex.div(atoms_per_row)
  const frame = select(
    row.lessThan(grid_rows),
    row.mul(grid_stride),
    select(row.equal(grid_rows), window_start, window_end),
  )
  // Step TIME_RAMP_SIZE (the head at t = 1) has its own texel holding d3's clamped last color
  const ramp_step = frame
    .sub(window_start)
    .mul(uint(TIME_RAMP_SIZE))
    .div(window_end.sub(window_start))
  // Color texels hold one color per atom, or the ramp in time mode
  const color_idx = select(time_colors.equal(uint(1)), ramp_step, atom_slot)
  const offset_texel = textureLoad(undefined, texel(atom_slot))
  const color_texel = textureLoad(undefined, texel(color_idx))
  const material = new LineBasicNodeMaterial({
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  })
  material.positionNode = positionGeometry.add(offset_texel.xyz)
  material.colorNode = vertexStage(color_texel.xyz)

  const data_texture = (texels: Float32Array) => {
    const texture = new DataTexture(
      texels,
      TRAIL_TEXEL_ROW,
      texels.length / 4 / TRAIL_TEXEL_ROW,
      RGBAFormat,
      FloatType,
    )
    texture.needsUpdate = true
    return texture
  }

  // === Buffers ===
  // Rebuilt only when the stream or an option that changes the polylines does
  let trail = $derived(
    position_stream
      ? new TrajectoryTrail(position_stream, { frame_stride, elements, wrap_mode })
      : null,
  )

  // GPU mirrors of one trail's arrays; later windows update them in place
  let layer = $derived.by(() => {
    if (!trail) return null
    const geometry = new BufferGeometry()
    const positions = new BufferAttribute(trail.positions, 3)
    const indices = new BufferAttribute(trail.indices, 1)
    geometry.setAttribute(`position`, positions)
    geometry.setIndex(indices)
    const line = new LineSegments(geometry, [material])
    // Trails are decoration: they must not swallow atom hover, and their bounding box
    // covers the whole diffusion path, which would defeat frustum culling anyway
    line.frustumCulled = false
    line.raycast = () => undefined
    return { line, positions, indices, offsets: data_texture(trail.offsets) }
  })

  $effect(() => {
    if (!trail || !layer) return
    const { line, offsets } = layer
    offset_texel.value = offsets
    atoms_per_row.value = Math.max(1, trail.atom_idxs.length)
    grid_rows.value = trail.n_grid
    grid_stride.value = trail.frame_stride
    return () => {
      line.geometry.dispose()
      offsets.dispose()
    }
  })

  $effect(() => {
    if (!trail) return
    const colors = data_texture(trail_color_texels(trail, color_mode, element_colors))
    color_texel.value = colors
    time_colors.value = color_mode === `time` ? 1 : 0
    invalidate()
    return () => colors.dispose()
  })

  // Blending against other translucent layers sorts on the bounding sphere: keep it on the
  // drawn heads (TrajectoryTrail.head_box), not on the untranslated stored points
  const sort_box = new Box3()

  // Re-upload only what a window rewrote: flagging the whole attribute would resend the run
  const upload = (attribute: BufferAttribute, start: number, count: number) => {
    attribute.clearUpdateRanges()
    attribute.addUpdateRange(start, count)
    attribute.needsUpdate = true
  }

  // Per playback frame: O(1) for the grid part, O(atoms) for off-grid ends and anchors
  $effect(() => {
    if (!trail || !layer) {
      build_result = null
      return
    }
    const { line, positions, indices, offsets } = layer
    const shown = trail.update({
      end_frame,
      // trail_frames is a slider in the UI, where 0 is the natural "no limit" end stop
      trail_frames: trail_frames || null,
      anchor_positions,
    })
    const { geometry } = line
    // One draw per non-empty index range: the window's grid segments and its off-grid ends
    geometry.clearGroups()
    if (shown.grid_count) geometry.addGroup(shown.grid_start, shown.grid_count)
    if (shown.ends_count) geometry.addGroup(trail.ends_start, shown.ends_count)
    const row_floats = trail.atom_idxs.length * 3
    if (shown.ends_changed) {
      upload(positions, trail.n_grid * row_floats, 2 * row_floats)
      upload(indices, trail.ends_start, shown.ends_count)
    }
    if (shown.offsets_changed) offsets.needsUpdate = true
    if (shown.head_box_changed) {
      sort_box.min.fromArray(trail.head_box.min)
      sort_box.max.fromArray(trail.head_box.max)
      geometry.boundingSphere = sort_box.getBoundingSphere(
        geometry.boundingSphere ?? new Sphere(),
      )
    }
    window_start.value = shown.start_frame
    window_end.value = shown.end_frame
    build_result = shown.stats
    invalidate()
  })

  $effect(() => () => {
    build_result = null
    material.dispose()
  })
</script>

{#if layer}
  <T is={layer.line} dispose={false} />
{/if}
