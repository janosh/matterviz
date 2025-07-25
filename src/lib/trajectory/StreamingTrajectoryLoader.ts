// StreamingTrajectoryLoader - Video player style streaming for large trajectory files
import type { TrajectoryFrame } from './index'
import type { ParseProgress } from './parse'
import { create_metadata_extractor } from './StreamingParsers'

export interface StreamingOptions {
  buffer_size?: number // Number of frames to keep in buffer (default: 20)
  prefetch_ahead?: number // Frames to prefetch ahead of current position (default: 5)
  index_sample_rate?: number // Sample every N frames for indexing (default: 100)
}

export interface FrameIndex {
  frame_number: number
  byte_offset: number
  estimated_size: number
}

export interface StreamingMetadata {
  total_frames: number
  file_size: number
  source_format: string
  filename: string
  indexed_frames: number
  estimated_frame_size: number
  seekable: boolean
  // Full trajectory metadata for plots (extracted without coordinates)
  all_metadata?: import('./StreamingParsers').TrajectoryMetadata[]
}

export interface StreamingTrajectoryData {
  metadata: StreamingMetadata
  seek_to_frame: (frame_index: number) => Promise<void>
  get_current_frame: () => TrajectoryFrame | null
  preload_around: (center_frame: number) => Promise<void>
  cleanup_buffer: () => void
  get_buffer_info: () => { buffered_frames: number[]; current_position: number }
  extract_all_metadata: (sample_rate?: number) => Promise<void>
}

// Frame parser interface for different formats
export interface StreamingFrameParser {
  get_total_frames: (data: string | ArrayBuffer, filename?: string) => Promise<number>
  build_frame_index: (
    data: string | ArrayBuffer,
    sample_rate: number,
    on_progress?: (progress: ParseProgress) => void,
  ) => Promise<FrameIndex[]>
  parse_single_frame: (
    data: string | ArrayBuffer,
    frame_number: number,
    frame_index?: FrameIndex[],
  ) => Promise<TrajectoryFrame | null>
}

export class StreamingTrajectoryLoader {
  private data: string | ArrayBuffer
  private filename: string
  private parser: StreamingFrameParser
  private options: Required<StreamingOptions>
  private metadata: StreamingMetadata
  private frame_index: FrameIndex[] = []
  private frame_buffer: Map<number, TrajectoryFrame> = new Map()
  private current_position: number = 0
  private loading_frames: Set<number> = new Set()

  constructor(
    data: string | ArrayBuffer,
    filename: string,
    parser: StreamingFrameParser,
    options: StreamingOptions = {},
  ) {
    this.data = data
    this.filename = filename
    this.parser = parser
    this.options = {
      buffer_size: options.buffer_size ?? 20,
      prefetch_ahead: options.prefetch_ahead ?? 5,
      index_sample_rate: options.index_sample_rate ?? 100,
    }

    // Initialize metadata (will be populated by initialize())
    this.metadata = {
      total_frames: 0,
      file_size: data instanceof ArrayBuffer ? data.byteLength : data.length,
      source_format: `unknown`,
      filename,
      indexed_frames: 0,
      estimated_frame_size: 0,
      seekable: false,
    }
  }

  // Initialize the streaming loader
  async initialize(on_progress?: (progress: ParseProgress) => void): Promise<void> {
    // Step 1: Get total frame count
    on_progress?.({
      current: 10,
      total: 100,
      stage: `Counting frames...`,
    })

    const total_frames = await this.parser.get_total_frames(this.data, this.filename)
    this.metadata.total_frames = total_frames

    // Step 2: Build frame index for seeking
    on_progress?.({
      current: 30,
      total: 100,
      stage: `Building frame index...`,
    })

    this.frame_index = await this.parser.build_frame_index(
      this.data,
      this.options.index_sample_rate,
      (indexProgress) => {
        const adjusted_progress = 30 + (indexProgress.current / 100) * 50
        on_progress?.({
          current: adjusted_progress,
          total: 100,
          stage: `Building frame index: ${indexProgress.stage}`,
        })
      },
    )

    this.metadata.indexed_frames = this.frame_index.length

    if (this.frame_index.length > 1) {
      this.metadata.estimated_frame_size =
        (this.frame_index[this.frame_index.length - 1].byte_offset -
          this.frame_index[0].byte_offset) / this.frame_index.length
    } else this.metadata.estimated_frame_size = 1024

    this.metadata.seekable = this.frame_index.length > 0

    on_progress?.({
      current: 100,
      total: 100,
      stage: `Ready: ${total_frames} frames, ${this.frame_index.length} indexed`,
    })

    console.log(
      `Streaming loader initialized: ${total_frames} frames, ${this.frame_index.length} indexed points`,
    )
  }

