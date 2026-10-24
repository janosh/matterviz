import { redirect } from '@sveltejs/kit'

// The Fermi surface + bands demo is part of the electronic structure viewer's
export const load = (): never => redirect(308, `/reciprocal/electronic-structure`)
