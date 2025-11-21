import type { AnyStructure, Vec3 } from '$lib'
import { get_electro_neg_formula } from '$lib/composition'
import { download } from '$lib/io/fetch'
import * as math from '$lib/math'
import {
  Group,
  type InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Scene,
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'

// Helper function to convert InstancedMesh to regular Mesh objects for export
// This is necessary because GLB/OBJ exporters don't handle InstancedMesh properly
// Note: Threlte's InstancedMesh sets isInstancedMesh=true but type remains "Mesh"
function convert_instanced_meshes_to_regular(scene: Scene): Scene {
  const cloned_scene = scene.clone()

  // Find all InstancedMesh objects in the cloned scene
  const instanced_meshes: InstancedMesh[] = []
  cloned_scene.traverse((object) => {
    // Check for isInstancedMesh property (Threlte) or type === InstancedMesh (vanilla Three.js)
    // @ts-expect-error - checking for isInstancedMesh property
    const is_instanced = object.isInstancedMesh === true ||
      object.type === `InstancedMesh`
    if (is_instanced) {
      instanced_meshes.push(object as InstancedMesh)
    }
  })

  // Convert each InstancedMesh to individual Mesh objects
  for (const instanced_mesh of instanced_meshes) {
    const parent = instanced_mesh.parent
    if (!parent || !instanced_mesh.instanceMatrix) continue

    // Create a group to hold all the individual meshes
    const group = new Group()
    group.name = instanced_mesh.name

    // Get the base transform from the InstancedMesh
    const base_matrix = new Matrix4()
    base_matrix.copy(instanced_mesh.matrix)

    // Create individual meshes for each instance
    const instance_matrix = new Matrix4()
    for (let idx = 0; idx < instanced_mesh.count; idx++) {
      instanced_mesh.getMatrixAt(idx, instance_matrix)

      // Clone geometry for each instance (applyMatrix4 modifies geometry in place)
      const mesh = new Mesh(
        instanced_mesh.geometry.clone(),
        instanced_mesh.material instanceof Array
          ? instanced_mesh.material.map((mat) => mat.clone())
          : instanced_mesh.material.clone(),
      )

      // Combine base transform with instance transform
      const combined_matrix = new Matrix4()
      combined_matrix.multiplyMatrices(base_matrix, instance_matrix)
      mesh.applyMatrix4(combined_matrix)

      // Copy instance color if it exists
      if (instanced_mesh.instanceColor) {
        const color_r = instanced_mesh.instanceColor.getX(idx)
        const color_g = instanced_mesh.instanceColor.getY(idx)
        const color_b = instanced_mesh.instanceColor.getZ(idx)

        if (mesh.material instanceof MeshStandardMaterial) {
          mesh.material.color.setRGB(color_r, color_g, color_b)
        } else if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => {
            if (mat instanceof MeshStandardMaterial) {
              mat.color.setRGB(color_r, color_g, color_b)
            }
          })
        }
      }

      group.add(mesh)
    }

    // Replace the InstancedMesh with the Group in the parent
    parent.remove(instanced_mesh)
    parent.add(group)

    // Update world matrices after scene graph modification
    group.updateMatrixWorld(true)
  }

  // Update all world matrices in the modified scene
  cloned_scene.updateMatrixWorld(true)

  return cloned_scene
}

