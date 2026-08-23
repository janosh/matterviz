<script lang="ts">
  // Dual perspective/orthographic camera with OrbitControls + axis Gizmo, shared by BrillouinZoneScene, FermiSurfaceScene, ChemPotScene3D and StructureScene
  import type { Vec3 } from '$lib/math'
  import { type CameraProjection, DEFAULTS } from '$lib/settings'
  import { T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import type { ComponentProps } from 'svelte'
  import type { GizmoOptions } from './gizmo'
  import Gizmo from './Gizmo.svelte'
  import type { build_orbit_props } from './props.svelte'

  let {
    camera_projection = `perspective`,
    position,
    fov = DEFAULTS.structure.fov,
    zoom = DEFAULTS.structure.initial_zoom,
    near = 0.1,
    ortho_near = -100,
    far = 2000,
    orbit_props,
    gizmo = false,
    orbit_controls = $bindable(undefined),
  }: {
    camera_projection?: CameraProjection
    position: Vec3 // camera position
    fov?: number // perspective field of view
    zoom?: number // orthographic zoom level
    near?: number // perspective near plane (three's default when omitted)
    // Orthographic near plane. The default sits behind the camera so nothing in front of it can
    // clip; a positive value clips geometry nearer than that distance (ChemPotDiagram3D).
    ortho_near?: number
    far?: number // far plane for either projection (three's default when omitted)
    orbit_props: ReturnType<typeof build_orbit_props>
    gizmo?: boolean | GizmoOptions
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`]
  } = $props()
</script>

{#snippet camera_contents()}
  <extras.OrbitControls bind:ref={orbit_controls} {...orbit_props}>
    {#if gizmo}
      <Gizmo
        {...typeof gizmo === `object` ? gizmo : {}}
        on_start={orbit_props.onstart}
        on_end={orbit_props.onend}
      />
    {/if}
  </extras.OrbitControls>
{/snippet}

{#if camera_projection === `perspective`}
  <T.PerspectiveCamera makeDefault {position} {fov} {near} {far}>
    {@render camera_contents()}
  </T.PerspectiveCamera>
{:else}
  <T.OrthographicCamera makeDefault {position} {zoom} near={ortho_near} {far}>
    {@render camera_contents()}
  </T.OrthographicCamera>
{/if}
