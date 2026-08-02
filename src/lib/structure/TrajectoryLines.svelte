<!-- Per-atom trajectory trails (OVITO's "generate trajectory lines") as a scene layer.

Drop this inside a Threlte scene that renders the structure in absolute Cartesian
coordinates — StructureScene's rotation group preserves world coordinates, so trails line
up with the atoms without any extra transform.

Everything is packed into ONE indexed BufferGeometry, so the whole overlay is a single
draw call regardless of atom or frame count. Geometry maths lives in trajectory-lines.ts
as a pure function; this file only owns the GPU buffers and their disposal.

Line WIDTH is deliberately not a prop: WebGPU rasterizes every line at 1 device pixel, and
the fat-line alternative (LineSegments2, which expands each segment into an instanced quad)
costs ~18 floats per segment against the 6 used here — 180 MB of instance attributes for a
500-atom x 5000-frame run. Opacity is the visual-weight control instead. -->
<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import type { ElementSymbol } from '$lib/element'
  import { DEFAULTS } from '$lib/settings'
  import type {
    TrajectoryLineColorMode,
    TrajectoryLinesStats,
    TrajectoryLineWrapMode,
  } from '$lib/structure/trajectory-lines'
  import {
    build_trajectory_lines,
    trajectory_lines_stats,
  } from '$lib/structure/trajectory-lines'
  import type { TrajectoryPositionStream } from '$lib/trajectory'
  import { T } from '@threlte/core'
  import { BufferAttribute, BufferGeometry } from 'three/webgpu'

  let {
    position_stream = null,
    end_frame = undefined,
    trail_frames = DEFAULTS.structure.trajectory_line_trail_frames,
    frame_stride = DEFAULTS.structure.trajectory_line_frame_stride,
    elements = null,
    color_mode = DEFAULTS.structure.trajectory_line_color_mode as TrajectoryLineColorMode,
    color_scale = DEFAULTS.structure.trajectory_line_color_scale as D3InterpolateName,
    element_colors = undefined,
    wrap_mode = DEFAULTS.structure.trajectory_line_wrap_mode as TrajectoryLineWrapMode,
    opacity = DEFAULTS.structure.trajectory_line_opacity,
    build_result = $bindable(null),
  }: {
    // Whole-trajectory positions from accumulate_positions / FrameLoader.stream_positions.
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
    color_scale?: D3InterpolateName
    // Normally the scene's live `colors.element` map so trails match their spheres
    element_colors?: Partial<Record<ElementSymbol, string>>
    wrap_mode?: TrajectoryLineWrapMode
    opacity?: number
    // (output) vertex/segment counts and the longest drawn segment, for readouts and tests
    build_result?: TrajectoryLinesStats | null
  } = $props()

  let built = $derived(
    position_stream
      ? build_trajectory_lines(position_stream, {
          end_frame,
          // trail_frames is a slider in the UI, where 0 is the natural "no limit" end stop
          trail_frames: trail_frames || null,
          frame_stride,
          elements,
          color_mode,
          color_scale,
          element_colors,
          wrap_mode,
        })
      : null,
  )

  let geometry = $derived.by(() => {
    if (!built || built.segment_count === 0) return null
    const geo = new BufferGeometry()
    geo.setAttribute(`position`, new BufferAttribute(built.positions, 3))
    geo.setAttribute(`color`, new BufferAttribute(built.colors, 3))
    geo.setIndex(new BufferAttribute(built.indices, 1))
    return geo
  })

  // Cleanup captures the geometry this run created, so a rebuild frees the previous buffers
  // instead of leaking one set per playhead step
  $effect(() => {
    const current = geometry
    return () => current?.dispose()
  })

  $effect(() => {
    build_result = built && trajectory_lines_stats(built)
  })
</script>

{#if geometry}
  <!-- Trails are decoration: they must not swallow atom hover, and their bounding box
    covers the whole diffusion path, which would defeat frustum culling anyway -->
  <T.LineSegments {geometry} frustumCulled={false} raycast={() => null}>
    <T.LineBasicMaterial
      vertexColors
      transparent={opacity < 1}
      {opacity}
      depthWrite={opacity >= 1}
    />
  </T.LineSegments>
{/if}
