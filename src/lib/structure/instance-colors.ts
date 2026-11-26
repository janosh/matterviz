import { Color, InstancedBufferAttribute, type Material } from 'three/webgpu'
import { css_to_linear_rgb } from '#lib/scene/colors.js'

const scratch = new Color()
const gray = new Color(0x999999)

// `css` as linear RGB in `target`, faded toward gray for ghosted (image) instances
export const set_instance_color = (target: Color, css: string, ghost = false): Color => {
  target.setRGB(...css_to_linear_rgb(css))
  return ghost ? target.lerp(gray, 0.4) : target
}

// Material opacity, halved for ghosted (image) instances; toggling transparency recompiles
export const set_material_opacity = (material: Material, opacity: number, ghost = false) => {
  const alpha = opacity * (ghost ? 0.5 : 1)
  if (material.transparent !== alpha < 1) material.needsUpdate = true
  material.transparent = alpha < 1
  material.opacity = alpha
  material.visible = alpha > 0
}

// Keep CSS history with the attribute it describes. Geometry cloning copies the GPU data
// once and starts fresh history; pending upload ranges survive multiple edits before render.
export class InstanceColors extends InstancedBufferAttribute {
  private readonly css: string[] = []
  private uniform_color: string | undefined
  private first_changed = Infinity
  private last_changed = -1

  write_color(idx: number, color: string, ghost = false, force = false): void {
    if (!force && color === this.css[idx]) return
    set_instance_color(scratch, color, ghost).toArray(this.array, idx * 3)
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

  // Linear RGB written straight into `array`: upload the drawn range, forget its CSS history
  upload(count: number): void {
    this.css.length = 0
    this.uniform_color = undefined
    this.clearUpdateRanges()
    this.addUpdateRange(0, count * 3)
    this.needsUpdate = true
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
