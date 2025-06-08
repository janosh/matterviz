import { browser } from '$app/environment'
import type { AnyStructure } from '$lib'
import { electro_neg_formula } from '$lib'
import { download } from '$lib/api'
import { Vector2, WebGLRenderer } from 'three'

export interface CanvasWithRenderer extends HTMLCanvasElement {
  __customRenderer?: WebGLRenderer
}

// Generate a filename for structure exports based on structure metadata
export function generate_structure_filename(
  structure: AnyStructure | undefined,
  extension: string,
): string {
  if (!structure) return `structure.${extension}`

  const parts: string[] = []

  if (structure.id) parts.push(structure.id) // Add ID if available

  // Add formula
  const formula = electro_neg_formula(structure)
  if (formula && formula !== `Unknown`) parts.push(formula)

  // Add space group if available
  if (
    `symmetry` in structure &&
    structure.symmetry &&
    typeof structure.symmetry === `object` &&
    `space_group_symbol` in structure.symmetry
  )
    parts.push(String(structure.symmetry.space_group_symbol))

  // Add lattice system if available
  if (
    `lattice` in structure &&
    structure.lattice &&
    typeof structure.lattice === `object` &&
    `lattice_system` in structure.lattice
  )
    parts.push(String(structure.lattice.lattice_system))

  // Add number of sites
  if (structure.sites?.length) parts.push(`${structure.sites.length}sites`)

  const base_name = parts.length > 0 ? parts.join(`_`) : `structure`
  return `${base_name}.${extension}`
}

// Export structure as XYZ format. Format specification:
// - Line 1: Number of atoms
// - Line 2: Comment line (structure ID, formula, etc.)
// - Remaining lines: Element symbol followed by x, y, z coordinates (in Angstroms)
export function export_xyz(structure?: AnyStructure): void {
  try {
    if (!structure?.sites) {
      console.warn(`No structure or sites to download`)
      return
    }

    const lines: string[] = []

    // First line: number of atoms
    lines.push(String(structure.sites.length))

    // Second line: comment (structure ID, formula, or default)
    const comment_parts: string[] = []
    if (structure.id) comment_parts.push(structure.id)
    const formula = electro_neg_formula(structure)
    if (formula && formula !== `Unknown`) comment_parts.push(formula)
    const comment =
      comment_parts.length > 0
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
        if (first_species && `element` in first_species) {
          element_symbol = first_species.element
        }
      }

      // Get coordinates - prefer abc (fractional) converted to cartesian, fallback to xyz
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
          coords = [
            a * lattice.matrix[0][0] +
              b * lattice.matrix[1][0] +
              c * lattice.matrix[2][0],
            a * lattice.matrix[0][1] +
              b * lattice.matrix[1][1] +
              c * lattice.matrix[2][1],
            a * lattice.matrix[0][2] +
              b * lattice.matrix[1][2] +
              c * lattice.matrix[2][2],
          ]
        } else {
          coords = [0, 0, 0] // fallback
        }
      } else {
        coords = [0, 0, 0] // fallback
      }

      // Format coordinates to reasonable precision
      const [x, y, z] = coords.map((coord) => coord.toFixed(6))
      lines.push(`${element_symbol} ${x} ${y} ${z}`)
    }

    const xyz_content = lines.join(`\n`)
    const filename = generate_structure_filename(structure, `xyz`)
    download(xyz_content, filename, `text/plain`)
  } catch (error) {
    console.error(`Error exporting XYZ:`, error)
  }
}

// Export structure in pymatgen JSON format
export function export_json(structure?: AnyStructure): void {
  try {
    if (!structure) {
      console.warn(`No structure to download`)
      return
    }
    const data = JSON.stringify(structure, null, 2)
    const filename = generate_structure_filename(structure, `json`)
    download(data, filename, `application/json`)
  } catch (error) {
    console.error(`Error exporting JSON:`, error)
  }
}

// Export structure as PNG image from canvas
export function export_png(
  canvas: HTMLCanvasElement | null,
  structure: AnyStructure | undefined,
  png_dpi: number = 150,
): void {
  try {
    if (!canvas) {
      if (browser) console.warn(`Canvas not found for PNG export`)
      return
    }

    // Convert DPI to multiplier (72 DPI is baseline web resolution)
    const resolution_multiplier = png_dpi / 72
    const renderer = (canvas as CanvasWithRenderer).__customRenderer

    if (resolution_multiplier <= 1.1 || !renderer) {
      // Direct capture at current resolution (if DPI is close to 72 or renderer not available)
      try {
        canvas.toBlob((blob) => {
          if (blob) {
            const filename = generate_structure_filename(structure, `png`)
            download(blob, filename, `image/png`)
          } else {
            if (browser) {
              console.warn(`Failed to generate PNG - canvas may be empty`)
            }
          }
        }, `image/png`)
      } catch (error) {
        console.error(`Error during PNG export:`, error)
      }
      return
    }

    // Temporarily modify the renderer's pixel ratio for high-res capture
    const original_pixel_ratio = renderer.getPixelRatio()
    const original_size = renderer.getSize(new Vector2())

    try {
      // Set higher pixel ratio to increase rendering resolution
      renderer.setPixelRatio(resolution_multiplier)

      // Force the canvas to update its resolution
      renderer.setSize(original_size.width, original_size.height, false)

      // Wait for the browser to complete painting at the new resolution
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Capture the high-resolution render after paint completion
          canvas.toBlob((blob) => {
            // Restore original settings immediately
            renderer.setPixelRatio(original_pixel_ratio)
            renderer.setSize(original_size.width, original_size.height, false)

            if (blob) {
              const filename = generate_structure_filename(structure, `png`)
              download(blob, filename, `image/png`)
            } else {
              if (browser) {
                console.warn(`Failed to generate high-resolution PNG`)
              }
            }
          }, `image/png`)
        })
      })
    } catch (error) {
      console.error(`Error during high-res rendering:`, error)
      // Restore original settings
      renderer.setPixelRatio(original_pixel_ratio)
      renderer.setSize(original_size.width, original_size.height, false)
      if (browser) {
        console.warn(
          `Failed to render at high resolution: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  } catch (error) {
    console.error(`Error exporting PNG:`, error)
  }
}
