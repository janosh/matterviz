import process from 'node:process'

// Minimal stub for SvelteKit $app/environment
export const browser = false
export const building = false
export const dev = process.env.NODE_ENV === `development`
export const version = `1.0.0`
