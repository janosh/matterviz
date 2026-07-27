// Desktop hosts (Hive) stream a `.traj` frame by frame: the backend reads one
// frame's byte range off disk and the frontend decodes that slice alone. These
// tests pin the two things that makes possible — that a frame's byte span is
// self-contained, and that decoding the span yields exactly the frame the
// whole-file parser produces.
import type { Vec3 } from '$lib/math'
import type { TrajectoryFrame } from '$lib/trajectory'
import {
  decode_ase_frame,
  parse_ase_trajectory,
  read_ase_header,
} from '$lib/trajectory/parse/ase'
import { describe, expect, test } from 'vitest'
import { read_binary_test_file } from '../setup'

const FIXTURE = `ase-LiMnO2-chgnet-relax.traj`

// Bytes the ULM header occupies before the first frame's payload data. Mirrors
// ULM_HEADER_BYTES in Hive's src-tauri/src/trajectory.rs.
const ULM_HEADER_BYTES = 48

interface FrameSpan {
  byte_offset: number
  size: number
  header_offset: number
}

// The same span algorithm Hive's Rust indexer runs. ASE writes a frame's ndarray
// payloads *before* the JSON header that points at them, so a frame occupies
// `[end of the previous header, end of this header)` — not the range between
// consecutive entries of the offsets table, which would cut the payloads off.
const index_frame_spans = (buffer: ArrayBuffer): FrameSpan[] => {
  const view = new DataView(buffer)
  const { n_items, offsets_pos } = read_ase_header(view)
  const spans: FrameSpan[] = []
  let span_start = ULM_HEADER_BYTES
  for (let frame_idx = 0; frame_idx < n_items; frame_idx++) {
    const header_offset = Number(view.getBigInt64(offsets_pos + frame_idx * 8, true))
    const json_length = Number(view.getBigInt64(header_offset, true))
    const json_end = header_offset + 8 + json_length
    spans.push({ byte_offset: span_start, size: json_end - span_start, header_offset })
    span_start = json_end
  }
  return spans
}

const positions_of = (frame: TrajectoryFrame): Vec3[] =>
  frame.structure.sites.map((site) => site.xyz)

describe(`ASE frame slicing`, () => {
  const buffer = read_binary_test_file(FIXTURE)
  const spans = index_frame_spans(buffer)

  test(`frame spans tile the data region and contain their own header`, () => {
    expect(spans).toHaveLength(2)
    // Golden values for this fixture, cross-checked against the Rust indexer's
    // assertions in Hive's src-tauri/src/tests.rs.
    expect(spans).toEqual([
      { byte_offset: 48, size: 1490, header_offset: 760 },
      { byte_offset: 1538, size: 1340, header_offset: 2184 },
    ])
    let expected_start = ULM_HEADER_BYTES
    for (const span of spans) {
      expect(span.byte_offset).toBe(expected_start)
      // The header sits inside the span but past its start, because the payloads
      // it references were written first.
      expect(span.header_offset).toBeGreaterThan(span.byte_offset)
      expect(span.header_offset).toBeLessThan(span.byte_offset + span.size)
      expected_start = span.byte_offset + span.size
    }
  })

  test(`a frame decoded from its slice equals the whole-file parse exactly`, () => {
    const whole_file = parse_ase_trajectory(buffer, FIXTURE)
    expect(whole_file.frames).toHaveLength(spans.length)

    let cached_numbers: number[] | undefined
    let max_abs_diff = 0
    for (const [frame_idx, span] of spans.entries()) {
      const slice = buffer.slice(span.byte_offset, span.byte_offset + span.size)
      const { frame, numbers } = decode_ase_frame(
        new DataView(slice),
        slice,
        span.header_offset,
        frame_idx,
        { base_offset: span.byte_offset, fallback_numbers: cached_numbers },
      )
      cached_numbers = numbers

      const expected = whole_file.frames[frame_idx]
      const streamed_positions = positions_of(frame)
      const expected_positions = positions_of(expected)
      expect(streamed_positions).toHaveLength(expected_positions.length)
      for (const [site_idx, expected_xyz] of expected_positions.entries()) {
        for (const [axis_idx, expected_value] of expected_xyz.entries()) {
          const streamed_value = streamed_positions[site_idx][axis_idx]
          max_abs_diff = Math.max(max_abs_diff, Math.abs(streamed_value - expected_value))
        }
      }
      // Same float64 bytes read through a rebased offset, so the frames must be
      // bit-identical, not merely close.
      expect(frame).toEqual(expected)
    }
    // Reading the same IEEE-754 doubles from a slice cannot perturb them.
    expect(max_abs_diff).toBe(0)
  })

  test(`the atomic numbers cached from frame 0 carry into later frames`, () => {
    // ASE writes `numbers` only into the first frame, so a slice of frame 1 has
    // no elements of its own and must be handed frame 0's.
    const [first_span, second_span] = spans
    const second_slice = buffer.slice(
      second_span.byte_offset,
      second_span.byte_offset + second_span.size,
    )
    expect(() =>
      decode_ase_frame(
        new DataView(second_slice),
        second_slice,
        second_span.header_offset,
        1,
        { base_offset: second_span.byte_offset },
      ),
    ).toThrow(/missing numbers/)

    const first_slice = buffer.slice(
      first_span.byte_offset,
      first_span.byte_offset + first_span.size,
    )
    const { numbers } = decode_ase_frame(
      new DataView(first_slice),
      first_slice,
      first_span.header_offset,
      0,
      { base_offset: first_span.byte_offset },
    )
    const { frame } = decode_ase_frame(
      new DataView(second_slice),
      second_slice,
      second_span.header_offset,
      1,
      { base_offset: second_span.byte_offset, fallback_numbers: numbers },
    )
    expect(frame.structure.sites.map((site) => site.species[0].element)).toEqual(
      parse_ase_trajectory(buffer, FIXTURE).frames[1].structure.sites.map(
        (site) => site.species[0].element,
      ),
    )
  })

  // Mutation check on base_offset: dropping it leaves the ULM absolute offsets
  // pointing at the wrong place, which must fail loudly rather than silently
  // returning shifted coordinates. Only frame 1 trips the explicit bounds check —
  // its header offset (2184) is past the end of its 1340-byte slice. Frame 0's
  // (760) still lands inside its 1490-byte slice, so what fails instead is the
  // garbage read there as a JSON length, with a message the engine picks.
  test.each([
    [0, undefined],
    [1, /outside the \d+ byte slice/],
  ])(`frame %i cannot be decoded from its slice without the origin`, (frame_idx, message) => {
    const span = spans[frame_idx]
    const slice = buffer.slice(span.byte_offset, span.byte_offset + span.size)
    expect(() =>
      decode_ase_frame(new DataView(slice), slice, span.header_offset, frame_idx, {}),
    ).toThrow(message)
  })
})
