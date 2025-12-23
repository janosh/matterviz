import { fetch_zipped } from '$lib/io/fetch'

// Materials Project S3 bucket for pre-computed data (may be outdated)
export const mp_bucket =
  `https://materialsproject-build.s3.amazonaws.com/collections/2022-10-28`

// Fetch all material data in parallel
export async function fetch_material_data<T extends Record<string, unknown>>(
  material_id: string,
  bucket: string = mp_bucket,
): Promise<{ summary: T | null; similarity: T | null; robocrys: T | null }> {
  try {
    const results = await Promise.allSettled([
      fetch_zipped<T>(`${bucket}/summary/${material_id}.json.gz`),
      fetch_zipped<T>(`${bucket}/similarity/${material_id}.json.gz`),
      fetch_zipped<T>(`${bucket}/robocrys/${material_id}.json.gz`),
    ])
    return {
      summary: results[0].status === `fulfilled` ? results[0].value : null,
      similarity: results[1].status === `fulfilled` ? results[1].value : null,
      robocrys: results[2].status === `fulfilled` ? results[2].value : null,
    }
  } catch (err) {
    console.error(`Failed to fetch material data:`, err)
    return { summary: null, similarity: null, robocrys: null }
  }
}
