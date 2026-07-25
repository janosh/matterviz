<script lang="ts">
  // Orientation gizmo: colored +/- axis handles in a corner of the canvas that show the
  // current camera orientation and fly the camera to an axis when clicked.
  //
  // Replaces @threlte/extras' Gizmo, which cannot run here: it delegates to
  // three-viewport-gizmo, whose handles are raw GLSL ShaderMaterials built from
  // ShaderLib/UniformsLib. WebGPURenderer compiles node materials, not GLSL, and our build
  // aliases bare `three` to the WebGPU shim where those registries are stubbed. Everything
  // below is drawn with MeshBasicMaterial/SpriteMaterial, which three maps to node
  // materials automatically, so it renders identically on either backend.
  //
  // Like the upstream component this draws into a corner viewport of the *existing* canvas
  // after the main render, so it costs no extra canvas and stays out of PNG exports (which
  // re-render scene+camera only).
  import type { Vec3 } from '$lib/math'
  import { useParent, useTask, useThrelte } from '@threlte/core'
  import * as THREE from 'three/webgpu'
  import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
  import {
    GIZMO_AXES,
    type GizmoAxisKey,
    type GizmoAxisStyle,
    GIZMO_DEFAULT_COLORS,
    GIZMO_LAYOUT,
    type GizmoOptions,
  } from './gizmo'

  let {
    visible = true,
    placement = `bottom-left`,
    size,
    offset = {},
    background = { enabled: false },
    animation_duration = 400,
    controls,
    onstart,
    onchange,
    onend,
    ...axis_styles
  }: GizmoOptions & {
    // Defaults to the parent object, matching upstream's <OrbitControls><Gizmo /> nesting.
    controls?: OrbitControls
    onstart?: () => void
    onchange?: () => void
    onend?: () => void
  } = $props()

  const threlte = useThrelte<THREE.WebGPURenderer>()
  const {
    autoRenderTask,
    camera,
    dom,
    invalidate,
    renderer,
    shouldRender,
    size: canvas_size,
  } = threlte
  const parent = useParent()
  const active_controls = $derived(controls ?? ($parent as OrbitControls | undefined))

  const gizmo_scene = new THREE.Scene()
  const gizmo_camera = new THREE.OrthographicCamera(
    -GIZMO_LAYOUT.frustum,
    GIZMO_LAYOUT.frustum,
    GIZMO_LAYOUT.frustum,
    -GIZMO_LAYOUT.frustum,
    0.1,
    GIZMO_LAYOUT.cam_distance * 2,
  )

  // Label sprites are tiny canvas textures; cache per letter+color so hover recolors don't
  // allocate a new texture every pointer move.
  const label_textures = new Map<string, THREE.CanvasTexture>()

  function label_texture(letter: string, color: string): THREE.CanvasTexture {
    const key = `${letter}|${color}`
    const cached = label_textures.get(key)
    if (cached) return cached
    const canvas = document.createElement(`canvas`)
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext(`2d`)
    if (ctx) {
      ctx.fillStyle = color
      ctx.font = `bold 92px system-ui, sans-serif`
      ctx.textAlign = `center`
      ctx.textBaseline = `middle`
      ctx.fillText(letter, 64, 70)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    label_textures.set(key, texture)
    return texture
  }

  type Handle = {
    axis: GizmoAxisKey
    dir: Vec3
    negative: boolean
    mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
    label?: THREE.Sprite
    line?: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
  }

  const handles: Handle[] = GIZMO_AXES.map(([axis, dir, negative]) => {
    const radius = negative ? GIZMO_LAYOUT.neg_handle_radius : GIZMO_LAYOUT.handle_radius
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 16),
      new THREE.MeshBasicMaterial({ transparent: true }),
    )
    mesh.position.set(...dir)
    gizmo_scene.add(mesh)

    const handle: Handle = { axis, dir, negative, mesh }

    if (!negative) {
      // Stem from origin to the handle. A cylinder (not a Line) so width is in world units
      // and stays visible — line widths above 1px are not portable across backends.
      const line = new THREE.Mesh(
        new THREE.CylinderGeometry(
          GIZMO_LAYOUT.axis_line_radius,
          GIZMO_LAYOUT.axis_line_radius,
          1,
          12,
        ),
        new THREE.MeshBasicMaterial({ transparent: true }),
      )
      // Cylinders are built along +Y; point it down the axis and center it on the stem.
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir))
      line.position.set(dir[0] / 2, dir[1] / 2, dir[2] / 2)
      gizmo_scene.add(line)
      handle.line = line

      // depthWrite off + a per-frame nudge toward the camera (see sync_gizmo_camera) keeps
      // each letter on top of its own sphere while still being occluded by nearer handles.
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({ transparent: true, depthWrite: false }),
      )
      label.position.set(...dir)
      label.scale.setScalar(GIZMO_LAYOUT.label_scale)
      label.renderOrder = 1
      gizmo_scene.add(label)
      handle.label = label
    }
    return handle
  })

  // Optional disc behind the handles. Drawn first with depth disabled so it never occludes
  // handles regardless of how the camera swings around.
  const backdrop = new THREE.Mesh(
    new THREE.CircleGeometry(GIZMO_LAYOUT.frustum, 48),
    new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }),
  )
  backdrop.renderOrder = -1
  gizmo_scene.add(backdrop)

  let hovered: GizmoAxisKey | null = $state(null)

  // Drop a stuck highlight if the gizmo is hidden mid-hover (pointer events stop resolving).
  $effect(() => {
    if (!visible) hovered = null
  })

  // Resolve each handle's current appearance from props + hover state, then push it onto the
  // three objects. Reading `hovered` and `axis_styles` here keeps this reactive to both.
  $effect(() => {
    for (const handle of handles) {
      const style =
        (axis_styles as Partial<Record<GizmoAxisKey, GizmoAxisStyle>>)[handle.axis] ?? {}
      const is_hovered = hovered === handle.axis
      const hover = style.hover ?? {}
      const fallback = GIZMO_DEFAULT_COLORS[handle.axis]
      const color = is_hovered
        ? (hover.color ?? fallback.hover)
        : (style.color ?? fallback.color)
      const opacity =
        (is_hovered ? hover.opacity : undefined) ??
        style.opacity ??
        (handle.negative ? 0.9 : 1)

      handle.mesh.material.color.set(color)
      handle.mesh.material.opacity = opacity
      if (handle.line) {
        handle.line.material.color.set(style.color ?? color)
        handle.line.material.opacity = opacity
      }

      if (handle.label) {
        const letter = style.label ?? handle.axis.toUpperCase()
        const label_color =
          (is_hovered ? hover.labelColor : undefined) ?? style.labelColor ?? `#111111`
        handle.label.material.map = label_texture(letter, label_color)
        handle.label.material.needsUpdate = true
      }
    }
    backdrop.visible = background.enabled ?? false
    backdrop.material.color.set(background.color ?? `#000000`)
    backdrop.material.opacity = background.opacity ?? 0.2
    invalidate()
  })

  // Where the gizmo draws, in CSS px measured from the canvas's top-left — the origin both
  // Renderer.setViewport/setScissor and pointer coordinates use.
  const rect = $derived.by(() => {
    const { width, height } = $canvas_size
    if (placement === `fill`) return { x: 0, y: 0, width, height }
    // Unsized gizmos scale with the viewport, reproducing the clamp(70px, 18cqmin, 100px)
    // the old DOM-based gizmo got from CSS.
    const responsive = Math.min(100, Math.max(70, 0.18 * Math.min(width, height)))
    const box = Math.min(size ?? responsive, width, height)
    const gap = 5
    const x = placement.endsWith(`-left`)
      ? (offset.left ?? gap)
      : width - box - (offset.right ?? gap)
    const y = placement.startsWith(`top`)
      ? (offset.top ?? gap)
      : height - box - (offset.bottom ?? gap)
    return { x, y, width: box, height: box }
  })

  // Point the gizmo camera the same way as the scene camera so the handles read as the
  // scene's world axes. Distance is fixed; the ortho frustum sets the on-screen size.
  const ORIGIN = new THREE.Vector3()
  const view_dir = new THREE.Vector3()
  const label_nudge = new THREE.Vector3()

  function sync_gizmo_camera() {
    const main_camera = $camera
    if (!main_camera) return
    view_dir.subVectors(main_camera.position, active_controls?.target ?? ORIGIN)
    if (view_dir.lengthSq() === 0) view_dir.set(0, 0, 1)
    view_dir.normalize()
    gizmo_camera.position.copy(view_dir).multiplyScalar(GIZMO_LAYOUT.cam_distance)
    gizmo_camera.up.copy(main_camera.up)
    gizmo_camera.lookAt(ORIGIN)
    gizmo_camera.updateMatrixWorld()

    label_nudge.copy(view_dir).multiplyScalar(GIZMO_LAYOUT.handle_radius + 0.02)
    for (const { dir, label } of handles) {
      label?.position.set(...dir).add(label_nudge)
    }
    backdrop.quaternion.copy(gizmo_camera.quaternion)
  }

  // Camera fly-to. Interpolating the offset from the orbit target (rather than the absolute
  // position) keeps the distance constant while the direction swings around.
  let animation: { from: THREE.Vector3; to: THREE.Vector3; elapsed: number } | null = null

  function start_fly_to(dir: Vec3) {
    const main_camera = $camera
    if (!main_camera) return
    const target = active_controls?.target ?? new THREE.Vector3()
    const distance = main_camera.position.distanceTo(target) || 1
    const to = new THREE.Vector3(...dir).multiplyScalar(distance)
    // Looking straight down the camera's up vector is degenerate for OrbitControls (polar
    // angle 0), so tilt off-axis by a hair to keep a stable frame.
    if (Math.abs(to.clone().normalize().dot(main_camera.up)) > 0.999) {
      const nudge =
        Math.abs(main_camera.up.z) > 0.5
          ? new THREE.Vector3(0, 1e-3, 0)
          : new THREE.Vector3(0, 0, 1e-3)
      to.add(nudge.multiplyScalar(distance))
    }
    animation = {
      from: main_camera.position.clone().sub(target),
      to,
      elapsed: 0,
    }
    if (active_controls) active_controls.enabled = false
    onstart?.()
    invalidate()
  }

  const ease_in_out = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
  const lerped = new THREE.Vector3()

  function step_animation(delta: number) {
    if (!animation) return
    const main_camera = $camera
    if (!main_camera) return
    animation.elapsed += delta * 1000
    const progress =
      animation_duration > 0 ? Math.min(1, animation.elapsed / animation_duration) : 1
    const target = active_controls?.target ?? new THREE.Vector3()
    lerped.copy(animation.from).lerp(animation.to, ease_in_out(progress))
    main_camera.position.copy(target).add(lerped)
    main_camera.lookAt(target)
    active_controls?.update()
    onchange?.()
    invalidate()
    if (progress >= 1) {
      animation = null
      if (active_controls) active_controls.enabled = true
      onend?.()
    }
  }

  const raycaster = new THREE.Raycaster()
  const pointer_ndc = new THREE.Vector2()

  // Pointer position within the gizmo box, or null when outside it.
  function to_gizmo_ndc(event: PointerEvent): THREE.Vector2 | null {
    const canvas = renderer?.domElement
    if (!canvas) return null
    const bounds = canvas.getBoundingClientRect()
    const px = event.clientX - bounds.left
    const py = event.clientY - bounds.top
    const { x, y, width, height } = rect
    if (px < x || px > x + width || py < y || py > y + height) return null
    pointer_ndc.set(((px - x) / width) * 2 - 1, -(((py - y) / height) * 2 - 1))
    return pointer_ndc
  }

  function pick_axis(event: PointerEvent): GizmoAxisKey | null {
    if (!visible) return null
    const ndc = to_gizmo_ndc(event)
    if (!ndc) return null
    sync_gizmo_camera()
    raycaster.setFromCamera(ndc, gizmo_camera)
    const hit = raycaster.intersectObjects(
      handles.map((handle) => handle.mesh),
      false,
    )[0]
    if (!hit) return null
    return handles.find((handle) => handle.mesh === hit.object)?.axis ?? null
  }

  // Which handle the press started on — a click only counts if press and release agree,
  // and only then do we swallow the event so orbiting still works everywhere else.
  let pressed: GizmoAxisKey | null = null

  function handle_pointer_move(event: PointerEvent) {
    const next = animation ? null : pick_axis(event)
    if (next !== hovered) {
      hovered = next
      invalidate()
    }
  }

  function handle_pointer_down(event: PointerEvent) {
    pressed = pick_axis(event)
    // Keep OrbitControls (which listens on the canvas itself) from starting a drag. The
    // listener is registered on the container in the capture phase so it runs first.
    if (pressed) event.stopPropagation()
  }

  function handle_pointer_up(event: PointerEvent) {
    const released = pick_axis(event)
    if (pressed && released === pressed) {
      event.stopPropagation()
      const handle = handles.find((entry) => entry.axis === pressed)
      if (handle) start_fly_to(handle.dir)
    }
    pressed = null
  }

  function handle_pointer_leave() {
    if (hovered === null) return
    hovered = null
    invalidate()
  }

  $effect(() => {
    const container = dom
    if (!container) return
    const opts = { capture: true } as const
    container.addEventListener(`pointermove`, handle_pointer_move, opts)
    container.addEventListener(`pointerdown`, handle_pointer_down, opts)
    container.addEventListener(`pointerup`, handle_pointer_up, opts)
    container.addEventListener(`pointerleave`, handle_pointer_leave, opts)
    return () => {
      container.removeEventListener(`pointermove`, handle_pointer_move, opts)
      container.removeEventListener(`pointerdown`, handle_pointer_down, opts)
      container.removeEventListener(`pointerup`, handle_pointer_up, opts)
      container.removeEventListener(`pointerleave`, handle_pointer_leave, opts)
    }
  })

  const prev_viewport = new THREE.Vector4()
  const prev_scissor = new THREE.Vector4()

  useTask(
    Symbol(`matterviz-gizmo-render`),
    (delta) => {
      // Let an in-flight fly-to finish even if the gizmo was hidden mid-animation.
      step_animation(delta)
      // `initialized` guards the frames before the GPU device resolves; render() throws then.
      if (!visible || !shouldRender() || !renderer?.initialized) return

      sync_gizmo_camera()

      renderer.getViewport(prev_viewport)
      renderer.getScissor(prev_scissor)
      const prev_scissor_test = renderer.getScissorTest()
      const prev_auto_clear = renderer.autoClear

      // Draw over the frame the main pass just produced instead of clearing it, but reset
      // depth so scene geometry can't occlude the gizmo.
      renderer.autoClear = false
      renderer.setViewport(rect.x, rect.y, rect.width, rect.height)
      renderer.setScissor(rect.x, rect.y, rect.width, rect.height)
      renderer.setScissorTest(true)
      renderer.clearDepth()
      renderer.render(gizmo_scene, gizmo_camera)

      renderer.setScissorTest(prev_scissor_test)
      renderer.setScissor(prev_scissor)
      renderer.setViewport(prev_viewport)
      renderer.autoClear = prev_auto_clear
    },
    { after: autoRenderTask, autoInvalidate: false },
  )

  $effect(() => () => {
    for (const { mesh, label, line } of handles) {
      mesh.geometry.dispose()
      mesh.material.dispose()
      line?.geometry.dispose()
      line?.material.dispose()
      label?.material.dispose()
    }
    backdrop.geometry.dispose()
    backdrop.material.dispose()
    for (const texture of label_textures.values()) texture.dispose()
    label_textures.clear()
  })
</script>
