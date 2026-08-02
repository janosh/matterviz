// Streaming trajectory loader tests - clever testing without large files
import { trajectory_property_config } from '$lib/labels'
import { DEFAULTS } from '$lib/settings'
import { FRAME_LOAD_DEBOUNCE_MS, type ParseProgress } from '$lib/trajectory'
import {
  LARGE_FILE_THRESHOLD,
  MAX_BIN_FILE_SIZE,
  MAX_TEXT_FILE_SIZE,
  parse_trajectory_async,
  TrajFrameReader,
} from '$lib/trajectory/parse'
import { generate_streaming_plot_series } from '$lib/trajectory/plotting'
import { flushSync, mount, tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import TrajectoryRaceHarness from './TrajectoryRaceHarness.svelte'

it(`large-file fallback thresholds stay in sync with the settings schema`, () => {
  // Plain component usage (no loading_options) and settings-driven contexts (VSCode
  // extension) must agree on when large-file/indexed loading kicks in
  expect(MAX_BIN_FILE_SIZE).toBe(DEFAULTS.trajectory.bin_file_threshold)
  expect(MAX_TEXT_FILE_SIZE).toBe(DEFAULTS.trajectory.text_file_threshold)
})

describe(`Trajectory Streaming`, () => {
  // Helper to create synthetic multi-frame XYZ data
  const create_synthetic_xyz = (num_frames: number, atoms_per_frame = 3): string => {
    const frames = []
    for (let frame_idx = 0; frame_idx < num_frames; frame_idx++) {
      const lines = [
        `${atoms_per_frame}`,
        `energy=${-10 - frame_idx * 0.1} volume=${100 + frame_idx} frame=${frame_idx}`,
      ]
      for (let atom_idx = 0; atom_idx < atoms_per_frame; atom_idx++) {
        lines.push(`H ${atom_idx * 0.1} ${frame_idx * 0.1} ${(frame_idx + atom_idx) * 0.05}`)
      }
      frames.push(lines.join(`\n`))
    }
    return frames.join(`\n`)
  }

  // Distinct per (frame, atom) so a channel written to the wrong flat offset shows up
  const charge_of = (frame_idx: number, atom_idx: number): number => frame_idx + atom_idx / 10
  const velocity_of = (frame_idx: number, atom_idx: number): number[] => [
    frame_idx,
    atom_idx,
    frame_idx * atom_idx,
  ]

  // extXYZ carrying per-atom charge + velocity columns, for position-stream channels
  const create_channel_xyz = (num_frames: number, atoms_per_frame: number): string =>
    Array.from({ length: num_frames }, (_, frame_idx) =>
      [
        `${atoms_per_frame}`,
        `Properties=species:S:1:pos:R:3:charge:R:1:velocity:R:3 frame=${frame_idx}`,
        ...Array.from(
          { length: atoms_per_frame },
          (_unused, atom_idx) =>
            `H ${atom_idx * 0.1} ${frame_idx * 0.1} 0 ${charge_of(frame_idx, atom_idx)} ${velocity_of(
              frame_idx,
              atom_idx,
            ).join(` `)}`,
        ),
      ].join(`\n`),
    ).join(`\n`)

  // Helper to create synthetic ASE trajectory data (minimal valid structure).
  // `extra_fields` merge into every frame's JSON header, for cases that turn on
  // which section a scalar was written to.
  const create_synthetic_ase = (
    num_frames: number,
    extra_fields: Record<string, unknown> = {},
  ): ArrayBuffer => {
    // Create minimal valid ASE trajectory with proper header
    const signature = `- of Ulm\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0`
    const frame_data = JSON.stringify({
      positions: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      numbers: [1, 1],
      cell: [
        [5, 0, 0],
        [0, 5, 0],
        [0, 0, 5],
      ],
      pbc: [true, true, true],
      ...extra_fields,
    })

    const total_size = 48 + num_frames * 8 + frame_data.length * num_frames + num_frames * 8
    const buffer = new ArrayBuffer(total_size)
    const view = new DataView(buffer)

    // Write header
    new Uint8Array(buffer, 0, 24).set(new TextEncoder().encode(signature.slice(0, 24)))
    view.setBigInt64(24, BigInt(1), true) // version
    view.setBigInt64(32, BigInt(num_frames), true) // n_items
    view.setBigInt64(40, BigInt(48), true) // offsets_pos

    // Write frame offsets
    let current_offset = 48 + num_frames * 8
    for (let idx = 0; idx < num_frames; idx++) {
      view.setBigInt64(48 + idx * 8, BigInt(current_offset), true)
      current_offset += 8 + frame_data.length // 8 bytes for length + data
    }

    // Write frame data
    current_offset = 48 + num_frames * 8
    for (let idx = 0; idx < num_frames; idx++) {
      view.setBigInt64(current_offset, BigInt(frame_data.length), true)
      new Uint8Array(buffer, current_offset + 8, frame_data.length).set(
        new TextEncoder().encode(frame_data),
      )
      current_offset += 8 + frame_data.length
    }

    return buffer
  }

  it(`surfaces non-fatal parse warnings via trajectory metadata`, async () => {
    // Two-frame XYZ where one atom per frame has an unrecognized element symbol.
    // Those atoms are skipped with non-fatal warnings that must reach the UI via
    // metadata.parse_warnings (collected by the diagnostics module during parsing).
    const xyz = [
      `2`,
      `frame 0`,
      `H 0 0 0`,
      `Zz 1 1 1`,
      `2`,
      `frame 1`,
      `H 0 0 0`,
      `Zz 1 1 1`,
    ].join(`\n`)
    const traj = await parse_trajectory_async(xyz, `warn.xyz`)
    const warnings = traj.metadata?.parse_warnings as string[] | undefined
    expect(warnings?.length).toBeGreaterThan(0)
    expect(warnings?.every((msg) => msg.includes(`unknown element symbol`))).toBe(true)
  })

  it(`ignores stale out-of-order frame loads`, async () => {
    mount(TrajectoryRaceHarness, { target: document.body })
    const settle_frame_load = async () => {
      await Promise.resolve()
      flushSync()
      await tick()
    }
    const wait_for_frame_load_debounce = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, FRAME_LOAD_DEBOUNCE_MS + 15))
      await settle_frame_load()
    }
    await tick()
    await wait_for_frame_load_debounce()
    expect(document.querySelector(`[data-testid="pending-loads"]`)?.textContent).toBe(`0`)

    document.querySelector<HTMLButtonElement>(`[data-testid="step-1"]`)?.click()
    flushSync()
    await tick()
    await wait_for_frame_load_debounce()
    expect(document.querySelector(`[data-testid="pending-loads"]`)?.textContent).toBe(`0,1`)

    document.querySelector<HTMLButtonElement>(`[data-testid="resolve-1"]`)?.click()
    await settle_frame_load()
    // Site cards are the probe for which frame is displayed, and the info pane only
    // renders them while open.
    document.querySelector<HTMLButtonElement>(`.structure-info-toggle`)?.click()
    await tick()
    expect(document.body.textContent).toContain(`Cart. (1, 0, 0)`)

    document.querySelector<HTMLButtonElement>(`[data-testid="resolve-0"]`)?.click()
    await settle_frame_load()
    expect(document.body.textContent).toContain(`Cart. (1, 0, 0)`)
  })

  describe(`Frame Indexing`, () => {
    it.each([
      [`XYZ`, create_synthetic_xyz(10), `test.xyz`, 2, [0, 2, 4, 6, 8]], // 10 frames, every 2nd
      [`ASE`, create_synthetic_ase(20), `test.traj`, 5, [0, 5, 10, 15]], // 20 frames, every 5th
    ])(
      `builds frame index for %s trajectory`,
      async (_fmt, data, file, rate, frame_numbers) => {
        const index = await new TrajFrameReader(file).build_frame_index(data, rate)

        expect(index.map((entry) => entry.frame_number)).toEqual(frame_numbers)
        // byte offsets strictly increasing
        for (let idx = 1; idx < index.length; idx++) {
          expect(index[idx].byte_offset).toBeGreaterThan(index[idx - 1].byte_offset)
        }
      },
    )

    // Which section a scalar lands in is up to whoever wrote the file, so reading
    // each alias from only one of them drops it from the other, silently.
    it(`extracts scalars from whichever section the writer used`, async () => {
      const data = create_synthetic_ase(1, {
        [`calculator.`]: { pressure: 2.5 },
        info: { energy: -7.25 },
      })
      const [metadata] = await new TrajFrameReader(`sections.traj`).extract_plot_metadata(data)

      expect(metadata.properties.pressure).toBe(2.5)
      expect(metadata.properties.energy).toBe(-7.25)
    })

    it(`should report progress during indexing`, async () => {
      const data = create_synthetic_xyz(1000) // Larger for progress testing
      const loader = new TrajFrameReader(`test.xyz`)
      const progress_calls: ParseProgress[] = []

      await loader.build_frame_index(data, 1, (progress) => {
        progress_calls.push({ ...progress })
      })

      expect(progress_calls.length).toBeGreaterThan(0)
      expect(progress_calls[0].current).toBeGreaterThanOrEqual(0)
      expect(progress_calls[progress_calls.length - 1].current).toBeGreaterThan(50)
    })
  })

  describe(`Lazy Frame Loading`, () => {
    it(`loads non-sequential frames with metadata and rejects out-of-bounds`, async () => {
      const data = create_synthetic_xyz(50)
      const loader = new TrajFrameReader(`test.xyz`)

      const frame_5 = await loader.load_frame(data, 5)
      const frame_10 = await loader.load_frame(data, 10)
      const frame_45 = await loader.load_frame(data, 45)

      expect(frame_5?.step).toBe(5)
      expect(frame_10?.step).toBe(10)
      expect(frame_45?.step).toBe(45)
      // step is used as frame number in synthetic XYZ
      expect(frame_5?.metadata?.energy).toBe(-10.5)
      expect(frame_10?.metadata?.energy).toBe(-11.0)
      expect(frame_45?.metadata?.energy).toBe(-14.5)
      expect(await loader.load_frame(data, 50)).toBeNull()
    })

    it(`should parse Lattice and Properties-offset forces in indexed loads`, async () => {
      const comment = `Lattice="6 0 0 0 6 0 0 0 6" Properties=species:S:1:pos:R:3:momenta:R:3:forces:R:3 energy=-1.5`
      const frame = `1\n${comment}\nH 0.0 0.0 0.0 9.9 9.9 9.9 0.1 0.2 0.3`

      const loaded = await new TrajFrameReader(`test.xyz`).load_frame(`${frame}\n${frame}`, 1)
      const structure = loaded?.structure
      expect(structure && `lattice` in structure && structure.lattice.matrix).toEqual([
        [6, 0, 0],
        [0, 6, 0],
        [0, 0, 6],
      ])
      expect(loaded?.metadata?.forces).toEqual([[0.1, 0.2, 0.3]])
      expect(loaded?.metadata?.energy).toBe(-1.5)
      expect(loaded?.metadata?.volume).toBe(216) // derived from lattice (6^3), parity with eager parser
    })

    // A whole-trajectory sweep is the only way MSD-style analyses can see past the
    // 10-frame window an indexed parse leaves in trajectory.frames
    it.each([
      [`XYZ`, create_synthetic_xyz(25), `stream.xyz`, 1, 25],
      [`XYZ strided`, create_synthetic_xyz(25), `stream.xyz`, 4, 7],
      [`ASE`, create_synthetic_ase(8), `stream.traj`, 1, 8],
    ])(
      `streams flat positions for %s`,
      async (_fmt, data, filename, frame_stride, expected_frames) => {
        const stream = await new TrajFrameReader(filename).stream_positions(data, {
          frame_stride,
        })

        expect(stream.n_frames).toBe(expected_frames)
        expect(stream.positions).toHaveLength(stream.n_frames * stream.n_atoms * 3)
        expect(stream.elements).toHaveLength(stream.n_atoms)
        expect(stream.frame_stride).toBe(frame_stride)
        expect(stream.steps).toHaveLength(expected_frames)
        // Wrapped/unwrapped is a LAMMPS-only distinction; these formats are wrapped
        expect(stream.coords_unwrapped).toBe(false)
      },
    )

    it(`streamed positions match frame-by-frame loads exactly`, async () => {
      const data = create_synthetic_xyz(12, 3)
      const loader = new TrajFrameReader(`stream.xyz`)
      const stream = await loader.stream_positions(data)

      for (let frame_idx = 0; frame_idx < stream.n_frames; frame_idx++) {
        const frame = await loader.load_frame(data, frame_idx)
        expect(frame).not.toBeNull()
        for (const [atom_idx, site] of (frame?.structure.sites ?? []).entries()) {
          const pos_offset = (frame_idx * stream.n_atoms + atom_idx) * 3
          expect([
            stream.positions[pos_offset],
            stream.positions[pos_offset + 1],
            stream.positions[pos_offset + 2],
          ]).toEqual([site.xyz[0], site.xyz[1], site.xyz[2]])
        }
      }
    })

    it.each([
      [`zero stride`, 0, /frame_stride must be a positive integer/],
      [`fractional stride`, 1.5, /frame_stride must be a positive integer/],
    ])(`rejects a %s`, async (_label, frame_stride, pattern) => {
      const loader = new TrajFrameReader(`stream.xyz`)
      await expect(
        loader.stream_positions(create_synthetic_xyz(5), { frame_stride }),
      ).rejects.toThrow(pattern)
    })

    it(`refuses to allocate past the position-buffer budget`, async () => {
      const loader = new TrajFrameReader(`stream.xyz`)
      await expect(
        loader.stream_positions(create_synthetic_xyz(100, 3), { max_bytes: 512 }),
      ).rejects.toThrow(/over the 512 byte budget\. Use frame_stride >=/)
    })

    // Per-atom channels ride along with positions in the same frame-major layout, so
    // whole-trajectory analyses can see velocities/charges without re-decoding frames
    it(`collects opt-in scalar and vector channels`, async () => {
      const data = create_channel_xyz(3, 2)
      const loader = new TrajFrameReader(`channels.extxyz`)
      // Columns present but no keys requested → maps must stay omitted
      const bare = await loader.stream_positions(data)
      expect(bare.scalars).toBeUndefined()
      expect(bare.vectors).toBeUndefined()

      const stream = await loader.stream_positions(data, {
        scalar_keys: [`charge`],
        vector_keys: [`velocity`],
      })

      expect(stream.n_frames).toBe(3)
      expect(stream.n_atoms).toBe(2)
      expect(stream.scalars?.charge).toHaveLength(3 * 2)
      expect(stream.vectors?.velocity).toHaveLength(3 * 2 * 3)
      for (let frame_idx = 0; frame_idx < 3; frame_idx++) {
        for (let atom_idx = 0; atom_idx < 2; atom_idx++) {
          const flat = frame_idx * 2 + atom_idx
          const vec = Array.from(
            (stream.vectors?.velocity ?? []).slice(flat * 3, flat * 3 + 3),
          )
          expect(stream.scalars?.charge[flat]).toBeCloseTo(charge_of(frame_idx, atom_idx))
          expect(vec).toEqual(velocity_of(frame_idx, atom_idx))
        }
      }
    })

    // 2 frames x 2 atoms of positions alone is 96 bytes; adding one scalar and one vector
    // channel takes it to 224, so a 128 byte budget must accept the first and reject the
    // second. A budget that ignored channels would wave both through.
    it(`charges the extra channels against the byte budget`, async () => {
      const loader = new TrajFrameReader(`channels.extxyz`)
      const data = create_channel_xyz(2, 2)
      await expect(loader.stream_positions(data, { max_bytes: 128 })).resolves.toBeDefined()
      await expect(
        loader.stream_positions(data, {
          max_bytes: 128,
          scalar_keys: [`charge`],
          vector_keys: [`velocity`],
        }),
      ).rejects.toThrow(/needs 224 bytes, over the 128 byte budget/)
    })

    // Filling NaN would leave a channel that silently goes flat mid-trajectory
    // indistinguishable from real data, so a missing property is fatal and says where
    it.each([
      [
        `scalar`,
        { scalar_keys: [`charge`] },
        /Frame 1 site 0 has no finite scalar property "charge"/,
      ],
      [
        `vector`,
        { vector_keys: [`velocity`] },
        /Frame 1 site 0 has no finite vec3 property "velocity"/,
      ],
    ])(
      `throws when a frame is missing a requested %s channel`,
      async (_kind, keys, pattern) => {
        // Second frame drops the extra columns
        const data = `${create_channel_xyz(1, 1)}\n1\nProperties=species:S:1:pos:R:3\nH 0 0 0`
        await expect(
          new TrajFrameReader(`channels.extxyz`).stream_positions(data, keys),
        ).rejects.toThrow(pattern)
      },
    )

    it.each([
      [`scalar`, `NaN`, `charge`, `charge:R:1`, `1`],
      [`scalar`, `Infinity`, `charge`, `charge:R:1`, `1`],
      [`vec3`, `NaN 2 3`, `velocity`, `velocity:R:3`, `1 2 3`],
      [`vec3`, `1 2 Infinity`, `velocity`, `velocity:R:3`, `1 2 3`],
    ])(
      `rejects a requested %s channel containing %s`,
      async (kind, invalid, key, declaration, valid) => {
        const frame = (value: string) =>
          `1\nProperties=species:S:1:pos:R:3:${declaration}\nH 0 0 0 ${value}`
        const keys = kind === `scalar` ? { scalar_keys: [key] } : { vector_keys: [key] }
        await expect(
          new TrajFrameReader(`channels.extxyz`).stream_positions(
            `${frame(valid)}\n${frame(invalid)}`,
            keys,
          ),
        ).rejects.toThrow(`Frame 1 site 0 has no finite ${kind} property "${key}"`)
      },
    )

    it(`rejects a key requested as both a scalar and a vector`, async () => {
      await expect(
        new TrajFrameReader(`channels.extxyz`).stream_positions(create_channel_xyz(2, 1), {
          scalar_keys: [`velocity`],
          vector_keys: [`velocity`],
        }),
      ).rejects.toThrow(/velocity requested as both a scalar and a vector channel/)
    })

    it(`should preserve EXTXYZ PBC in indexed loads`, async () => {
      const frame = (pbc_field: string): string => `1
Lattice="10 0 0 0 10 0 0 0 10" Properties=species:S:1:pos:R:3${pbc_field}
Si 0 0 0`
      const loader = new TrajFrameReader(`pbc.extxyz`)
      const source = `${frame(` pbc="F F F"`)}\n${frame(` pbc="T F T"`)}`
      const lattice_pbc = async (idx: number) => {
        const loaded = await loader.load_frame(source, idx)
        expect(loaded?.structure && `lattice` in loaded.structure).toBe(true)
        return loaded && `lattice` in loaded.structure
          ? loaded.structure.lattice.pbc
          : undefined
      }

      expect(await lattice_pbc(0)).toEqual([false, false, false])
      expect(await lattice_pbc(1)).toEqual([true, false, true])
    })
  })

  describe(`Plot Metadata Extraction`, () => {
    it(`should extract metadata without loading full frames`, async () => {
      const data = create_synthetic_xyz(30)
      const loader = new TrajFrameReader(`test.xyz`)

      const metadata = await loader.extract_plot_metadata(data, { sample_rate: 3 })

      expect(metadata).toHaveLength(10) // 30 frames, every 3rd = 10
      expect(metadata[0].properties.energy).toBe(-10)
      expect(metadata[1].properties.energy).toBe(-10.3) // frame 3
      expect(metadata[0].properties.volume).toBe(100)
      expect(metadata[1].properties.volume).toBe(103) // frame 3
    })

    it.each<[string, Record<string, number>]>([
      [`step=100 dt=0.5`, {}], // 'p' of step must not match pressure
      [`frame=5`, {}], // 'e' of frame must not match energy
      [`energy=-1.5 volume=100`, { energy: -1.5, volume: 100 }],
    ])(`should anchor metadata keys at word boundaries: %s`, async (comment, expected) => {
      const frame = `1\n${comment}\nH 0.0 0.0 0.0`
      const loader = new TrajFrameReader(`test.xyz`)
      const metadata = await loader.extract_plot_metadata(`${frame}\n${frame}`, {
        sample_rate: 1,
      })
      expect(metadata[0].properties).toEqual(expected)
    })

    it(`should filter properties when requested`, async () => {
      const data = create_synthetic_xyz(10)
      const loader = new TrajFrameReader(`test.xyz`)

      const metadata = await loader.extract_plot_metadata(data, {
        sample_rate: 1,
        properties: [`energy`], // Only energy, not volume
      })

      expect(metadata[0].properties).toHaveProperty(`energy`)
      expect(metadata[0].properties).not.toHaveProperty(`volume`)
    })

    it(`should report progress during metadata extraction`, async () => {
      const data = create_synthetic_xyz(5000) // Larger to trigger progress
      const loader = new TrajFrameReader(`test.xyz`)
      const progress_calls: ParseProgress[] = []

      await loader.extract_plot_metadata(data, { sample_rate: 1 }, (progress) => {
        progress_calls.push({ ...progress })
      })

      expect(progress_calls.length).toBeGreaterThan(0)
      expect(progress_calls.some((call) => call.stage.includes(`Extracting`))).toBe(true)
    })
  })

  describe(`Large File Detection & Auto-Streaming`, () => {
    it(`should use direct parsing for small files`, async () => {
      const data = create_synthetic_xyz(5)

      expect(data.length).toBeLessThan(LARGE_FILE_THRESHOLD)

      const result = await parse_trajectory_async(data, `small_trajectory.xyz`)

      // Should not have streaming metadata
      expect(result.is_indexed).toBeUndefined()
      expect(result.indexed_frames).toBeUndefined()
      expect(result.frames).toHaveLength(5) // All frames loaded
      expect(result.metadata?.source_format).toBe(`xyz_trajectory`)
      // clean input must not attach a parse_warnings array (only set when warnings occur)
      expect(result.metadata?.parse_warnings).toBeUndefined()
    })

    // use_indexing forces streaming even for small files, incl. compressed filenames
    it.each([
      {
        desc: `explicit request`,
        filename: `force_streaming.xyz`,
        options: { use_indexing: true, extract_plot_metadata: true },
        expect_plot_metadata: true,
      },
      {
        desc: `compressed filename`,
        filename: `compressed-trajectory.xyz.gz`,
        options: { use_indexing: true },
        expect_plot_metadata: false,
      },
    ])(
      `forces indexed loading ($desc)`,
      async ({ filename, options, expect_plot_metadata }) => {
        const result = await parse_trajectory_async(
          create_synthetic_xyz(5),
          filename,
          undefined,
          options,
        )
        expect(result.is_indexed).toBe(true)
        expect(result.indexed_frames).toBeInstanceOf(Array)
        expect(result.indexed_frames?.length).toBeGreaterThan(0)
        expect(result.total_frames).toBe(5)
        expect(result.frame_loader).toBeDefined()
        if (expect_plot_metadata) expect(result.plot_metadata).toBeDefined()
      },
    )

    it(`loads only the initial window in indexed mode`, async () => {
      const result = await parse_trajectory_async(
        create_synthetic_xyz(20),
        `simulated_large.xyz`,
        undefined,
        { use_indexing: true, index_sample_rate: 1 },
      )
      expect(result.is_indexed).toBe(true)
      expect(result.indexed_frames).toHaveLength(20)
      expect(result.indexed_frames?.[0]).toHaveProperty(`frame_number`)
      expect(result.total_frames).toBe(20)
      expect(result.frame_loader).toBeDefined()
      expect(result.frames).toHaveLength(10)
    })
  })

  describe(`Memory Efficiency`, () => {
    it(`should handle large frame counts and load from anywhere in the sequence`, async () => {
      const data = create_synthetic_xyz(1000) // Large number of frames
      const loader = new TrajFrameReader(`test.xyz`)

      const frame_index = await loader.build_frame_index(data, 10)
      expect(frame_index).toHaveLength(100) // Every 10th frame = 1000/10 = 100

      // Index entries must stay lightweight (no parsed structures/positions attached)
      expect(frame_index[0]).not.toHaveProperty(`structure`)
      expect(frame_index[0]).not.toHaveProperty(`metadata`)
      expect(frame_index[0]).not.toHaveProperty(`positions`)

      // Should be able to load frames from anywhere in the sequence
      const first_frame = await loader.load_frame(data, 0)
      const middle_frame = await loader.load_frame(data, 500)
      const last_frame = await loader.load_frame(data, 999)

      expect(first_frame?.metadata?.energy).toBe(-10)
      expect(middle_frame?.metadata?.energy).toBe(-60)
      expect(last_frame?.metadata?.energy).toBe(-109.9)
    })
  })

  describe(`Error Handling in Streaming Mode`, () => {
    it(`should handle corrupted frame data gracefully`, async () => {
      let data = create_synthetic_xyz(10)
      // Corrupt one frame by replacing valid atom count with invalid text
      data = data.replace(`3\nenergy=-10.5`, `invalid\nenergy=-10.5`)

      const loader = new TrajFrameReader(`test.xyz`)

      // Should skip corrupted frame and continue
      const total_frames = await loader.get_total_frames(data)
      expect(total_frames).toBe(9) // One less due to corruption

      const frame_4 = await loader.load_frame(data, 4)
      const frame_5 = await loader.load_frame(data, 5)
      const frame_6 = await loader.load_frame(data, 6)

      // Corrupted physical frame 5 is skipped entirely, so loaded indices stay
      // consistent with get_total_frames: index 5 maps to physical frame 6, etc.
      expect(frame_4?.metadata?.energy).toBe(-10.4)
      expect(frame_5?.metadata?.energy).toBe(-10.6)
      expect(frame_6?.metadata?.energy).toBe(-10.7)
    })

    it(`should handle empty or invalid trajectory data`, async () => {
      const loader = new TrajFrameReader(`test.xyz`)

      const empty_frames = await loader.get_total_frames(``)
      expect(empty_frames).toBe(0)

      const invalid_frame = await loader.load_frame(`invalid data`, 0)
      expect(invalid_frame).toBeNull()
    })

    it(`should handle progress callback errors gracefully`, async () => {
      const data = create_synthetic_xyz(20)
      const loader = new TrajFrameReader(`test.xyz`)

      const failing_callback = () => {
        throw new Error(`Progress callback failed`)
      }

      // Should not crash when progress callback throws
      await expect(loader.build_frame_index(data, 2, failing_callback)).resolves.toBeDefined()
    })
  })

  describe(`Cross-Format Streaming`, () => {
    it(`should handle both XYZ and ASE with same interface`, async () => {
      const xyz_data = create_synthetic_xyz(10)
      const ase_data = create_synthetic_ase(10)

      const xyz_loader = new TrajFrameReader(`test.xyz`)
      const ase_loader = new TrajFrameReader(`test.traj`)

      // Both should implement same interface
      expect(await xyz_loader.get_total_frames(xyz_data)).toBe(10)
      expect(await ase_loader.get_total_frames(ase_data)).toBe(10)

      // Both should support frame loading
      const xyz_frame = await xyz_loader.load_frame(xyz_data, 3)
      const ase_frame = await ase_loader.load_frame(ase_data, 3)

      expect(xyz_frame?.step).toBe(3)
      expect(ase_frame?.step).toBe(3)
    })

    it(`labels indexed ASE data from compressed filenames correctly`, async () => {
      const result = await parse_trajectory_async(
        create_synthetic_ase(2),
        `test.traj.gz`,
        undefined,
        { use_indexing: true, extract_plot_metadata: false },
      )
      expect(result.metadata?.source_format).toBe(`ase_trajectory`)
    })
  })

  describe(`Performance Characteristics`, () => {
    it(`should have O(1) frame access time with indexing`, async () => {
      const data = create_synthetic_xyz(100)
      const loader = new TrajFrameReader(`test.xyz`)

      // Warm the line/frame-index cache once (first load builds it in O(n)); after
      // that every seek is O(1) lookup + O(frame_size) regardless of position.
      await loader.load_frame(data, 0)

      // One sub-millisecond sample measures scheduler noise, not complexity — as a ratio of
      // two such samples this flaked at 9.1 and 17.6 on a loaded machine. Batch the loads so
      // each measurement is milliseconds of real work, and keep the fastest round so a single
      // GC pause can't decide the result. An O(n) seek still shows up: frame 95 would scan
      // ~19x the lines of frame 5.
      const batch_ms = async (frame_num: number) => {
        const rounds: number[] = []
        for (let round = 0; round < 3; round++) {
          const start = performance.now()
          for (let rep = 0; rep < 25; rep++) await loader.load_frame(data, frame_num)
          rounds.push(performance.now() - start)
        }
        return Math.min(...rounds)
      }

      const timings = [await batch_ms(5), await batch_ms(50), await batch_ms(95)]
      expect(Math.max(...timings) / Math.min(...timings)).toBeLessThan(6)
    })

    it(`splits the XYZ payload once across many sequential frame loads`, async () => {
      // Regression: load_xyz_frame used to re-split the whole file (data.split(/\r?\n/))
      // and rescan from line 0 on every seek → O(n²) over a full playback/export.
      // The cache must split the newline-delimited payload exactly once.
      const data = create_synthetic_xyz(60)
      const loader = new TrajFrameReader(`test.xyz`)

      const split_spy = vi.spyOn(String.prototype, `split`)
      const newline_splits = () =>
        split_spy.mock.calls.filter(
          ([sep]) => sep instanceof RegExp && sep.source.includes(`\\n`),
        ).length

      try {
        for (let idx = 0; idx < 60; idx++) {
          const frame = await loader.load_frame(data, idx)
          expect(frame?.step, `frame ${idx}`).toBe(idx)
        }
        // Exactly one full-file split despite 60 sequential loads (was 60 before the fix)
        expect(newline_splits()).toBe(1)
      } finally {
        split_spy.mockRestore()
      }
    })

    it(`reuses the cache for random-access and repeated loads`, async () => {
      const data = create_synthetic_xyz(40)
      const loader = new TrajFrameReader(`test.xyz`)

      // Non-sequential + repeated access must stay correct with the line cache
      for (const idx of [37, 0, 19, 37, 5, 0]) {
        const frame = await loader.load_frame(data, idx)
        expect(frame?.step, `frame ${idx}`).toBe(idx)
        expect(frame?.metadata?.energy).toBeCloseTo(-10 - idx * 0.1, 10)
      }
      // Out-of-range still returns null after the cache is warm
      expect(await loader.load_frame(data, 40)).toBeNull()
    })

    it(`metadata extraction assigns sequential frame numbers and keeps frames loadable`, async () => {
      const frame_count = 50
      const data = create_synthetic_xyz(frame_count)
      const loader = new TrajFrameReader(`test.xyz`)

      const metadata = await loader.extract_plot_metadata(data, { sample_rate: 1 })

      expect(metadata).toHaveLength(frame_count)
      for (const [idx, entry] of metadata.entries()) {
        expect(entry.frame_number, `entry ${idx}`).toBe(idx)
        expect(typeof entry.step).toBe(`number`)
      }

      // Individual frames stay loadable after metadata extraction
      const frame_last = await loader.load_frame(data, frame_count - 1)
      expect(frame_last?.structure.sites.length).toBeGreaterThan(0)
    })
  })

  describe(`Regression Tests`, () => {
    it(`should preserve all frame metadata during streaming`, async () => {
      const data = create_synthetic_xyz(10)

      const direct_result = await parse_trajectory_async(data, `test.xyz`)
      const streaming_result = await parse_trajectory_async(data, `test.xyz`, undefined, {
        use_indexing: true,
      })

      // First few frames should have identical metadata
      const direct_frame = direct_result.frames[3]
      const streaming_frame = streaming_result.frames[3]

      expect(streaming_frame.metadata?.energy).toBe(direct_frame.metadata?.energy)
      expect(streaming_frame.metadata?.volume).toBe(direct_frame.metadata?.volume)
      expect(streaming_frame.step).toBe(direct_frame.step)
    })

    it(`should properly label plot series from streaming metadata (volume fix)`, () => {
      // Create metadata with volume and energy properties
      const metadata = [
        { frame_number: 0, step: 0, properties: { volume: 100, energy: -10 } },
        { frame_number: 1, step: 1, properties: { volume: 105, energy: -10.5 } },
        { frame_number: 2, step: 2, properties: { volume: 110, energy: -11 } },
      ]

      // Generate plot series using the streaming function
      const series = generate_streaming_plot_series(metadata, {
        property_config: trajectory_property_config,
      })

      // Find volume and energy series
      const volume_series = series.find((srs) => srs.label === `Volume`)
      const energy_series = series.find((srs) => srs.label === `Energy`)

      // Volume should be properly labeled as "Volume" not "volume" or "Series 1"
      expect(volume_series).toBeDefined()
      expect(volume_series?.label).toBe(`Volume`)
      expect(volume_series?.unit).toBe(`Å³`)
      expect(volume_series?.y).toEqual([100, 105, 110])

      // Energy should also be properly labeled
      expect(energy_series).toBeDefined()
      expect(energy_series?.label).toBe(`Energy`)
      expect(energy_series?.unit).toBe(`eV`)
      expect(energy_series?.y).toEqual([-10, -10.5, -11])

      // No series should have generic names like "Series 1"
      const generic_series = series.filter((srs) => srs.label?.startsWith(`Series `))
      expect(generic_series).toHaveLength(0)
    })

    // x values must be frame numbers (not MD steps), sorted ascending
    it(`sorts streamed plot points by frame number`, () => {
      const metadata = [
        { frame_number: 20, step: 40_000, properties: { energy: -12 } },
        { frame_number: 0, step: 0, properties: { energy: -10 } },
        { frame_number: 10, step: 20_000, properties: { energy: -11 } },
      ]

      const series = generate_streaming_plot_series(metadata, {
        property_config: trajectory_property_config,
      })

      expect(series.find((srs) => srs.label === `Energy`)).toMatchObject({
        x: [0, 10, 20],
        y: [-10, -11, -12],
      })
    })
  })
})
