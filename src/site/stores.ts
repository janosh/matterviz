import { writable } from 'svelte/store'

export const demos = writable<string[]>([])
