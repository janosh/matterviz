import { aws_bucket, fetch_zipped } from '$lib/api.ts'
import type { SummaryDoc } from '$lib/material/index.ts'

export const prerender = false

export const load = async ({ params }) => {
  const file = `mp-${params.slug}.json.gz`
  const summary_url = `${aws_bucket}/summary/${file}`

  return {
    summary: fetch_zipped<SummaryDoc>(summary_url),
  }
}
