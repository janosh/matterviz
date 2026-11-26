// Desktop hosts stream a `.traj` frame by frame: the backend reads one
// frame's byte range off disk and the frontend decodes that slice alone. These
// tests pin the two things that makes possible — that a frame's byte span is
// self-contained, and that decoding the span yields exactly the frame the
// whole-file parser produces.
import type { AseFrameOptions, ByteSource } from '#lib/trajectory/parse/ase.js'
import {
  decode_ase_frame,
  open_ase_frames,
  parse_ase_trajectory,
  read_ase_header,
} from '#lib/trajectory/parse/ase.js'
import { describe, expect, test } from 'vite-plus/test'
import { read_binary_test_file } from '../test-fixtures'

const FIXTURE = `ase-LiMnO2-chgnet-relax.traj`
const no_warnings = (message: string) => expect.unreachable(message)

// Bytes the ULM header occupies before the first frame's payload data, as a native
// indexer must assume.
const ULM_HEADER_BYTES = 48

interface FrameSpan {
  byte_offset: number
  size: number
  header_offset: number
}

// The span algorithm a native frame indexer must run. ASE writes a frame's ndarray
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

describe(`ASE frame slicing`, () => {
  const buffer = read_binary_test_file(FIXTURE)
  const spans = index_frame_spans(buffer)

  // Decode one span the way a streaming host does: cut the frame's bytes out and hand
  // the decoder nothing but that slice. `options` passes through verbatim so tests can
  // withhold `base_offset` to check the bounds guard.
  const decode_span = (
    span: FrameSpan,
    frame_idx: number,
    options: AseFrameOptions & { base_offset?: number },
  ) => {
    const slice = buffer.slice(span.byte_offset, span.byte_offset + span.size)
    return decode_ase_frame(new DataView(slice), slice, span.header_offset, frame_idx, {
      ...options,
      warn: no_warnings,
    })
  }

  test(`frame spans tile the data region and contain their own header`, () => {
    // Golden values for this fixture, cross-checked against a native indexer: the spans
    // tile from the ULM header on (48 + 1490 = 1538), and each header sits inside its span
    // but past its start, because the payloads it references were written first.
    expect(spans).toEqual([
      { byte_offset: ULM_HEADER_BYTES, size: 1490, header_offset: 760 },
      { byte_offset: 1538, size: 1340, header_offset: 2184 },
    ])
  })

  test(`a frame decoded from its slice equals the whole-file parse exactly`, () => {
    const whole_file = parse_ase_trajectory(buffer, no_warnings)
    expect(whole_file.frames).toHaveLength(spans.length)

    let cached: Pick<AseFrameOptions, `fallback_numbers` | `fallback_pbc`> = {}
    for (const [frame_idx, span] of spans.entries()) {
      const { frame, numbers, pbc } = decode_span(span, frame_idx, {
        base_offset: span.byte_offset,
        ...cached,
      })
      // ASE's reader rule: frames without their own topology header take frame 0's
      if (frame_idx === 0) cached = { fallback_numbers: numbers, fallback_pbc: pbc }
      // Same float64 bytes read through a rebased offset, so the frames must be
      // bit-identical (toEqual on numbers is exact), not merely close.
      expect(frame).toEqual(whole_file.frames[frame_idx])
    }
  })

  test(`the atomic numbers and pbc cached from frame 0 carry into later frames`, () => {
    // ASE writes `numbers` and `pbc` only into the first frame, so a slice of frame 1 has
    // neither of its own and must be handed frame 0's.
    const [first_span, second_span] = spans
    const base_offset = second_span.byte_offset
    expect(() => decode_span(second_span, 1, { base_offset })).toThrow(/missing numbers/)

    const { numbers } = decode_span(first_span, 0, {
      base_offset: first_span.byte_offset,
    })
    expect(() =>
      decode_span(second_span, 1, { base_offset, fallback_numbers: numbers }),
    ).toThrow(/missing pbc/)
    // with both fallbacks it decodes exactly: see the whole-file comparison above
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
    expect(() => decode_span(spans[frame_idx], frame_idx, {})).toThrow(message)
  })

  // The VS Code host reads a .traj through a file descriptor (ase_file_source) instead of
  // holding the file: every read is a fresh copy of just the requested range, as pread gives
  test(`frames read through a ByteSource of ranged copies equal the in-memory reads`, () => {
    const reads: number[] = []
    let released = false
    const ranged: ByteSource = {
      byte_length: buffer.byteLength,
      read: (offset, length) => {
        reads.push(length)
        return new DataView(buffer.slice(offset, offset + length))
      },
      release: () => (released = true),
    }
    const from_file = open_ase_frames(ranged, no_warnings)
    const in_memory = open_ase_frames(buffer, no_warnings)
    for (let frame_idx = 0; frame_idx < in_memory.frame_count; frame_idx++) {
      expect(from_file.read(frame_idx)).toEqual(in_memory.read(frame_idx))
      expect(from_file.decode(frame_idx)).toEqual(in_memory.decode(frame_idx))
    }
    // ranged reads only: no single read spans a whole frame span, let alone the file
    expect(Math.max(...reads)).toBeLessThan(Math.min(...spans.map((span) => span.size)))
    // an analysis batch reads only its atoms' rows, not whole columns
    const batch_bytes = (count: number) => {
      reads.length = 0
      const batch = from_file.read_atoms?.({ frame_idx: 1, start: 0, count })
      expect(batch).toEqual(in_memory.read_atoms?.({ frame_idx: 1, start: 0, count }))
      return reads.reduce((sum, length) => sum + length, 0)
    }
    const n_atoms = from_file.read(1).sites.length
    expect(batch_bytes(1)).toBeLessThan(batch_bytes(n_atoms))
    from_file.release?.()
    expect(released).toBe(true)
    expect(() => from_file.read(0)).toThrow(`ASE trajectory buffer was released`)
  })
})
