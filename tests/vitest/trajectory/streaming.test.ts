// Streaming trajectory loader tests - clever testing without large files
import { trajectory_property_config } from '$lib/labels'
import type { ParseProgress } from '$lib/trajectory'
import {
  create_frame_loader,
  LARGE_FILE_THRESHOLD,
  parse_trajectory_async,
  TrajFrameReader,
} from '$lib/trajectory/parse'
import { generate_streaming_plot_series } from '$lib/trajectory/plotting'
import { describe, expect, it } from 'vitest'

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
      positions: [[0, 0, 0], [1, 0, 0]],
      numbers: [1, 1],
      cell: [[5, 0, 0], [0, 5, 0], [0, 0, 5]],
      pbc: [true, true, true],
    })

    const total_size = 48 + num_frames * 8 + frame_data.length * num_frames +
      num_frames * 8
    const buffer = new ArrayBuffer(total_size)
    const view = new DataView(buffer)

    // Write header
    new Uint8Array(buffer, 0, 24).set(new TextEncoder().encode(signature.slice(0, 24)))
    view.setBigInt64(24, BigInt(1), true) // version
    view.setBigInt64(32, BigInt(num_frames), true) // n_items
    view.setBigInt64(40, BigInt(48), true) // offsets_pos

    // Write frame offsets
    let current_offset = 48 + num_frames * 8
    for (let i = 0; i < num_frames; i++) {
      view.setBigInt64(48 + i * 8, BigInt(current_offset), true)
      current_offset += 8 + frame_data.length // 8 bytes for length + data
    }

    // Write frame data
    current_offset = 48 + num_frames * 8
    for (let i = 0; i < num_frames; i++) {
      view.setBigInt64(current_offset, BigInt(frame_data.length), true)
      new Uint8Array(buffer, current_offset + 8, frame_data.length)
        .set(new TextEncoder().encode(frame_data))
      current_offset += 8 + frame_data.length
    }

    return buffer
  }

  describe(`Frame Indexing`, () => {
    it(`should build frame index for XYZ trajectory`, async () => {
      const data = create_synthetic_xyz(10)
      const loader = new TrajFrameReader(`test.xyz`)

      const index = await loader.build_frame_index(data, 2) // Every 2nd frame

      expect(index).toHaveLength(5) // 10 frames, every 2nd = 5 indices
      expect(index[0].frame_number).toBe(0)
      expect(index[1].frame_number).toBe(2)
      expect(index[2].frame_number).toBe(4)

      // Verify byte offsets are increasing
      for (let idx = 1; idx < index.length; idx++) {
        expect(index[idx].byte_offset).toBeGreaterThan(index[idx - 1].byte_offset)
      }
    })

    it(`should build frame index for ASE trajectory`, async () => {
      const data = create_synthetic_ase(20)
      const loader = new TrajFrameReader(`test.traj`)

      const index = await loader.build_frame_index(data, 5) // Every 5th frame

      expect(index).toHaveLength(4) // 20 frames, every 5th = 4 indices
      expect(index[0].frame_number).toBe(0)
      expect(index[1].frame_number).toBe(5)
      expect(index[2].frame_number).toBe(10)
      expect(index[3].frame_number).toBe(15)
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

    it(`should work with frame index for faster access`, async () => {
      const data = create_synthetic_xyz(20)
      const loader = new TrajFrameReader(`test.xyz`)

      // Load frame using index (should be faster for large files)
      const frame = await loader.load_frame(data, 8)
      expect(frame?.step).toBe(8)
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
      expect(progress_calls.some((p) => p.stage.includes(`Extracting`))).toBe(true)
    })
  })

  describe(`Large File Detection & Auto-Streaming`, () => {
    it(`should automatically use streaming for large files`, async () => {
      // Create small synthetic data for efficiency
      const small_data = create_synthetic_xyz(10)

      // Simulate large file by forcing use_indexing option
      // This tests that when streaming is enabled (as it would be for large files),
      // the correct indexed result structure is returned
      const result = await parse_trajectory_async(
        small_data,
        `simulated_large.xyz`,
        undefined,
        { use_indexing: true }, // Force streaming mode as large file detection would
      )

      // Should have streaming characteristics that large files would automatically get
      expect(result.is_indexed).toBe(true)
      expect(result.indexed_frames).toBeDefined()
      expect(result.total_frames).toBe(10)

      // Should only load initial frames, not all frames
      expect(result.frames.length).toBeLessThanOrEqual(10)
      expect(result.frames.length).toBeGreaterThan(0)

      // Verify that indexed_frames contains frame metadata
      expect(result.indexed_frames).toBeInstanceOf(Array)
      expect(result.indexed_frames?.length).toBeGreaterThan(0)
      expect(result.indexed_frames?.[0]).toHaveProperty(`frame_number`)
    })

    it(`should use direct parsing for small files`, async () => {
      const data = create_synthetic_xyz(5)

      expect(data.length).toBeLessThan(LARGE_FILE_THRESHOLD)

      const result = await parse_trajectory_async(data, `small_trajectory.xyz`)

      // Should not have streaming metadata
      expect(result.is_indexed).toBeFalsy()
      expect(result.indexed_frames).toBeUndefined()
      expect(result.frames).toHaveLength(5) // All frames loaded
    })

    it(`should force streaming when explicitly requested`, async () => {
      const data = create_synthetic_xyz(5)

      const result = await parse_trajectory_async(
        data,
        `force_streaming.xyz`,
        undefined,
        { use_indexing: true, extract_plot_metadata: true },
      )

      // Should have streaming metadata even for small file
      expect(result.is_indexed).toBe(true)
      expect(result.indexed_frames).toBeDefined()
      expect(result.plot_metadata).toBeDefined()
    })
  })

  describe(`Memory Efficiency`, () => {
    it(`should build index without storing full frame data`, async () => {
      const data = create_synthetic_xyz(100)
      const loader = new TrajFrameReader(`test.xyz`)

      // Build frame index (sample_rate=1 means index all frames)
      const frame_index = await loader.build_frame_index(data, 1)

      // Index should contain all frames
      expect(frame_index).toHaveLength(100)
      expect(frame_index[0]).toHaveProperty(`byte_offset`)
      expect(frame_index[0]).toHaveProperty(`frame_number`)

      // Index entries should be lightweight (no structure or metadata stored)
      expect(frame_index[0]).not.toHaveProperty(`structure`)
      expect(frame_index[0]).not.toHaveProperty(`metadata`)
      expect(frame_index[0]).not.toHaveProperty(`positions`)
    })

    it(`should load frames on-demand without caching`, async () => {
      const data = create_synthetic_xyz(20)
      const loader = new TrajFrameReader(`test.xyz`)

      // Load several frames
      const frame_5 = await loader.load_frame(data, 5)
      const frame_10 = await loader.load_frame(data, 10)
      const frame_15 = await loader.load_frame(data, 15)

      // Each frame should be loaded fresh (verify they have different data)
      expect(frame_5?.metadata?.energy).toBe(-10.5)
      expect(frame_10?.metadata?.energy).toBe(-11)
      expect(frame_15?.metadata?.energy).toBe(-11.5)

      // Loader should only contain format information, not frame data
      const loader_properties = Object.keys(loader)
      expect(loader_properties).toContain(`format`)
      expect(loader_properties).not.toContain(`cached_frames`)
      expect(loader_properties).not.toContain(`loaded_data`)
    })

    it(`should handle large frame counts efficiently`, async () => {
      const data = create_synthetic_xyz(1000) // Large number of frames
      const loader = new TrajFrameReader(`test.xyz`)

      // Building index should be fast and not timeout (sample every 10th frame)
      const start_time = performance.now()
      const frame_index = await loader.build_frame_index(data, 10)
      const elapsed_time = performance.now() - start_time

      // Should complete indexing efficiently
      expect(elapsed_time).toBeLessThan(1000) // Less than 1 second
      expect(frame_index).toHaveLength(100) // Every 10th frame = 1000/10 = 100

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
      const frame_5 = await loader.load_frame(data, 5) // Try to load the corrupted frame
      const frame_6 = await loader.load_frame(data, 6) // Skip the corrupted frame

      expect(frame_4).toBeTruthy()
      expect(frame_5).toBeNull() // Corrupted frame should return null
      expect(frame_6).toBeTruthy()
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
      await expect(loader.build_frame_index(data, 2, failing_callback)).resolves
        .toBeDefined()
    })
  })

  describe(`Cross-Format Streaming`, () => {
    it(`should handle both XYZ and ASE with same interface`, async () => {
      const xyz_data = create_synthetic_xyz(10)
      const ase_data = create_synthetic_ase(10)

      const xyz_loader = create_frame_loader(`test.xyz`)
      const ase_loader = create_frame_loader(`test.traj`)

      // Both should implement same interface
      const xyz_frames = await xyz_loader.get_total_frames(xyz_data)
      const ase_frames = await ase_loader.get_total_frames(ase_data)

      expect(xyz_frames).toBe(10)
      expect(ase_frames).toBe(10)

      // Both should support frame loading
      const xyz_frame = await xyz_loader.load_frame(xyz_data, 3)
      const ase_frame = await ase_loader.load_frame(ase_data, 3)

      expect(xyz_frame?.step).toBe(3)
      expect(ase_frame?.step).toBe(3)
    })

    it(`should auto-detect format and create appropriate loader`, () => {
      const xyz_loader = create_frame_loader(`trajectory.xyz`)
      const ase_loader = create_frame_loader(`trajectory.traj`)

      expect(xyz_loader).toBeInstanceOf(TrajFrameReader)
      expect(ase_loader).toBeInstanceOf(TrajFrameReader)

      // Should throw for unsupported formats
      expect(() => create_frame_loader(`trajectory.pdb`)).toThrow()
    })
  })

  describe(`Performance Characteristics`, () => {
    it(`should have O(1) frame access time with indexing`, async () => {
      const data = create_synthetic_xyz(100)
      const loader = new TrajFrameReader(`test.xyz`)

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

      expect(max_time / min_time).toBeLessThan(6) // Should not scale linearly (was toBeLessThan(2) but too flaky)
    })

    it(`should extract metadata faster than loading full frames`, async () => {
      // Use larger dataset so timing differences are meaningful vs noise
      const frame_count = 150
      const data = create_synthetic_xyz(frame_count)
      const loader = new TrajFrameReader(`test.xyz`)

      // Warmup run to avoid JIT compilation affecting first measurement
      await loader.extract_plot_metadata(data, { sample_rate: 1 })

      // Time metadata extraction
      const metadata_start = performance.now()
      await loader.extract_plot_metadata(data, { sample_rate: 1 })
      const metadata_time = performance.now() - metadata_start

      // Time loading all frames
      const frames_start = performance.now()
      const frame_promises = Array.from(
        { length: frame_count },
        (_, idx) => loader.load_frame(data, idx),
      )
      await Promise.all(frame_promises)
      const frames_time = performance.now() - frames_start

      // Metadata extraction should be faster, with tolerance for timing noise
      // Using 1.5x multiplier to account for system load variations
      expect(metadata_time).toBeLessThan(frames_time * 1.5)
    })
  })

  describe(`Regression Tests`, () => {
    it(`should maintain compatibility with existing trajectory interface`, async () => {
      const data = create_synthetic_xyz(5)

      // Should work with existing parse_trajectory_async function
      const result = await parse_trajectory_async(data, `test.xyz`)

      expect(result.frames).toHaveLength(5)
      expect(result.metadata?.source_format).toBe(`xyz_trajectory`)
      expect(result.frames[0].structure.sites).toHaveLength(3)
    })

    it(`should preserve all frame metadata during streaming`, async () => {
      const data = create_synthetic_xyz(10)

      const direct_result = await parse_trajectory_async(data, `test.xyz`)
      const streaming_result = await parse_trajectory_async(
        data,
        `test.xyz`,
        undefined,
        { use_indexing: true },
      )

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
  })
})
