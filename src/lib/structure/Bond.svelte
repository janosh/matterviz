<script lang="ts">
  import type { BondPair, Vec3 } from '$lib'
  import { format_num } from '$lib/labels'
  import { DEFAULTS } from '$lib/settings'
  import { CanvasTooltip } from '$lib/structure'
  import type { BondingStrategy } from '$lib/structure/bonding'
  import { T } from '@threlte/core'
  import { interactivity } from '@threlte/extras'
  import type { ComponentProps } from 'svelte'
  import { CanvasTexture, Euler, Quaternion, Vector3 } from 'three'

  interface Props extends ComponentProps<typeof T.Mesh> {
    from: Vec3
    to: Vec3
    color?: string
    thickness?: number
    offset?: number
    from_color?: string // color of atom 1
    to_color?: string // color of atom 2
    bond_data?: BondPair // full bond data for tooltips
    bonding_strategy?: BondingStrategy // current bonding algorithm
    active_tooltip?: `atom` | `bond` | null // global tooltip state
    hovered_bond_data?: BondPair | null // currently hovered bond
    onbondhover?: (bond_data: BondPair | null) => void // callback for bond hover
    ontooltipchange?: (type: `atom` | `bond` | null) => void // callback for tooltip state
  }
  let {
    from,
    to,
    color = DEFAULTS.structure.bond_color,
    thickness = DEFAULTS.structure.bond_thickness,
    offset = 0,
    from_color,
    to_color,
    bond_data,
    bonding_strategy,
    active_tooltip,
    hovered_bond_data,
    onbondhover,
    ontooltipchange,
    ...rest
  }: Props = $props()

  interactivity()

  const from_vec = new Vector3(...from)
  const to_vec = new Vector3(...to)
  const { position, rotation, height } = calc_bond(
    from_vec,
    to_vec,
    offset,
    thickness,
  )
  // Create gradient texture when both colors are provided
  let gradient_texture = $derived.by(() => {
    if (!from_color || !to_color) return null

    // Create a canvas for the gradient
    const canvas = document.createElement(`canvas`)
    canvas.width = 1
    canvas.height = 256
    const ctx = canvas.getContext(`2d`)!

    // Create linear gradient along Y axis (cylinder height)
    const gradient = ctx.createLinearGradient(0, 0, 0, 256)
    gradient.addColorStop(0, to_color)
    gradient.addColorStop(1, from_color)

    // Fill the canvas with the gradient
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 1, 256)

    // Create texture from canvas
    const texture = new CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  })

  const pointer_handlers = {
    onpointerenter: () => {
      if (bond_data) {
        onbondhover?.(bond_data)
        ontooltipchange?.(`bond`)
      }
    },
    onpointerleave: () => {
      onbondhover?.(null)
      ontooltipchange?.(null)
    },
  }

  function calc_bond(
    from_vec: Vector3,
    to_vec: Vector3,
    offset: number,
    thickness: number,
  ) {
    // find the axis of the the box
    const delta_vec = to_vec.clone().sub(from_vec)
    // length of the bond
    const height = delta_vec.length()
    // calculate position
    let position: Vec3
    if (offset === 0) {
      position = from_vec.clone().add(delta_vec.multiplyScalar(0.5)).toArray()
    } else {
      const offset_vec = new Vector3()
        .crossVectors(delta_vec, new Vector3(1, 0, 0))
        .normalize()
      position = from_vec.clone().add(delta_vec.multiplyScalar(0.5)).add(
        offset_vec.multiplyScalar(offset * thickness * 2),
      ).toArray()
    }
    // calculate rotation
    const quaternion = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      delta_vec.normalize(),
    )
    const rotation = new Euler().setFromQuaternion(quaternion).toArray()
    // return results
    return { height, position, rotation }
  }
</script>

{#if gradient_texture}
  <!-- Use gradient material for bonds with two colors -->
  <T.Mesh
    {...rest}
    {position}
    {rotation}
    scale={[thickness, height, thickness]}
    {...pointer_handlers}
  >
    <T.CylinderGeometry args={[thickness, thickness, 1, 16]} />
    <T.MeshStandardMaterial map={gradient_texture} />
  </T.Mesh>
{:else}
  <!-- Fallback to solid color -->
  <T.Mesh
    {...rest}
    {position}
    {rotation}
    scale={[thickness, height, thickness]}
    {...pointer_handlers}
  >
    <T.CylinderGeometry args={[thickness, thickness, 1, 16]} />
    <T.MeshStandardMaterial {color} />
  </T.Mesh>
{/if}

<!-- Bond tooltip on hover -->
{#if active_tooltip === `bond` && hovered_bond_data && bond_data &&
    hovered_bond_data === bond_data}
  {@const midpoint = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2,
  ] as Vec3}
  <CanvasTooltip position={midpoint}>
    <strong>Distance:</strong> {format_num(bond_data.bond_length, `.3f`)} Å (sites {
      bond_data.site_idx_1
    } ↔ {bond_data.site_idx_2})<br>
    {#if bond_data.strength}
      <strong>Strength:</strong> {format_num(bond_data.strength, `.3f`)}
      {#if bonding_strategy}({bonding_strategy.replace(/_/g, ` `)}){/if}
    {/if}
  </CanvasTooltip>
{/if}
