import TrajectoryLines from '$lib/structure/TrajectoryLines.svelte'
import type { TrajectoryLinesStats } from '$lib/structure/trajectory-lines'
import { TrajectoryTrail } from '$lib/structure/trajectory-lines'
import { mount_scene } from '../scene/mount'
import { make_position_stream } from '../test-fixtures'
import { flushSync } from 'svelte'
import { BufferAttribute, LineSegments } from 'three/webgpu'
import { expect, onTestFinished, test } from 'vitest'

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

test(`playback moves the window in place, re-uploading only the window ends and offsets`, () => {
  const props = $state({
    end_frame: 10,
    anchor_positions: anchors_at(10),
    frame_stride: 3,
  })
  const bound: { stats: TrajectoryLinesStats | null } = { stats: null }
  const { scene, unmount_scene } = mount_scene((anchor) =>
    TrajectoryLines(anchor, {
      position_stream: stream,
      trail_frames: 5,
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
  onTestFinished(unmount_scene)
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
  let disposed = false
  geometry.addEventListener(`dispose`, () => (disposed = true))
  props.frame_stride = 2
  flushSync()
  expect(disposed).toBe(true)
  expect(lines()).toHaveLength(1)
  expect(lines()[0].geometry).not.toBe(geometry)
  expect(bound.stats?.frame_idxs).toEqual([12, 14, 16])
})

test(`unmounting clears the bound stats and disposes the buffers`, async () => {
  const bound: { stats: TrajectoryLinesStats | null } = { stats: null }
  const { scene, unmount_scene } = mount_scene((anchor) =>
    TrajectoryLines(anchor, {
      position_stream: stream,
      get build_result() {
        return bound.stats
      },
      set build_result(value) {
        bound.stats = value
      },
    }),
  )
  flushSync()
  expect(bound.stats?.segment_count).toBe(3 * 29)
  let line: LineSegments | undefined
  scene.traverse((obj) => {
    if (obj instanceof LineSegments) line = obj
  })
  let disposed = false
  line?.geometry.addEventListener(`dispose`, () => (disposed = true))
  await unmount_scene()
  expect(bound.stats).toBeNull()
  expect(disposed).toBe(true)
})
