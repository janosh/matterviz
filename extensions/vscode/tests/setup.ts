import { vi } from 'vitest'

vi.mock(`fs`)

vi.mock(`path`, () => ({
  basename: vi.fn((file_path) => file_path.split(`/`).pop() || ``),
  join: vi.fn((...segments) => segments.join(`/`)),
}))
