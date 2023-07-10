import { fetch_zipped, mp_build_bucket } from '$lib/api.ts'
import type { SummaryDoc } from '$lib/material/index.ts'

export const prerender = false

export const load = async ({ params }) => {
  const file = `mp-${params.slug}.json.gz`
  const summary_url = `${mp_build_bucket}/summary/${file}`
  const similarity_url = `${mp_build_bucket}/similarity/${file}`

  return {
    summary: fetch_zipped<SummaryDoc>(summary_url),
    similarity: fetch_zipped<SimilarityDoc>(similarity_url),
  }
}
