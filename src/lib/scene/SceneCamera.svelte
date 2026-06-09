<script lang="ts">
  // Dual perspective/orthographic camera with OrbitControls + axis Gizmo, shared by
  // BrillouinZoneScene, FermiSurfaceScene and StructureScene.
  import type { Vec3 } from '$lib/math'
  import { type CameraProjection, DEFAULTS } from '$lib/settings'
  import { T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import type { ComponentProps, Snippet } from 'svelte'
  import { build_gizmo_props, build_orbit_props } from './props'

  let {
    camera_projection = `perspective`,
    position,
    fov = DEFAULTS.structure.fov,
    zoom = DEFAULTS.structure.initial_zoom,
    near = undefined,
    far = undefined,
    orbit_props,
    gizmo = false,
    orbit_controls = $bindable(undefined),
    children,
  }: {
    camera_projection?: CameraProjection
    position: Vec3 // camera position
    fov?: number // perspective field of view
    zoom?: number // orthographic zoom level
    near?: number // perspective near plane (orthographic always uses -100)
    far?: number // far plane (applied to either projection when provided)
    orbit_props: ReturnType<typeof build_orbit_props>
    gizmo?: boolean | ComponentProps<typeof extras.Gizmo>
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`]
    children?: Snippet // extra content rendered inside the active camera
  } = $props()

  const gizmo_props = $derived(build_gizmo_props(gizmo))
  // Only pass clipping planes that were explicitly provided so three.js defaults apply otherwise
  const persp_planes = $derived({
    ...(near !== undefined && { near }),
    ...(far !== undefined && { far }),
  })
  const ortho_far = $derived(far !== undefined ? { far } : {})
</script>

{#if camera_projection === `perspective`}
  <T.PerspectiveCamera makeDefault {position} {fov} {...persp_planes}>
    <extras.OrbitControls bind:ref={orbit_controls} {...orbit_props}>
      {#if gizmo}<extras.Gizmo {...gizmo_props} />{/if}
    </extras.OrbitControls>
    {@render children?.()}
  </T.PerspectiveCamera>
{:else}
  <T.OrthographicCamera makeDefault {position} {zoom} near={-100} {...ortho_far}>
    <extras.OrbitControls bind:ref={orbit_controls} {...orbit_props}>
      {#if gizmo}<extras.Gizmo {...gizmo_props} />{/if}
    </extras.OrbitControls>
    {@render children?.()}
  </T.OrthographicCamera>
{/if}
