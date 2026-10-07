import TrajectoryLines from '#lib/structure/TrajectoryLines.svelte'
import type { TrajectoryLinesStats } from '#lib/structure/trajectory-lines.js'
import { TrajectoryTrail } from '#lib/structure/trajectory-lines.js'
import { mount_scene } from '../scene/mount'
import { make_position_stream } from '../test-fixtures'
import { flushSync } from 'svelte'
import type { BufferGeometry } from 'three/webgpu'
import { BufferAttribute, LineSegments } from 'three/webgpu'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { expect, test, vi } from 'vitest'

// Three atoms on straight lines through a 10 Å cell, never wrapping
const stream = make_position_stream(
  Array.from({ length: 30 }, (_, frame_idx) => [
    [0.1 * frame_idx, 1, 1],
    [2, 0.2 * frame_idx, 2],
    [3, 3, 0.3 * frame_idx],
  ]),
  [`Li`, `O`, `Li`],
)
// Displayed positions nudged off the stream so the anchor translation is not zero
const anchors_at = (frame_idx: number) =>
  Float64Array.from(
    stream.positions.subarray(frame_idx * 9, (frame_idx + 1) * 9),
    (coord) => coord + 0.5,
  )

test(`playback moves the window in place, re-uploading only the window ends and offsets`, async () => {
  const props = $state({
    end_frame: 10,
    anchor_positions: anchors_at(10),
    frame_stride: 3,
    trail_frames: 5,
  })
  const bound: { stats: TrajectoryLinesStats | null } = { stats: null }
  const { scene, unmount_scene } = mount_scene((anchor) =>
    TrajectoryLines(anchor, {
      position_stream: stream,
      get trail_frames() {
        return props.trail_frames
      },
      get frame_stride() {
        return props.frame_stride
      },
      get end_frame() {
        return props.end_frame
      },
      get anchor_positions() {
        return props.anchor_positions
      },
      get build_result() {
        return bound.stats
      },
      set build_result(value) {
        bound.stats = value
      },
    }),
  )
  flushSync()
  const lines = () => {
    const found: LineSegments[] = []
    scene.traverse((obj) => obj instanceof LineSegments && found.push(obj))
    return found
  }
  const [line] = lines()
  const { geometry } = line
  const position = geometry.getAttribute(`position`)
  const { index } = geometry
  if (!(position instanceof BufferAttribute) || !index)
    throw new Error(`trail buffers missing`)

  for (const end_frame of [11, 12, 16]) {
    props.end_frame = end_frame
    props.anchor_positions = anchors_at(end_frame)
    flushSync()
    // The same object, geometry and buffers: nothing reallocated or uploaded in full
    expect(lines()).toEqual([line])
    expect(line.geometry).toBe(geometry)
    expect(geometry.getAttribute(`position`)).toBe(position)
    expect(geometry.index).toBe(index)

    const trail = new TrajectoryTrail(stream, { frame_stride: 3 })
    const expected = trail.update({
      end_frame,
      trail_frames: 5,
      anchor_positions: anchors_at(end_frame),
    })
    expect(bound.stats).toEqual(expected.stats)
    // Grid segments and off-grid ends are the two index ranges drawn, each only if non-empty
    const ranges = [
      [expected.grid_start, expected.grid_count],
      [trail.ends_start, expected.ends_count],
    ].filter(([, count]) => count > 0)
    expect(geometry.groups).toEqual(
      ranges.map(([start, count]) => ({ start, count, materialIndex: 0 })),
    )
    // Only the two window-end vertex rows and the ends block are re-sent
    expect(position.updateRanges).toEqual([{ start: trail.n_grid * 9, count: 18 }])
    expect(index.updateRanges).toEqual([
      { start: trail.ends_start, count: expected.ends_count },
    ])
    // Blending sorts on the drawn heads, which sit on the anchors
    const anchors = anchors_at(end_frame)
    const box_center = [0, 1, 2].map((axis) => {
      const coords = [anchors[axis], anchors[3 + axis], anchors[6 + axis]]
      return (Math.min(...coords) + Math.max(...coords)) / 2
    })
    expect(geometry.boundingSphere?.center.toArray()).toEqual(box_center)
  }

  // A polyline option rebuilds the buffers and disposes the old ones
  const disposed: BufferGeometry[] = []
  const on_dispose = ({ target }: { target: BufferGeometry }) => disposed.push(target)
  geometry.addEventListener(`dispose`, on_dispose)
  props.frame_stride = 2
  flushSync()
  const [rebuilt] = lines()
  expect(lines()).toEqual([rebuilt])
  expect(disposed).toEqual([geometry])
  expect(bound.stats?.frame_idxs).toEqual([12, 14, 16])
  // The slider's 0 end stop draws the whole run: frames 0, 2, …, 16 of all three atoms
  props.trail_frames = 0
  flushSync()
  expect(bound.stats?.segment_count).toBe(3 * 8)
  // Unmounting clears the bound stats and disposes the buffers
  rebuilt.geometry.addEventListener(`dispose`, on_dispose)
  await unmount_scene()
  expect(bound.stats).toBeNull()
  expect(disposed).toEqual([geometry, rebuilt.geometry])
})

// Emphasized trails draw as fat lines instead of native ones: one opaque LineSegments2 over the
// atoms holding the window's segments (an instance per segment). It is rewritten in place for
// a new stream and disposed when emphasis turns off or the layer unmounts.
test(`emphasis draws the window's segments as fat lines over the atoms`, async () => {
  const props = $state({ emphasis: true, position_stream: stream })
  const { scene, unmount_scene } = mount_scene((anchor) =>
    TrajectoryLines(anchor, {
      get position_stream() {
        return props.position_stream
      },
      get emphasis() {
        return props.emphasis
      },
      end_frame: 10,
    }),
  )
  flushSync()
  const drawn = () => {
    const lines: { fat: LineSegments2[]; native: LineSegments[] } = { fat: [], native: [] }
    scene.traverse((object) => {
      if (object instanceof LineSegments2) lines.fat.push(object)
      else if (object instanceof LineSegments) lines.native.push(object)
    })
    return lines
  }
  const [line] = drawn().fat
  expect(drawn()).toEqual({ fat: [line], native: [] })
  // Three atoms joined over frames 0..10: 30 segments.
  expect(line.geometry.instanceCount).toBe(30)
  expect(line.renderOrder).toBe(1)
  expect(line.material).toMatchObject({ linewidth: 4, depthTest: false, transparent: false })
  // Another stream (two atoms over frames 0..10) reuses the line.
  props.position_stream = make_position_stream(
    Array.from({ length: 11 }, (_, frame_idx) => [
      [0.1 * frame_idx, 1, 1],
      [2, 0.2 * frame_idx, 2],
    ]),
    [`Li`, `O`],
  )
  flushSync()
  expect(drawn().fat).toEqual([line])
  expect(line.geometry.instanceCount).toBe(20)
  const disposed: unknown[] = []
  const track = (target: { dispose: () => void }) =>
    vi.spyOn(target, `dispose`).mockImplementation(() => void disposed.push(target))
  track(line.geometry)
  track(line.material)
  props.emphasis = false
  flushSync()
  expect(drawn().fat).toEqual([])
  expect(drawn().native).toHaveLength(1)
  expect(disposed).toEqual([line.geometry, line.material])
  props.emphasis = true
  flushSync()
  const [again] = drawn().fat
  expect(again).not.toBe(line)
  track(again.geometry)
  track(again.material)
  await unmount_scene()
  expect(disposed.slice(2)).toEqual([again.geometry, again.material])
})
