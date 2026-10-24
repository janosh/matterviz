import { create_camera_flight_editor } from '#lib/scene/camera-flight-editor.svelte.js'
import { orbit_camera_flight } from '#lib/scene/camera-flight.js'
import { describe, expect, it } from 'vitest'
import { pose } from './mount'

const populated_editor = () => {
  const editor = create_camera_flight_editor()
  for (const distance of [10, 20, 30])
    editor.add({ ...pose, position: [0, 0, distance] }, `image-${distance}`)
  return editor
}
type Editor = ReturnType<typeof create_camera_flight_editor>
const times = (editor: Editor) => editor.draft.views.map((view) => view.time)
const thumbnails = (editor: Editor) => editor.draft.views.map((view) => view.thumbnail)

describe(`camera flight editing`, () => {
  it(`keeps thumbnail and view pairs through insertion, reordering, updating and undo`, () => {
    const editor = populated_editor()
    expect(times(editor)).toEqual([0, 5, 10])
    editor.set_duration(12)
    editor.add({ ...pose, position: [0, 0, 15] }, `inserted`, 0)
    expect(times(editor)).toEqual([0, 4, 8, 12])
    expect(editor.selected).toBe(1)
    editor.move(1, 3)
    expect(thumbnails(editor)).toEqual([`image-10`, `image-20`, `image-30`, `inserted`])
    expect(editor.draft.views.map((view) => view.position[2])).toEqual([10, 20, 30, 15])
    expect(editor.selected).toBe(3)
    editor.update(3, { ...pose, zoom: 2 }, `updated`)
    expect(editor.flight.keyframes[3]).toEqual({ ...pose, zoom: 2, time: 12 })
    editor.undo()
    expect(thumbnails(editor)[3]).toBe(`inserted`)
    editor.redo()
    expect(thumbnails(editor)[3]).toBe(`updated`)
    editor.undo()
    editor.remove(3)
    expect(times(editor)).toEqual([0, 6, 12])
    expect(editor.can_redo).toBe(false)
    expect(editor.selected).toBe(2)
    editor.select(0)
    expect(editor.selected).toBe(0)
  })

  it(`preserves custom timing proportions and can return to automatic spacing`, () => {
    const editor = populated_editor()
    editor.set_time(1, 2)
    expect(editor.draft.automatic).toBe(false)
    editor.set_duration(20)
    expect(times(editor)).toEqual([0, 4, 20])
    editor.add(pose, `middle`, 1)
    expect(times(editor)).toEqual([0, 4, 12, 20])
    editor.remove(0)
    expect(times(editor)).toEqual([0, 8, 16])
    expect(editor.draft.duration).toBe(16)
    editor.set_time(2, 24)
    expect(editor.draft.duration).toBe(24)
    editor.set_automatic(true)
    expect(times(editor)).toEqual([0, 12, 24])
    editor.undo()
    expect(times(editor)).toEqual([0, 8, 24])
    editor.set_interpolation(`linear`)
    editor.undo()
    expect(editor.flight.interpolation).toBe(`smooth`)
  })

  it.each([0, -1, NaN, Infinity])(
    `rejects invalid duration %s without changing history`,
    (duration) => {
      const editor = populated_editor()
      const draft = editor.draft
      editor.undo()
      expect(() => editor.set_duration(duration)).toThrow(`Duration`)
      expect(editor.can_redo).toBe(true)
      editor.redo()
      expect(editor.draft).toBe(draft)
    },
  )

  it.each([0, 10, NaN, Infinity])(
    `rejects invalid interior time %s without committing it`,
    (time) => {
      const editor = populated_editor()
      const draft = editor.draft
      expect(() => editor.set_time(1, time)).toThrow(`View 2`)
      expect(editor.draft).toBe(draft)
      expect(() => editor.set_time(0, 1)).toThrow(`View 1`)
    },
  )

  it(`owns imported paths, supports undoing replacement and retains finite endpoint times`, () => {
    const editor = populated_editor()
    const before = editor.draft
    const flight = orbit_camera_flight(pose, 8)
    const images = flight.keyframes.map((_frame, idx) => `orbit-${idx}`)
    editor.load(flight, images)
    expect(editor.flight).toEqual(flight)
    flight.keyframes[0].position[0] = 999
    images[0] = `changed`
    expect(editor.flight.keyframes[0].position).toEqual(pose.position)
    expect(thumbnails(editor)[0]).toBe(`orbit-0`)
    editor.set_duration(Number.MAX_VALUE)
    expect(times(editor).every(Number.isFinite)).toBe(true)
    expect(times(editor).at(-1)).toBe(Number.MAX_VALUE)
    editor.set_automatic(true)
    expect(times(editor).every(Number.isFinite)).toBe(true)
    editor.undo()
    editor.undo()
    editor.undo()
    expect(editor.draft).toBe(before)
  })
})
