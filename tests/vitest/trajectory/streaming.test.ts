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
import process from 'node:process'
import { flushSync, mount, tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import TrajectoryRaceHarness from './TrajectoryRaceHarness.svelte'

// CI environments have higher timing variability
const is_ci = [`true`, `1`].includes(process.env.CI ?? ``)

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
    for (let ii = 0; ii < num_frames; ii++) {
      const lines = [
        `${atoms_per_frame}`,
        `energy=${-10 - ii * 0.1} volume=${100 + ii} frame=${ii}`,
      ]
      for (let jj = 0; jj < atoms_per_frame; jj++) {
        lines.push(`H ${jj * 0.1} ${ii * 0.1} ${(ii + jj) * 0.05}`)
      }
      frames.push(lines.join(`\n`))
    }
    return frames.join(`\n`)
  }

  // Helper to create synthetic ASE trajectory data (minimal valid structure)
  const create_synthetic_ase = (num_frames: number): ArrayBuffer => {
    // Create minimal valid ASE trajectory with proper header
    const signature = `- of Ulm\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0`
    const version = new ArrayBuffer(8)
    const n_items = new ArrayBuffer(8)
    const offsets_pos = new ArrayBuffer(8)

    // Use DataView to write proper values
    new DataView(version).setBigInt64(0, BigInt(1), true)
    new DataView(n_items).setBigInt64(0, BigInt(num_frames), true)
    new DataView(offsets_pos).setBigInt64(0, BigInt(48), true) // After header

    // Simple frame data (minimal JSON)
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

    document.querySelector<HTMLButtonElement>(`[data-testid="step-1"]`)?.click()
    flushSync()
    await tick()
    await wait_for_frame_load_debounce()

    document.querySelector<HTMLButtonElement>(`[data-testid="resolve-1"]`)?.click()
    await settle_frame_load()
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
    it(`should load specific frames without loading all`, async () => {
      const data = create_synthetic_xyz(50)
      const loader = new TrajFrameReader(`test.xyz`)

      // Load frames 5, 10, 45 - non-sequential access
      const frame_5 = await loader.load_frame(data, 5)
      const frame_10 = await loader.load_frame(data, 10)
      const frame_45 = await loader.load_frame(data, 45)

      expect(frame_5?.step).toBe(5)
      expect(frame_10?.step).toBe(10)
      expect(frame_45?.step).toBe(45)

      // Verify metadata is correctly extracted (note: step is used as frame number)
      expect(frame_5?.metadata?.energy).toBe(-10.5)
      expect(frame_10?.metadata?.energy).toBe(-11.0)
      expect(frame_45?.metadata?.energy).toBe(-14.5)
    })

    it(`should handle out-of-bounds frame requests gracefully`, async () => {
      const data = create_synthetic_xyz(10)
      const loader = new TrajFrameReader(`test.xyz`)

      const invalid_frame = await loader.load_frame(data, 15) // Beyond available frames
      expect(invalid_frame).toBeNull()
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
    it(`should return indexed result when use_indexing is forced`, async () => {
      const small_data = create_synthetic_xyz(20)
      const result = await parse_trajectory_async(
        small_data,
        `simulated_large.xyz`,
        undefined,
        { use_indexing: true, index_sample_rate: 1 },
      )

      expect(result.is_indexed).toBe(true)
      expect(result.indexed_frames).toBeDefined()
      expect(result.total_frames).toBe(20)

      // Indexed mode loads only the initial window, not every frame
      expect(result.frames).toHaveLength(10)
      expect(result.frames.length).toBeLessThan(result.total_frames ?? 0)

      expect(result.indexed_frames).toBeInstanceOf(Array)
      expect(result.indexed_frames?.length).toBe(20)
      expect(result.indexed_frames?.[0]).toHaveProperty(`frame_number`)
      expect(result.frame_loader).toBeDefined()
    })

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
      [
        `explicit request`,
        `force_streaming.xyz`,
        { use_indexing: true, extract_plot_metadata: true },
        true,
      ],
      [`compressed filename`, `compressed-trajectory.xyz.gz`, { use_indexing: true }, false],
    ])(
      `forces indexed loading (%s)`,
      async (_desc, filename, options, expect_plot_metadata) => {
        const result = await parse_trajectory_async(
          create_synthetic_xyz(5),
          filename,
          undefined,
          options,
        )

        expect(result.is_indexed).toBe(true)
        expect(result.indexed_frames?.length).toBeGreaterThan(0)
        expect(result.total_frames).toBe(5)
        expect(result.frame_loader).toBeDefined()
        if (expect_plot_metadata) expect(result.plot_metadata).toBeDefined()
      },
    )
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

      // Time frame access at different positions
      const measure_access = async (frame_num: number) => {
        const start = performance.now()
        await loader.load_frame(data, frame_num)
        return performance.now() - start
      }

      const early_access = await measure_access(5)
      const middle_access = await measure_access(50)
      const late_access = await measure_access(95)

      // Access times should be similar regardless of position (within 2x tolerance)
      const max_time = Math.max(early_access, middle_access, late_access)
      const min_time = Math.min(early_access, middle_access, late_access)

      // CI has high timing variability; use generous threshold (semantically testing O(1) access)
      const max_ratio = is_ci ? 50 : 6
      expect(max_time / min_time).toBeLessThan(max_ratio)
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
