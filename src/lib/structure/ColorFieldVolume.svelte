<script lang="ts">
  import { T, useThrelte } from '@threlte/core'
  import {
    BackSide,
    BoxGeometry,
    Matrix4,
    Mesh,
    MeshBasicNodeMaterial,
    Vector2,
    Vector4,
  } from 'three/webgpu'
  import {
    cameraProjectionMatrixInverse,
    cameraWorldMatrix,
    float,
    Fn,
    getViewPosition,
    If,
    Loop,
    max,
    min,
    modelWorldMatrixInverse,
    screenUV,
    texture3D,
    uniform,
    vec3,
    vec4,
  } from 'three/tsl'
  import { ColorFieldTexture, type AtomColorField } from './atom-color-field'
  import { cutaway_bounds, type StructureCutaway } from './cutaway'

  let {
    field,
    opacity = 0.35,
    cutaway,
  }: { field: AtomColorField; opacity?: number; cutaway?: StructureCutaway } = $props()
  const { invalidate } = useThrelte()
  // A single proxy box, independent of atom count. Transparent projection deliberately
  // includes heat behind atoms; maximum opacity keeps the underlying geometry readable.
  const geometry = new BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5)
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: BackSide,
  })
  const texture = new ColorFieldTexture(`linear`)
  const density_texture = texture3D(texture)
  const alpha = uniform(0.35)
  const steps = uniform(48, `int`)
  const clip_enabled = uniform(false)
  const clip_coordinate = uniform(new Vector4())
  const clip_bounds = uniform(new Vector2())
  material.fragmentNode = Fn(() => {
    // Unproject the near/far planes instead of assuming a perspective camera. The
    // model inverse includes the triclinic cell, box origin and manual scene rotation.
    const near_view = getViewPosition(screenUV, float(0), cameraProjectionMatrixInverse)
    const far_view = getViewPosition(screenUV, float(1), cameraProjectionMatrixInverse)
    const to_local = modelWorldMatrixInverse.mul(cameraWorldMatrix)
    const origin = to_local.mul(vec4(near_view, 1)).xyz.toVar()
    const direction = to_local.mul(vec4(far_view, 1)).xyz.sub(origin).normalize().toVar()
    // Avoid 0/0 at a box face when an orthographic ray is parallel to that face.
    const safe_direction = vec3(
      direction.x.abs().max(1e-7).mul(direction.x.lessThan(0).select(-1, 1)),
      direction.y.abs().max(1e-7).mul(direction.y.lessThan(0).select(-1, 1)),
      direction.z.abs().max(1e-7).mul(direction.z.lessThan(0).select(-1, 1)),
    )
    const first = origin.negate().div(safe_direction)
    const last = origin.oneMinus().div(safe_direction)
    const lower = min(first, last)
    const upper = max(first, last)
    const entry = max(max(lower.x, lower.y), max(lower.z, 0)).toVar()
    const exit = min(min(upper.x, upper.y), upper.z).toVar()
    If(clip_enabled, () => {
      const coordinate = clip_coordinate.xyz.dot(origin).add(clip_coordinate.w)
      const slope = clip_coordinate.xyz.dot(direction)
      // Parallel rays either miss the whole slab or keep the original box interval.
      If(slope.abs().lessThan(1e-7), () => {
        coordinate.lessThan(clip_bounds.x).or(coordinate.greaterThan(clip_bounds.y)).discard()
      }).Else(() => {
        const clip_first = clip_bounds.x.sub(coordinate).div(slope)
        const clip_last = clip_bounds.y.sub(coordinate).div(slope)
        entry.assign(max(entry, min(clip_first, clip_last)))
        exit.assign(min(exit, max(clip_first, clip_last)))
      })
    })
    exit.lessThanEqual(entry).discard()
    const step_length = exit.sub(entry).div(float(steps)).toVar()
    const accumulated = vec4(0).toVar()
    Loop({ start: 0, end: steps, type: `int` }, ({ i: step_idx }) => {
      const distance = entry.add(float(step_idx).add(0.5).mul(step_length))
      const position = origin.add(direction.mul(distance))
      // Grid order is (a * nb + b) * nc + c. Premultiplied colors prevent dark
      // fringes when interpolating against unobserved (transparent) bins.
      const sample = density_texture.sample(position.zyx).level(float(0)).toVar()
      const absorption = sample.a.mul(step_length).mul(-3).exp().oneMinus()
      const weight = accumulated.a.oneMinus().mul(absorption)
      accumulated.rgb.addAssign(sample.rgb.div(max(sample.a, 1e-6)).mul(weight))
      accumulated.a.addAssign(weight)
    })
    return vec4(accumulated.rgb.div(max(accumulated.a, 1e-6)), accumulated.a.mul(alpha))
  })()
  const mesh = new Mesh(geometry, material)
  mesh.name = `ColorFieldVolume`
  mesh.matrixAutoUpdate = false
  mesh.frustumCulled = false
  mesh.renderOrder = 1
  // The cloud is visual only; atom picking must reach the spheres underneath it.
  mesh.raycast = () => {}
  const visible = $derived(Number.isFinite(opacity) && opacity > 0)

  $effect(() => {
    if (!visible) return
    const { dims, cartesian_to_fractional } = field
    texture.update(field)
    steps.value = Math.min(192, Math.max(32, 3 * Math.max(...dims)))
    mesh.matrix.copy(cartesian_to_fractional).invert()
    mesh.matrixWorldNeedsUpdate = true
    invalidate()
  })
  $effect(() => {
    alpha.value = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0
    mesh.visible = visible
    invalidate()
  })
  $effect(() => {
    clip_enabled.value = Boolean(cutaway && cutaway.mode !== `off`)
    if (cutaway && clip_enabled.value) {
      // Convert the shared Cartesian cutaway to this volume's local fractional box.
      const transform = new Matrix4()
        .copy(cutaway.cartesian_to_fractional)
        .multiply(field.cartesian_to_fractional.clone().invert())
      const values = transform.elements
      const { axis } = cutaway
      clip_coordinate.value.set(
        values[axis],
        values[axis + 4],
        values[axis + 8],
        values[axis + 12],
      )
      const [lower, upper] = cutaway_bounds(cutaway)
      clip_bounds.value.set(Number.isFinite(lower) ? lower : -1e20, upper)
    }
    invalidate()
  })
  $effect(() => () => {
    geometry.dispose()
    material.dispose()
    texture.dispose()
  })
</script>

<T is={mesh} dispose={false} />
