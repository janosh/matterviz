<script lang="ts">
  // Orientation gizmo: colored +/- axis handles in a corner of the canvas showing camera
  // orientation, clickable to fly the camera to that axis. Replaces @threlte/extras' Gizmo,
  // which delegates to three-viewport-gizmo and its raw GLSL ShaderMaterials — those can't
  // compile on WebGPU, while the materials below map to node materials automatically.
  // Like upstream it draws into a corner viewport of the *existing* canvas after the main
  // render, so it costs no extra canvas and stays out of PNG exports (scene+camera only).
  import type { Vec3 } from '$lib/math'
  import { useParent, useTask, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import * as THREE from 'three/webgpu'
  import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
  import { create_fly_to, DEFAULT_FLY_TO_DURATION_MS } from './fly-to'
  import type { GizmoAxisKey, GizmoAxisStyle, GizmoOptions } from './gizmo'
  import { GIZMO_AXES, GIZMO_DEFAULT_STYLES, GIZMO_LAYOUT, gizmo_rect } from './gizmo'

  let {
    visible = true,
    placement,
    size,
    offset,
    animation_duration = DEFAULT_FLY_TO_DURATION_MS,
    fade_duration = 200,
    on_start,
    on_change,
    on_end,
    ...axis_styles
  }: GizmoOptions & {
    on_start?: () => void
    on_change?: () => void
    on_end?: () => void
  } = $props()

  const {
    autoRenderTask,
    camera,
    dom,
    invalidate,
    renderer,
    size: canvas_size,
  } = useThrelte<THREE.WebGPURenderer>()
  // The orbit controls are the parent object, matching upstream's <OrbitControls><Gizmo /> nesting
  const parent = useParent()
  const active_controls = $derived($parent as OrbitControls | undefined)

  const gizmo_scene = new THREE.Scene()
  const gizmo_camera = new THREE.OrthographicCamera(
    -GIZMO_LAYOUT.frustum,
    GIZMO_LAYOUT.frustum,
    GIZMO_LAYOUT.frustum,
    -GIZMO_LAYOUT.frustum,
    0.1,
    GIZMO_LAYOUT.cam_distance * 2,
  )

  // Cache per letter+color so hover recolors don't allocate a texture every pointer move
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
    // Opacity before the fade multiplier; the render task scales this by `fade` each frame.
    base_opacity: number
  }

  const handles: Handle[] = GIZMO_AXES.map(([axis, dir, negative]) => {
    const radius = negative ? GIZMO_LAYOUT.neg_handle_radius : GIZMO_LAYOUT.handle_radius
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 16),
      new THREE.MeshBasicMaterial({ transparent: true }),
    )
    mesh.position.set(...dir)
    gizmo_scene.add(mesh)

    const handle: Handle = { axis, dir, negative, mesh, base_opacity: 1 }

    if (!negative) {
      // A cylinder, not a Line: line widths above 1px aren't portable across backends
      const ax_line_radius = GIZMO_LAYOUT.axis_line_radius
      const line = new THREE.Mesh(
        new THREE.CylinderGeometry(ax_line_radius, ax_line_radius, 1, 12),
        new THREE.MeshBasicMaterial({ transparent: true }),
      )
      // Cylinders are built along +Y; point it down the axis and center it on the stem.
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir))
      line.position.set(dir[0] / 2, dir[1] / 2, dir[2] / 2)
      gizmo_scene.add(line)
      handle.line = line

      // depthWrite off + the per-frame nudge in sync_gizmo_camera keeps each letter on top of
      // its own sphere while still being occluded by nearer handles
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

  const handle_meshes = handles.map((handle) => handle.mesh)

  let hovered: GizmoAxisKey | null = $state(null)

  // Only frame tasks use fade, so keep it non-reactive. untrack so mounting visible starts
  // opaque instead of fading in; later changes advance in the update task.
  let fade = untrack(() => (visible ? 1 : 0))

  // Drop a stuck highlight if the gizmo is hidden mid-hover (pointer events stop resolving).
  $effect(() => {
    if (!visible) hovered = null
  })

  // Resolve each handle's appearance from props + hover state onto the three objects
  $effect(() => {
    for (const handle of handles) {
      const defaults = GIZMO_DEFAULT_STYLES[handle.axis]
      const overrides =
        (axis_styles as Partial<Record<GizmoAxisKey, GizmoAxisStyle>>)[handle.axis] ?? {}
      const style = { ...defaults, ...overrides }
      // Hovering swaps in the hover variant of each field, but a caller's explicit color or
      // opacity still wins over the default hover — else a custom axis color would flip to
      // the stock tint on hover. The stem keeps its base color either way.
      const shown =
        hovered === handle.axis
          ? { ...defaults.hover, ...overrides, ...overrides.hover }
          : style

      handle.mesh.material.color.set(shown.color ?? `#888888`)
      handle.base_opacity = shown.opacity ?? 1
      if (handle.line) handle.line.material.color.set(style.color ?? `#888888`)

      if (handle.label) {
        const letter = style.label ?? handle.axis.toUpperCase()
        handle.label.material.map = label_texture(letter, shown.labelColor ?? `#111`)
        handle.label.material.needsUpdate = true
      }
    }
    invalidate()
  })

  const rect = $derived(
    gizmo_rect({ placement, size, offset }, $canvas_size.width, $canvas_size.height),
  )

  // Point the gizmo camera like the scene camera so handles read as the scene's world axes.
  // Distance is fixed; the ortho frustum sets the on-screen size.
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
  }

  // Camera fly-to, shared with the zone-axis control (see $lib/scene/fly-to)
  const fly_to = create_fly_to({
    camera: () => $camera,
    controls: () => active_controls,
    duration_ms: () => animation_duration,
    invalidate,
    on_start: () => on_start?.(),
    on_change: () => on_change?.(),
    on_end: () => on_end?.(),
  })

  const raycaster = new THREE.Raycaster()
  const pointer_ndc = new THREE.Vector2()

  // The handle under the pointer, or null when outside the gizmo box or off every handle.
  function pick_handle(event: PointerEvent): Handle | null {
    const canvas = renderer?.domElement
    if (!visible || !canvas) return null
    const bounds = canvas.getBoundingClientRect()
    const px = event.clientX - bounds.left
    const py = event.clientY - bounds.top
    const { x, y, width, height } = rect
    if (px < x || px > x + width || py < y || py > y + height) return null

    pointer_ndc.set(((px - x) / width) * 2 - 1, -(((py - y) / height) * 2 - 1))
    sync_gizmo_camera()
    raycaster.setFromCamera(pointer_ndc, gizmo_camera)
    const hit = raycaster.intersectObjects(handle_meshes, false)[0]
    return handles.find((handle) => handle.mesh === hit?.object) ?? null
  }

  // Which handle the press started on — a click only counts if press and release agree,
  // and only then do we swallow the event so orbiting still works everywhere else.
  let pressed: Handle | null = null

  function handle_pointer_move(event: PointerEvent) {
    const next = fly_to.active ? null : (pick_handle(event)?.axis ?? null)
    if (next !== hovered) {
      hovered = next
      invalidate()
    }
  }

  function handle_pointer_down(event: PointerEvent) {
    pressed = pick_handle(event)
    if (pressed) event.stopPropagation() // don't let OrbitControls start a drag
  }

  function handle_pointer_up(event: PointerEvent) {
    if (pressed && pick_handle(event) === pressed) {
      event.stopPropagation()
      fly_to.start(pressed.dir)
    }
    pressed = null
  }

  function handle_pointer_leave() {
    if (hovered === null) return
    hovered = null
    invalidate()
  }

  // The gizmo has no DOM element to hang a CSS :hover rule on, so drive the canvas cursor
  // directly and restore whatever the host had set once the pointer moves off.
  $effect(() => {
    const canvas = renderer?.domElement
    if (!canvas || !hovered) return
    const prev_cursor = canvas.style.cursor
    canvas.style.cursor = `pointer`
    return () => {
      canvas.style.cursor = prev_cursor
    }
  })

  // Capture phase on the container (not the canvas) so these run before OrbitControls' own
  // canvas listeners, letting handle clicks be swallowed before a drag starts.
  $effect(() => {
    const container = dom
    if (!container) return
    const controller = new AbortController()
    const opts = { capture: true, signal: controller.signal } as const
    const listeners = [
      [`pointermove`, handle_pointer_move],
      [`pointerdown`, handle_pointer_down],
      [`pointerup`, handle_pointer_up],
      [`pointerleave`, handle_pointer_leave],
    ] as const
    for (const [type, fn] of listeners) container.addEventListener(type, fn, opts)
    return () => controller.abort()
  })

  const prev_viewport = new THREE.Vector4()
  const prev_scissor = new THREE.Vector4()

  // Advance animations in the main stage, which runs even when rendering is idle.
  // Invalidating inside the gated render stage is too late: Threlte clears that flag at
  // frame end, so fades would only advance when another event (such as atom hover) redraws.
  useTask(
    Symbol(`matterviz-gizmo-update`),
    (delta) => {
      // Let an in-flight fly-to finish even if the gizmo was hidden mid-animation.
      fly_to.step(delta)

      const target = visible ? 1 : 0
      if (fade !== target) {
        const step = fade_duration > 0 ? (delta * 1000) / fade_duration : 1
        fade = target > fade ? Math.min(target, fade + step) : Math.max(target, fade - step)
        // This task opts out of auto-invalidation, so drive frames until the fade lands —
        // above all the frame reaching 0, which is the one that repaints the gizmo away.
        invalidate()
      }
    },
    { autoInvalidate: false },
  )

  useTask(
    Symbol(`matterviz-gizmo-render`),
    () => {
      // `initialized` guards the frames before the GPU device resolves; render() throws then.
      // A pre-layout 0x0 canvas has nowhere to draw, and WebGPU rejects an empty viewport.
      if (fade <= 0 || rect.width <= 0 || rect.height <= 0) return
      if (!renderer?.initialized) return

      for (const handle of handles) {
        handle.mesh.material.opacity = handle.base_opacity * fade
        if (handle.line) handle.line.material.opacity = handle.base_opacity * fade
        if (handle.label) handle.label.material.opacity = fade
      }

      sync_gizmo_camera()

      renderer.getViewport(prev_viewport)
      renderer.getScissor(prev_scissor)
      const prev_scissor_test = renderer.getScissorTest()
      const prev_auto_clear = renderer.autoClear

      // Restore in `finally`: these are renderer-wide, so a throw escaping mid-frame would
      // leave every later main-scene render clipped to this corner and never clearing.
      try {
        // Draw over the frame the main pass just produced instead of clearing it, but reset
        // depth so scene geometry can't occlude the gizmo.
        renderer.autoClear = false
        renderer.setViewport(rect.x, rect.y, rect.width, rect.height)
        renderer.setScissor(rect.x, rect.y, rect.width, rect.height)
        renderer.setScissorTest(true)
        renderer.clearDepth()
        renderer.render(gizmo_scene, gizmo_camera)
      } finally {
        renderer.setScissorTest(prev_scissor_test)
        renderer.setScissor(prev_scissor)
        renderer.setViewport(prev_viewport)
        renderer.autoClear = prev_auto_clear
      }
    },
    { after: autoRenderTask, autoInvalidate: false },
  )

  $effect(() => () => {
    // A fly-to disables orbiting until it finishes. Unmounting mid-flight (e.g. the `gizmo`
    // prop flips false) would otherwise strand the host's controls disabled for good.
    fly_to.release()
    for (const { mesh, label, line } of handles) {
      mesh.geometry.dispose()
      mesh.material.dispose()
      line?.geometry.dispose()
      line?.material.dispose()
      label?.material.dispose()
    }
    for (const texture of label_textures.values()) texture.dispose()
    label_textures.clear()
  })
</script>