  // Seek to a specific frame (like video player)
  async seek_to_frame(frame_number: number): Promise<void> {
    if (frame_number < 0 || frame_number >= this.metadata.total_frames) {
      throw new Error(
        `Frame ${frame_number} out of range [0, ${this.metadata.total_frames - 1}]`,
      )
    }

    // For ASE files, we need to ensure frame 0 is parsed first to establish atomic numbers
    if (!this.frame_buffer.has(0) && frame_number !== 0) {
      await this.load_frame(0)
    }

    this.current_position = frame_number

    // Clear old buffer if we're seeking far away
    const buffer_frames = Array.from(this.frame_buffer.keys())
    const is_far_seek = buffer_frames.length === 0 ||
      Math.min(...buffer_frames.map((f) => Math.abs(f - frame_number))) >
        this.options.buffer_size

    if (is_far_seek) {
      // Make sure to keep frame 0 if we have it (for ASE atomic numbers)
      const frame_0 = this.frame_buffer.get(0)
      this.frame_buffer.clear()
      if (frame_0) {
        this.frame_buffer.set(0, frame_0)
      }
    }

    // Load the requested frame immediately
    await this.load_frame(frame_number)

    // Start prefetching frames around the new position
    this.prefetch_around_position(frame_number)
  }

  // Get the current frame
  get_current_frame(): TrajectoryFrame | null {
    return this.frame_buffer.get(this.current_position) || null
  }

  // Preload frames around a position
  async preload_around(center_frame: number): Promise<void> {
    this.prefetch_around_position(center_frame)
  }

  // Load a specific frame
  private async load_frame(frame_number: number): Promise<void> {
    if (this.frame_buffer.has(frame_number) || this.loading_frames.has(frame_number)) {
      return
    }

    this.loading_frames.add(frame_number)

    try {
      const frame = await this.parser.parse_single_frame(
        this.data,
        frame_number,
        this.frame_index,
      )

      if (frame) {
        this.frame_buffer.set(frame_number, frame)
        this.cleanup_old_frames()
      }
    } catch (error) {
      console.error(`Failed to load frame ${frame_number}:`, error)
    } finally {
      this.loading_frames.delete(frame_number)
    }
  }

  // Prefetch frames around current position
  private prefetch_around_position(center: number): void {
    // Simple approach: load frames before and after current position
    const half_buffer = Math.floor(this.options.buffer_size / 2)
    const start = Math.max(0, center - half_buffer)
    const end = Math.min(
      this.metadata.total_frames - 1,
      center + this.options.prefetch_ahead,
    )

    for (let frame_num = start; frame_num <= end; frame_num++) {
      if (
        !this.frame_buffer.has(frame_num) &&
        !this.loading_frames.has(frame_num)
      ) {
        // Load in background (don't await to avoid blocking)
        this.load_frame(frame_num).catch(console.error)
      }
    }
  }

  // Clean up old frames to manage memory
  private cleanup_old_frames(): void {
    if (this.frame_buffer.size <= this.options.buffer_size) return

    // Keep frames around current position, remove distant ones
    const half_buffer = Math.floor(this.options.buffer_size / 2)
    const keep_start = this.current_position - half_buffer
    const keep_end = this.current_position + half_buffer

    for (const frame_num of this.frame_buffer.keys()) {
      if (frame_num < keep_start || frame_num > keep_end) {
        this.frame_buffer.delete(frame_num)
      }
    }
  }

  // Clean up all buffers
  cleanup_buffer(): void {
    this.frame_buffer.clear()
    this.loading_frames.clear()
  }

  // Get buffer info for debugging
  get_buffer_info(): { buffered_frames: number[]; current_position: number } {
    return {
      buffered_frames: Array.from(this.frame_buffer.keys()).sort((a, b) => a - b),
      current_position: this.current_position,
    }
  }

  // Extract metadata from all frames for plot generation
  async extract_all_metadata(sample_rate: number = 1): Promise<void> {
    try {
      const extractor = create_metadata_extractor(this.metadata.filename)
      const all_metadata = await extractor.extract_all_metadata(this.data, {
        sample_rate,
      })

      // Update metadata with the extracted data
      this.metadata.all_metadata = all_metadata
      console.log(`Extracted metadata from ${all_metadata.length} frames for plots`)
    } catch (error) {
      console.warn(`Failed to extract all metadata for plots:`, error)
      this.metadata.all_metadata = []
    }
  }

  // Create the data interface
  create_data_interface(): StreamingTrajectoryData {
    return {
      metadata: this.metadata,
      seek_to_frame: (frame_index: number) => this.seek_to_frame(frame_index),
      get_current_frame: () => this.get_current_frame(),
      preload_around: (center_frame: number) => this.preload_around(center_frame),
      cleanup_buffer: () => this.cleanup_buffer(),
      get_buffer_info: () => this.get_buffer_info(),
      extract_all_metadata: (sample_rate?: number) =>
        this.extract_all_metadata(sample_rate),
    }
  }
}

// Helper function to create a streaming trajectory loader
export async function create_streaming_trajectory_loader(
  data: string | ArrayBuffer,
  filename: string,
  parser: StreamingFrameParser,
  options: StreamingOptions = {},
  on_progress?: (progress: ParseProgress) => void,
): Promise<StreamingTrajectoryData> {
  const loader = new StreamingTrajectoryLoader(data, filename, parser, options)
  await loader.initialize(on_progress)
  return loader.create_data_interface()
}
