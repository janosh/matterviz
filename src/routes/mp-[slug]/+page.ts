import { fetch_zipped, summary_bucket } from '$lib/api.js'
import type { SummaryDoc } from '$lib/material-summary.js'

export const prerender = false

export const load = async ({ params }) => {
  const file = `mp-${params.slug}.json.gz`
  const summary_url = `${summary_bucket}/${file}`

  return {
    summary: fetch_zipped<SummaryDoc>(summary_url),
  }
}
