import {
  TICK_STRATEGIES,
  type TickCandidateLabel,
  type TickStaggerRow,
  type TickStrategy,
  type TickStrategyCandidate,
} from './types'

export interface TickCandidateLabelInput {
  full_text: string
  display_lines?: readonly string[]
  visible?: boolean
  stagger_row?: TickStaggerRow
  information_loss?: number
}

export interface CreateTickCandidateInput {
  id: string
  strategy: TickStrategy
  labels: readonly (string | TickCandidateLabelInput)[]
  rotation_deg?: number
}

export interface TickCandidateTransformOptions {
  id: string
}

export interface StaggerCandidateOptions extends TickCandidateTransformOptions {
  first_row?: TickStaggerRow
}

export interface AbbreviationCandidateOptions extends TickCandidateTransformOptions {
  abbreviations?: Readonly<Record<string, string>>
}

export interface EllipsisCandidateOptions extends TickCandidateTransformOptions {
  max_width_px: number | readonly number[]
  measure_text: (text: string) => number
  ellipsis?: string
}

export const DEFAULT_SEMANTIC_ABBREVIATIONS = {
  average: `avg.`,
  concentration: `conc.`,
  conductivity: `cond.`,
  coordination: `coord.`,
  density: `dens.`,
  displacement: `disp.`,
  distance: `dist.`,
  formation: `form.`,
  frequency: `freq.`,
  intensity: `int.`,
  magnetization: `mag.`,
  maximum: `max.`,
  minimum: `min.`,
  normalized: `norm.`,
  percentage: `pct.`,
  pressure: `press.`,
  probability: `prob.`,
  temperature: `temp.`,
  volume: `vol.`,
} as const satisfies Readonly<Record<string, string>>

const NO_BREAK_CHARACTER = /[\u00A0\u2011\u202F\u2060]/u
const PROTECTED_SEGMENT = /(?<protected>\([^()]*\)|\[[^\][]*\]|\{[^{}]*\})/gu
const WORD = /\p{L}[\p{L}\p{M}]*/gu
const grapheme_segmenter = new Intl.Segmenter(`en`, { granularity: `grapheme` })

const is_tick_strategy = (value: string): value is TickStrategy =>
  TICK_STRATEGIES.some((strategy) => strategy === value)

