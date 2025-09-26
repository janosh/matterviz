import type { PhaseEntry } from './types'

export function get_arity(entry: PhaseEntry) {
  return Object.values(entry.composition).filter((v) => v > 0).length
}

export const is_elemental_entry = (entry: PhaseEntry) => get_arity(entry) === 1
export const is_binary_entry = (entry: PhaseEntry) => get_arity(entry) === 2
export const is_ternary_entry = (entry: PhaseEntry) => get_arity(entry) === 3
export const is_quaternary_entry = (entry: PhaseEntry) => get_arity(entry) === 4
export const is_quinary_entry = (entry: PhaseEntry) => get_arity(entry) === 5
export const is_senary_entry = (entry: PhaseEntry) => get_arity(entry) === 6
export const is_septenary_entry = (entry: PhaseEntry) => get_arity(entry) === 7
export const is_octonary_entry = (entry: PhaseEntry) => get_arity(entry) === 8
export const is_nonary_entry = (entry: PhaseEntry) => get_arity(entry) === 9
export const is_denary_entry = (entry: PhaseEntry) => get_arity(entry) === 10
