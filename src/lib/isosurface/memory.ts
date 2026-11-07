// Admission for numerical typed buffers, not a process-heap or GPU-memory measurement.
export class GeometryMemoryError extends Error {
  constructor(
    readonly required_bytes: number,
    readonly budget_bytes: number,
  ) {
    super(
      `Isosurface geometry requires ${required_bytes} bytes; budget is ${budget_bytes} bytes`,
    )
    this.name = 'GeometryMemoryError'
  }
}

// Shared by preparation and every signed/layer mesh in one extraction request.
export class GeometryMemoryBudget {
  readonly limit: number
  used = 0
  peak = 0

  constructor(bytes?: number) {
    this.limit = bytes ?? Infinity
    if (this.limit !== Infinity && (!Number.isSafeInteger(this.limit) || this.limit < 0))
      throw new RangeError(`Geometry memory budget must be a non-negative integer or Infinity`)
  }

  reserve(bytes: number): void {
    const required = this.used + bytes
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(required))
      throw new RangeError(`Invalid geometry allocation size: ${bytes}`)
    if (required > this.limit) throw new GeometryMemoryError(required, this.limit)
    this.used = required
    this.peak = Math.max(this.peak, required)
  }

  release(bytes: number): void {
    this.used -= bytes
  }
}