const validate_finite_nonnegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number, got ${value}`)
  }
}

const validate_label = (label: TickCandidateLabel, candidate_id: string): void => {
  const context = `candidate "${candidate_id}" label ${label.tick_index}`
  if (!Number.isInteger(label.tick_index) || label.tick_index < 0) {
    throw new Error(`${context} has invalid tick_index ${label.tick_index}`)
  }
  if (label.display_lines.length === 0) {
    throw new Error(`${context} must have at least one display line`)
  }
  if (label.display_lines.some((line) => typeof line !== `string`)) {
    throw new Error(`${context} display lines must all be strings`)
  }
  if (label.stagger_row !== 0 && label.stagger_row !== 1) {
    throw new Error(`${context} stagger_row must be 0 or 1, got ${label.stagger_row}`)
  }
  if (
    !Number.isFinite(label.information_loss) ||
    label.information_loss < 0 ||
    label.information_loss > 1
  ) {
    throw new Error(
      `${context} information_loss must be a finite number in [0, 1], got ${label.information_loss}`,
    )
  }
}

export const validate_tick_candidate = (candidate: TickStrategyCandidate): void => {
  if (!candidate.id.trim()) throw new Error(`tick candidate id must not be empty`)
  if (!is_tick_strategy(candidate.strategy)) {
    throw new Error(`candidate "${candidate.id}" has unknown strategy "${candidate.strategy}"`)
  }
  if (!Number.isFinite(candidate.rotation_deg)) {
    throw new TypeError(
      `candidate "${candidate.id}" rotation_deg must be finite, got ${candidate.rotation_deg}`,
    )
  }
  candidate.labels.forEach((label, label_idx) => {
    validate_label(label, candidate.id)
    if (label.tick_index !== label_idx) {
      throw new Error(
        `candidate "${candidate.id}" labels must retain stable tick order; expected tick_index ${label_idx}, got ${label.tick_index}`,
      )
    }
  })
}

export const create_tick_candidate = ({
  id,
  strategy,
  labels,
  rotation_deg = 0,
}: CreateTickCandidateInput): TickStrategyCandidate => {
  const candidate: TickStrategyCandidate = {
    id,
    strategy,
    rotation_deg,
    labels: labels.map((input, tick_index) => {
      const label = typeof input === `string` ? { full_text: input } : input
      return {
        tick_index,
        full_text: label.full_text,
        display_lines: [...(label.display_lines ?? [label.full_text])],
        visible: label.visible ?? true,
        stagger_row: label.stagger_row ?? 0,
        information_loss: label.information_loss ?? 0,
      }
    }),
  }
  validate_tick_candidate(candidate)
  return candidate
}

const copy_labels_as_input = (
  candidate: TickStrategyCandidate,
  transform: (label: TickCandidateLabel) => TickCandidateLabelInput,
): TickCandidateLabelInput[] => candidate.labels.map(transform)

const transformed_candidate = (
  candidate: TickStrategyCandidate,
  id: string,
  strategy: TickStrategy,
  labels: readonly TickCandidateLabelInput[],
): TickStrategyCandidate =>
  create_tick_candidate({ id, strategy, labels, rotation_deg: candidate.rotation_deg })

const graphemes = (text: string): string[] =>
  Array.from(grapheme_segmenter.segment(text), ({ segment }) => segment)

const information_grapheme_count = (text: string): number =>
  graphemes(text).filter((character) => /[\p{L}\p{N}]/u.test(character)).length

const transformation_loss = (before: string, after: string): number => {
  if (before === after) return 0
  const before_count = information_grapheme_count(before)
  if (before_count === 0) return 1
  const retained_count = Math.min(before_count, information_grapheme_count(after))
  return 1 - retained_count / before_count
}

const combined_information_loss = (
  previous_loss: number,
  before_lines: readonly string[],
  after_lines: readonly string[],
): number => {
  const next_loss = transformation_loss(before_lines.join(`\n`), after_lines.join(`\n`))
  return 1 - (1 - previous_loss) * (1 - next_loss)
}

export const generate_stagger_candidate = (
  candidate: TickStrategyCandidate,
  { id, first_row = 0 }: StaggerCandidateOptions,
): TickStrategyCandidate => {
  validate_tick_candidate(candidate)
  let visible_order = 0
  const labels = copy_labels_as_input(candidate, (label) => {
    const stagger_row: TickStaggerRow = (visible_order + first_row) % 2 === 0 ? 0 : 1
    if (label.visible) visible_order += 1
    return {
      ...label,
      stagger_row: label.visible ? stagger_row : 0,
    }
  })
  return transformed_candidate(candidate, id, `stagger`, labels)
}

export const generate_thinned_candidate = (
  candidate: TickStrategyCandidate,
  visible_indices: ReadonlySet<number>,
  { id }: TickCandidateTransformOptions,
): TickStrategyCandidate => {
  validate_tick_candidate(candidate)
  for (const tick_index of visible_indices) {
    if (
      !Number.isInteger(tick_index) ||
      tick_index < 0 ||
      tick_index >= candidate.labels.length
    ) {
      throw new Error(
        `candidate "${id}" visible tick index ${tick_index} is outside [0, ${candidate.labels.length})`,
      )
    }
  }
  const labels = copy_labels_as_input(candidate, (label) => ({
    ...label,
    visible: label.visible && visible_indices.has(label.tick_index),
  }))
  return transformed_candidate(candidate, id, `thin`, labels)
}

const preserve_abbreviation_case = (source: string, abbreviation: string): string => {
  if (source === source.toUpperCase()) return abbreviation.toUpperCase()
  const first_character = graphemes(source)[0] ?? ``
  if (first_character === first_character.toUpperCase()) {
    return abbreviation.slice(0, 1).toUpperCase() + abbreviation.slice(1)
  }
  return abbreviation
}

const abbreviate_unprotected_text = (
  text: string,
  abbreviations: Readonly<Record<string, string>>,
): string =>
  text.replace(WORD, (word) => {
    const abbreviation = abbreviations[word.toLowerCase()]
    return abbreviation === undefined ? word : preserve_abbreviation_case(word, abbreviation)
  })

const abbreviate_line = (
  line: string,
  abbreviations: Readonly<Record<string, string>>,
): string =>
  line
    .split(PROTECTED_SEGMENT)
    .map((segment, segment_idx) =>
      segment_idx % 2 === 1 ? segment : abbreviate_unprotected_text(segment, abbreviations),
    )
    .join(``)

export const generate_abbreviated_candidate = (
  candidate: TickStrategyCandidate,
  { id, abbreviations: custom_abbreviations = {} }: AbbreviationCandidateOptions,
): TickStrategyCandidate => {
  validate_tick_candidate(candidate)
  for (const [word, abbreviation] of Object.entries(custom_abbreviations)) {
    if (!word.trim() || !abbreviation.trim()) {
      throw new Error(
        `candidate "${id}" abbreviation keys and values must not be empty, got "${word}" -> "${abbreviation}"`,
      )
    }
  }
  const abbreviations: Readonly<Record<string, string>> = {
    ...DEFAULT_SEMANTIC_ABBREVIATIONS,
    ...custom_abbreviations,
  }
  const labels = copy_labels_as_input(candidate, (label) => {
    const display_lines = NO_BREAK_CHARACTER.test(label.full_text)
      ? [...label.display_lines]
      : label.display_lines.map((line) => abbreviate_line(line, abbreviations))
    return {
      ...label,
      display_lines,
      information_loss: combined_information_loss(
        label.information_loss,
        label.display_lines,
        display_lines,
      ),
    }
  })
  return transformed_candidate(candidate, id, `abbreviate`, labels)
}

const measured_width = (
  text: string,
  measure_text: (text: string) => number,
  context: string,
): number => {
  const width = measure_text(text)
  validate_finite_nonnegative(width, `${context} measured width`)
  return width
}

const ellipsize_line = (
  text: string,
  max_width_px: number,
  ellipsis: string,
  measure_text: (text: string) => number,
  context: string,
): string => {
  if (measured_width(text, measure_text, context) <= max_width_px) return text
  if (measured_width(ellipsis, measure_text, context) > max_width_px) return ``

  const characters = graphemes(text)
  let longest_fitting = ``
  for (let prefix_length = 1; prefix_length <= characters.length; prefix_length++) {
    const prefix = characters
      .slice(0, prefix_length)
      .join(``)
      .replace(/[ \t]+$/u, ``)
    if (measured_width(`${prefix}${ellipsis}`, measure_text, context) <= max_width_px) {
      longest_fitting = prefix
    }
  }
  return `${longest_fitting}${ellipsis}`
}

export const generate_ellipsis_candidate = (
  candidate: TickStrategyCandidate,
  { id, max_width_px, measure_text, ellipsis = `…` }: EllipsisCandidateOptions,
): TickStrategyCandidate => {
  validate_tick_candidate(candidate)
  if (!ellipsis) throw new Error(`candidate "${id}" ellipsis must not be empty`)
  if (typeof max_width_px !== `number` && max_width_px.length !== candidate.labels.length) {
    throw new Error(
      `candidate "${id}" max_width_px length ${max_width_px.length} must match ${candidate.labels.length} labels`,
    )
  }
  const labels = copy_labels_as_input(candidate, (label) => {
    const label_max_width =
      typeof max_width_px === `number` ? max_width_px : max_width_px[label.tick_index]
    validate_finite_nonnegative(
      label_max_width,
      `candidate "${id}" label ${label.tick_index} max_width_px`,
    )
    const display_lines = label.display_lines.map((line, line_idx) =>
      ellipsize_line(
        line,
        label_max_width,
        ellipsis,
        measure_text,
        `candidate "${id}" label ${label.tick_index} line ${line_idx}`,
      ),
    )
    return {
      ...label,
      display_lines,
      information_loss: combined_information_loss(
        label.information_loss,
        label.display_lines,
        display_lines,
      ),
    }
  })
  return transformed_candidate(candidate, id, `ellipsis`, labels)
}
