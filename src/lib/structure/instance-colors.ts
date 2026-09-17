import { Color, InstancedBufferAttribute } from 'three/webgpu'
import { css_to_linear_rgb } from '$lib/scene/colors'

const scratch = new Color()
const gray = new Color(0x999999)

// Keep CSS history with the attribute it describes. Geometry cloning copies the GPU data
// once and starts fresh history; pending upload ranges survive multiple edits before render.
export class InstanceColors extends InstancedBufferAttribute {
  private readonly css: string[] = []
  private uniform_color: string | undefined
  private first_changed = Infinity
  private last_changed = -1

  write_color(idx: number, color: string, ghost = false, force = false): void {
    if (!force && color === this.css[idx]) return
    scratch.setRGB(...css_to_linear_rgb(color))
    if (ghost) scratch.lerp(gray, 0.4)
    scratch.toArray(this.array, idx * 3)
    this.css[idx] = color
    this.uniform_color = undefined
    this.first_changed = Math.min(this.first_changed, idx)
    this.last_changed = Math.max(this.last_changed, idx)
  }

  flush(count: number): boolean {
    this.css.length = count
    if (this.last_changed < 0) return false
    this.addUpdateRange(
      this.first_changed * 3,
      (this.last_changed - this.first_changed + 1) * 3,
    )
    this.needsUpdate = true
    this.first_changed = Infinity
    this.last_changed = -1
    return true
  }

  fill_color(color: string, count = this.count): boolean {
    if (color === this.uniform_color && count <= this.css.length) return false
    let first = 0
    let last = count - 1
    while (first < count && this.css[first] === color) first++
    while (last > first && this.css[last] === color) last--
    if (first <= last) {
      const rgb = css_to_linear_rgb(color)
      const buffer = this.array
      for (let idx = first; idx <= last; idx++) buffer.set(rgb, idx * 3)
      this.css.length = count
      this.css.fill(color, first, last + 1)
      this.first_changed = Math.min(this.first_changed, first)
      this.last_changed = Math.max(this.last_changed, last)
    }
    this.uniform_color = color
    return this.flush(count)
  }

  override copy(source: this): this {
    super.copy(source)
    this.css.length = 0
    this.uniform_color = undefined
    this.first_changed = Infinity
    this.last_changed = -1
    return this
  }
}