// Generate a filename for structure exports based on structure metadata
// Sanitize string for use in filenames by removing problematic characters.
const sanitize_filename_part = (text: string): string =>
  text
    .replace(/<\/?[^>]+>/g, ``) // strip HTML tags
    .replace(/[/\\:*?"<>|]/g, `_`) // replace filesystem-invalid chars
    .replace(/_+/g, `_`) // condense consecutive underscores
    .replace(/^_|_$/g, ``) // remove leading/trailing underscores

export function create_structure_filename(
  structure: AnyStructure | undefined,
  extension: string,
): string {
  if (!structure) return `structure.${extension}`

  const parts: string[] = []
  // Helper to sanitize and push non-empty parts
  const safe_push = (value: string | undefined) => {
    const sanitized = value ? sanitize_filename_part(value) : ``
    if (sanitized) parts.push(sanitized)
  }
  safe_push(structure.id)

  // Add formula (plain text to avoid HTML in filenames)
  const formula = get_electro_neg_formula(structure, true)
  if (formula && formula !== `Unknown`) {
    safe_push(formula.replaceAll(` `, ``))
  }

  // Add space group if available
  if (
    `symmetry` in structure &&
    structure.symmetry &&
    typeof structure.symmetry === `object` &&
    `space_group_symbol` in structure.symmetry
  ) {
    const space_group = structure.symmetry.space_group_symbol
    if (space_group && typeof space_group === `string`) {
      safe_push(space_group.replaceAll(` `, ``))
    }
  }

  // Add lattice system if available
  if (
    `lattice` in structure &&
    structure.lattice &&
    typeof structure.lattice === `object` &&
    `lattice_system` in structure.lattice
  ) {
    const lattice_system = structure.lattice.lattice_system
    if (lattice_system && typeof lattice_system === `string`) {
      safe_push(lattice_system)
    }
  }

  // Add number of sites
  if (structure.sites?.length) parts.push(`${structure.sites.length}sites`)

  const base_name = parts.length > 0 ? parts.join(`-`) : `structure`
  return `${base_name}.${extension}`
}

// Generate XYZ content string without saving
export function structure_to_xyz_str(structure?: AnyStructure): string {
  if (!structure?.sites) throw new Error(`No structure or sites to export`)

  const lines: string[] = []

  // First line: number of atoms
  lines.push(String(structure.sites.length))

  // Second line: comment (structure ID, formula, or default)
  const comment_parts: string[] = []
  if (structure.id) comment_parts.push(structure.id)
  const formula = get_electro_neg_formula(structure, true)
  if (formula && formula !== `Unknown`) comment_parts.push(formula)

  // Include extended XYZ lattice information when available so round-trips preserve lattice
  if ((`lattice` in structure) && structure.lattice?.matrix?.length === 3) {
    const lattice_values = structure.lattice.matrix
      .flat()
      .map((value: number) => (Number.isFinite(value) ? value : 0).toFixed(8))
      .join(` `)
    comment_parts.push(`Lattice="${lattice_values}"`)
  }

  const comment = comment_parts.length > 0
    ? comment_parts.join(` `)
    : `Generated from structure`
  lines.push(comment)

  // Atom lines: element symbol followed by x, y, z coordinates
  for (const site of structure.sites) {
    // Extract element symbol from species
    let element_symbol = `X` // default fallback
    if (
      site.species &&
      Array.isArray(site.species) &&
      site.species.length > 0
    ) {
      // species is an array of Species objects with element property
      const first_species = site.species[0]
      if (
        first_species && `element` in first_species && first_species.element
      ) element_symbol = first_species.element
    }

    // Get coordinates - prefer xyz; fallback to abc (converted to cartesian if lattice available)
    let coords: number[]
    if (site.xyz && Array.isArray(site.xyz) && site.xyz.length >= 3) {
      coords = site.xyz.slice(0, 3)
    } else if (
      site.abc &&
      Array.isArray(site.abc) &&
      site.abc.length >= 3 &&
      `lattice` in structure &&
      structure.lattice
    ) {
      // Convert fractional coordinates to cartesian
      const [a, b, c] = site.abc
      const lattice = structure.lattice
      if (
        lattice.matrix &&
        Array.isArray(lattice.matrix) &&
        lattice.matrix.length >= 3
      ) {
        const lattice_transposed = math.transpose_3x3_matrix(lattice.matrix)
        coords = math.mat3x3_vec3_multiply(lattice_transposed, [a, b, c])
      } else coords = [0, 0, 0] // fallback
    } else coords = [0, 0, 0] // fallback

    // Format coordinates to reasonable precision
    const [x, y, z] = coords.map((coord) => coord.toFixed(6))
    lines.push(`${element_symbol} ${x} ${y} ${z}`)
  }

  return lines.join(`\n`)
}

// Generate CIF content string without saving
export function structure_to_cif_str(structure?: AnyStructure): string {
  if (!structure?.sites) throw new Error(`No structure or sites to export`)
  if (!(`lattice` in structure) || !structure.lattice) {
    throw new Error(`No lattice information for CIF export`)
  }

  const lines: string[] = []

  // CIF header
  lines.push(`# CIF file generated by MatterViz`)
  if (structure.id) lines.push(`_cell_identifier ${structure.id}`)
  lines.push(``)

  // Cell parameters
  const lattice = structure.lattice
  if (lattice.a && lattice.b && lattice.c) {
    lines.push(`_cell_length_a ${lattice.a.toFixed(6)}`)
    lines.push(`_cell_length_b ${lattice.b.toFixed(6)}`)
    lines.push(`_cell_length_c ${lattice.c.toFixed(6)}`)
  }
  if (lattice.alpha && lattice.beta && lattice.gamma) {
    lines.push(`_cell_angle_alpha ${lattice.alpha.toFixed(6)}`)
    lines.push(`_cell_angle_beta ${lattice.beta.toFixed(6)}`)
    lines.push(`_cell_angle_gamma ${lattice.gamma.toFixed(6)}`)
  }

  // Space group information
  if (
    `symmetry` in structure && structure.symmetry &&
    typeof structure.symmetry === `object`
  ) {
    const symmetry = structure.symmetry as Record<string, unknown>
    if (`space_group_symbol` in symmetry && symmetry.space_group_symbol) {
      lines.push(`_space_group_name_H-M_alt ${symmetry.space_group_symbol}`)
    }
    if (`space_group_number` in symmetry && symmetry.space_group_number) {
      lines.push(`_space_group_IT_number ${symmetry.space_group_number}`)
    }
  }

  lines.push(``)

  // Atom site loop header
  lines.push(`loop_`)
  lines.push(`_atom_site_label`)
  lines.push(`_atom_site_type_symbol`)
  lines.push(`_atom_site_fract_x`)
  lines.push(`_atom_site_fract_y`)
  lines.push(`_atom_site_fract_z`)
  lines.push(`_atom_site_occupancy`)

  // Atom sites
  for (let idx = 0; idx < structure.sites.length; idx++) {
    const site = structure.sites[idx]
    if (!site) continue // Skip if site is undefined

    // Extract element symbol from species
    let element_symbol = `X` // default fallback
    let occupancy = 1
    if (
      site.species &&
      Array.isArray(site.species) &&
      site.species.length > 0
    ) {
      const first_species = site.species[0]
      if (
        first_species && `element` in first_species && first_species.element
      ) {
        element_symbol = first_species.element
        occupancy = first_species?.occu ?? 1
      }
    }

    // Get fractional coordinates
    let frac_coords: number[]
    if (site.abc && Array.isArray(site.abc) && site.abc.length >= 3) {
      frac_coords = site.abc.slice(0, 3)
    } else if (
      site.xyz &&
      Array.isArray(site.xyz) &&
      site.xyz.length >= 3 &&
      lattice.matrix &&
      Array.isArray(lattice.matrix)
    ) {
      // Convert cartesian to fractional coordinates
      const lattice_transposed = math.transpose_3x3_matrix(lattice.matrix)
      const lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
      frac_coords = math.mat3x3_vec3_multiply(lattice_inv, site.xyz)
    } else throw new Error(`No valid coordinates found for site ${idx}`)

    // Format: label element_symbol x y z
    const label = site.label || `${element_symbol}${idx + 1}`
    lines.push(
      `${label} ${element_symbol} ${frac_coords[0].toFixed(8)} ${
        frac_coords[1].toFixed(8)
      } ${frac_coords[2].toFixed(8)} ${occupancy.toFixed(8)}`,
    )
  }

  return lines.join(`\n`)
}

// Generate VASP POSCAR content string without saving
export function structure_to_poscar_str(structure?: AnyStructure): string {
  if (!structure?.sites) throw new Error(`No structure or sites to export`)
  if (!(`lattice` in structure) || !structure.lattice) {
    throw new Error(`No lattice information for POSCAR export`)
  }
  const lines: string[] = []

  // Use plain text formula for POSCAR title to avoid HTML tags
  const formula = get_electro_neg_formula(structure, true)
  const title = structure.id ||
    (formula && formula !== `Unknown` ? formula : null) ||
    `Generated from structure`
  lines.push(title)
  lines.push(`1.0`) // Scale factor (1.0 for direct coordinates)

  const lattice = structure.lattice
  if (lattice.matrix && Array.isArray(lattice.matrix) && lattice.matrix.length >= 3) {
    // Convert 3x3 matrix to 3 vectors
    const matrix = lattice.matrix
    lines.push(
      `${matrix[0][0].toFixed(8)} ${matrix[0][1].toFixed(8)} ${matrix[0][2].toFixed(8)}`,
    )
    lines.push(
      `${matrix[1][0].toFixed(8)} ${matrix[1][1].toFixed(8)} ${matrix[1][2].toFixed(8)}`,
    )
    lines.push(
      `${matrix[2][0].toFixed(8)} ${matrix[2][1].toFixed(8)} ${matrix[2][2].toFixed(8)}`,
    )
  } else {
    throw new Error(`No valid lattice matrix for POSCAR export`)
  }

  // Count atoms by element
  const element_counts = new Map<string, number>()
  const element_symbols: string[] = []

  for (const site of structure.sites) {
    let element_symbol = `X` // default fallback
    if (
      site.species &&
      Array.isArray(site.species) &&
      site.species.length > 0
    ) {
      const first_species = site.species[0]
      if (
        first_species && `element` in first_species && first_species.element
      ) {
        element_symbol = first_species.element
      }
    }

    if (!element_counts.has(element_symbol)) {
      element_counts.set(element_symbol, 0)
      element_symbols.push(element_symbol)
    }
    element_counts.set(element_symbol, Number(element_counts.get(element_symbol)) + 1)
  }

  // Element symbols line
  lines.push(element_symbols.join(` `))

  // Atom counts line
  lines.push(element_symbols.map((el) => element_counts.get(el)).join(` `))

  // Check if any site has selective dynamics
  const has_selective_dynamics = structure.sites.some(
    (site) => site.properties?.selective_dynamics,
  )
  if (has_selective_dynamics) {
    lines.push(`Selective dynamics`)
  }

  // Coordinate mode (Direct = fractional coordinates)
  lines.push(`Direct`)

  // Atom coordinates grouped by element
  for (const element_symbol of element_symbols) {
    for (const site of structure.sites) {
      let site_element = `X`
      if (
        site.species &&
        Array.isArray(site.species) &&
        site.species.length > 0
      ) {
        const first_species = site.species[0]
        if (
          first_species && `element` in first_species && first_species.element
        ) {
          site_element = first_species.element
        }
      }

      if (site_element === element_symbol) {
        // Get fractional coordinates
        let frac_coords: number[]
        if (site.abc && Array.isArray(site.abc) && site.abc.length >= 3) {
          frac_coords = site.abc.slice(0, 3)
        } else if (
          site.xyz &&
          Array.isArray(site.xyz) &&
          site.xyz.length >= 3 &&
          lattice.matrix &&
          Array.isArray(lattice.matrix)
        ) {
          // Convert cartesian to fractional coordinates
          const lattice_transposed = math.transpose_3x3_matrix(lattice.matrix)
          const lattice_inv = math.matrix_inverse_3x3(lattice_transposed)
          frac_coords = math.mat3x3_vec3_multiply(
            lattice_inv,
            site.xyz.slice(0, 3) as Vec3,
          )
        } else {
          throw new Error(`No valid coordinates found for site`)
        }

        let selective_dynamics_str = ``
        if (has_selective_dynamics) {
          const sel_dyn = (site.properties?.selective_dynamics ?? [
            true,
            true,
            true,
          ]) as boolean[]
          selective_dynamics_str = ` ${sel_dyn[0] ? `T` : `F`} ${
            sel_dyn[1] ? `T` : `F`
          } ${sel_dyn[2] ? `T` : `F`}`
        }

        lines.push(
          `${frac_coords[0].toFixed(8)} ${frac_coords[1].toFixed(8)} ${
            frac_coords[2].toFixed(8)
          }${selective_dynamics_str}`,
        )
      }
    }
  }

  return lines.join(`\n`)
}

// Generate JSON content string without saving
export function structure_to_json_str(structure?: AnyStructure): string {
  if (!structure) throw new Error(`No structure to export`)
  return JSON.stringify(structure, null, 2)
}

// Export structure as CIF format
export function export_structure_as_cif(structure?: AnyStructure): void {
  try {
    const content = structure_to_cif_str(structure)
    const filename = create_structure_filename(structure, `cif`)
    download(content, filename, `chemical/x-cif`)
  } catch (error) {
    console.error(`Failed to export CIF:`, error)
  }
}

// Export structure as VASP POSCAR format
export function export_structure_as_poscar(structure?: AnyStructure): void {
  try {
    const content = structure_to_poscar_str(structure)
    const filename = create_structure_filename(structure, `poscar`)
    download(content, filename, `text/plain`)
  } catch (error) {
    console.error(`Failed to export POSCAR:`, error)
  }
}

// Export structure as XYZ format. Format specification:
// - Line 1: Number of atoms
// - Line 2: Comment line (structure ID, formula, etc.)
// - Remaining lines: Element symbol followed by x, y, z coordinates (in Angstrom)
export function export_structure_as_xyz(structure?: AnyStructure): void {
  try {
    const xyz_content = structure_to_xyz_str(structure)
    const filename = create_structure_filename(structure, `xyz`)
    download(xyz_content, filename, `text/plain`)
  } catch (error) {
    console.error(`Error exporting XYZ:`, error)
  }
}

// Export structure in pymatgen JSON format
export function export_structure_as_json(structure?: AnyStructure): void {
  try {
    const data = structure_to_json_str(structure)
    const filename = create_structure_filename(structure, `json`)
    download(data, filename, `application/json`)
  } catch (error) {
    console.error(`Error exporting JSON:`, error)
  }
}

// Export Three.js scene as GLB (binary GLTF) file
// GLB preserves materials and colors, making it ideal for element visualization
export function export_structure_as_glb(
  scene: Scene | null,
  structure: AnyStructure | undefined,
): void {
  try {
    if (!scene) {
      console.warn(`No scene available for GLB export`)
      return
    }

    // Convert instanced meshes to regular meshes for export
    const export_scene = convert_instanced_meshes_to_regular(scene)

    const exporter = new GLTFExporter()
    const filename = create_structure_filename(structure, `glb`)

    // Export as binary GLB format
    exporter.parse(
      export_scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          const blob = new Blob([result], { type: `model/gltf-binary` })
          download(blob, filename, `model/gltf-binary`)
        } else {
          console.error(`GLB export returned unexpected format`)
        }
      },
      (error) => {
        console.error(`GLB export failed:`, error)
      },
      { binary: true },
    )
  } catch (error) {
    console.error(`Error exporting GLB:`, error)
  }
}

// Export Three.js scene as OBJ (Wavefront Object) file
// OBJ exports geometry with material references, widely supported format
export function export_structure_as_obj(
  scene: Scene | null,
  structure: AnyStructure | undefined,
): void {
  try {
    if (!scene) {
      console.warn(`No scene available for OBJ export`)
      return
    }

    // Convert instanced meshes to regular meshes for export
    const export_scene = convert_instanced_meshes_to_regular(scene)

    const exporter = new OBJExporter()
    const filename = create_structure_filename(structure, `obj`)

    const result = exporter.parse(export_scene)

    // OBJ exporter returns a string
    const blob = new Blob([result], { type: `text/plain` })
    download(blob, filename, `text/plain`)
  } catch (error) {
    console.error(`Error exporting OBJ:`, error)
  }
}
