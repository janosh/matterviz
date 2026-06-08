// Export Fermi surface to various 3D formats
import type { Scene } from 'three'
import { download } from '$lib/io/fetch'
import { to_error } from '$lib/utils'

// Export scene to STL format (good for 3D printing)
export async function export_to_stl(scene: Scene, filename: string): Promise<void> {
  const { STLExporter } = await import(`three/addons/exporters/STLExporter.js`)
  const exporter = new STLExporter()
  const result = exporter.parse(scene, { binary: true })
  // Binary STL returns DataView, convert to ArrayBuffer for Blob
  const buffer = result instanceof DataView ? result.buffer : result
  download(buffer, `${filename}.stl`, `application/octet-stream`)
}

// Export scene to OBJ format (widely compatible)
export async function export_to_obj(scene: Scene, filename: string): Promise<void> {
  const { OBJExporter } = await import(`three/addons/exporters/OBJExporter.js`)
  const exporter = new OBJExporter()
  const result = exporter.parse(scene)
  download(result, `${filename}.obj`, `text/plain`)
}

// Export scene to GLTF format (modern web/AR standard)
export async function export_to_gltf(scene: Scene, filename: string): Promise<void> {
  const { GLTFExporter } = await import(`three/addons/exporters/GLTFExporter.js`)
  const exporter = new GLTFExporter()

  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (gltf) => {
        const output = JSON.stringify(gltf, null, 2)
        download(output, `${filename}.gltf`, `application/json`)
        resolve()
      },
      (error) => reject(to_error(error)),
      { binary: false },
    )
  })
}

// Main export function that dispatches to the appropriate format
export function export_scene(
  scene: Scene,
  format: `stl` | `obj` | `gltf`,
  filename: string,
): Promise<void> {
  if (format === `stl`) return export_to_stl(scene, filename)
  if (format === `obj`) return export_to_obj(scene, filename)
  if (format === `gltf`) return export_to_gltf(scene, filename)
  return Promise.reject(new Error(`Unsupported export format: ${format}`))
}
