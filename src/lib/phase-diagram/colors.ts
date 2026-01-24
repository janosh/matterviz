// Phase diagram color palette
// Keys can be referenced in diagram JSON files

function rgba(r: number, g: number, b: number, a: number = 0.6): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

// Color palette for diagram JSON files - keyed colors that can be referenced by name
export const DIAGRAM_COLORS = {
  // Single-phase regions (alpha=0.6)
  liquid: rgba(135, 206, 250),
  fcc_a1: rgba(144, 238, 144),
  fcc_cu: rgba(255, 180, 150),
  bcc_a2: rgba(255, 182, 193),
  hcp_a3: rgba(221, 160, 221),
  diamond: rgba(173, 216, 230),
  intermetallic: rgba(255, 200, 150),
  intermetallic_alt: rgba(200, 180, 255),
  intermetallic_blue: rgba(180, 200, 230),
  gold: rgba(255, 215, 0),
  // Two-phase regions (alpha=0.5)
  two_phase: rgba(255, 235, 156, 0.5),
  two_phase_fcc_liquid: rgba(180, 230, 180, 0.5),
  two_phase_fcc_alt: rgba(200, 230, 200, 0.5),
  two_phase_bcc_liquid: rgba(255, 200, 200, 0.5),
  two_phase_hcp_liquid: rgba(230, 180, 230, 0.5),
  two_phase_intermetallic: rgba(255, 220, 180, 0.5),
  two_phase_intermetallic_alt: rgba(255, 210, 180, 0.5),
  two_phase_theta_liquid: rgba(255, 235, 200, 0.5),
  two_phase_theta_cu: rgba(255, 200, 180, 0.5),
  two_phase_alt: rgba(220, 200, 240, 0.5),
  two_phase_mixed: rgba(230, 200, 220, 0.5),
  two_phase_gamma: rgba(180, 200, 250, 0.5),
  two_phase_gamma_hcp: rgba(230, 230, 180, 0.5),
  two_phase_ausn: rgba(200, 180, 230, 0.5),
  two_phase_si: rgba(180, 220, 250, 0.5),
  two_phase_au_liquid: rgba(255, 235, 150, 0.5),
  two_phase_au_ausn: rgba(255, 230, 180, 0.5),
  two_phase_eta: rgba(230, 200, 230, 0.5),
  two_phase_alfe: rgba(220, 200, 255, 0.5),
  two_phase_alfe_bcc: rgba(230, 200, 200, 0.5),
  two_phase_beta_gamma: rgba(230, 200, 180, 0.5),
} as const

export type DiagramColorKey = keyof typeof DIAGRAM_COLORS

// Resolve color from DIAGRAM_COLORS key or pass through raw CSS color string
export function resolve_diagram_color(color: string): string {
  const resolved = (DIAGRAM_COLORS as Record<string, string>)[color]
  const is_raw_color = color.startsWith(`rgb`) ||
    color.startsWith(`hsl`) ||
    color.startsWith(`#`) ||
    color.startsWith(`var(`)
  if (!resolved && !is_raw_color) {
    console.warn(`Unknown diagram color key: "${color}". Using as raw color value.`)
  }
  return resolved ?? color
}
