import type { PhaseHoverInfo, PhaseRegion } from '$lib/phase-diagram/types'

// Helper to create hover info for testing
export function create_hover_info(
  overrides: Partial<PhaseHoverInfo> = {},
): PhaseHoverInfo {
  const default_region: PhaseRegion = {
    id: `liquid`,
    name: `Liquid`,
    vertices: [[0, 800], [1, 800], [1, 1000], [0, 1000]],
  }
  return {
    region: default_region,
    composition: 0.5,
    temperature: 850,
    position: { x: 100, y: 100 },
    ...overrides,
  }
}

// Sample TDB content for testing (simplified Al-Zn system)
export const SAMPLE_TDB_CONTENT = `
$ Al-Zn binary system test database
$ Comment line should be captured

ELEMENT /-   ELECTRON_GAS              0.0000E+00  0.0000E+00  0.0000E+00!
ELEMENT VA   VACUUM                    0.0000E+00  0.0000E+00  0.0000E+00!
ELEMENT AL   FCC_A1                    2.6982E-02  4.5773E+03  2.8322E+01!
ELEMENT ZN   HCP_ZN                    6.5380E-02  5.6568E+03  4.1631E+01!

PHASE LIQUID % 1 1.0 !
PHASE FCC_A1 %A 2 1 1 !
PHASE HCP_ZN %A 2 1 0.5 !

CONSTITUENT LIQUID :AL,ZN: !
CONSTITUENT FCC_A1 :AL,ZN : VA : !
CONSTITUENT HCP_ZN :AL,ZN : VA : !

FUNCTION GHSERAL 298.15 -7976.15+137.093038*T-24.3671976*T*LN(T)
    -.001884662*T**2-8.77664E-07*T**3+74092*T**(-1); 700 Y
    -11276.24+223.048446*T-38.5844296*T*LN(T)+.018531982*T**2
    -5.764227E-06*T**3+74092*T**(-1); 933.47 Y
    -11278.378+188.684153*T-31.748192*T*LN(T)-1.231E+28*T**(-9); 2900 N !

FUNCTION GHSERZN 298.15 -7285.787+118.470069*T-23.7013*T*LN(T)
    -.001712034*T**2-1.264963E-06*T**3; 692.68 Y
    -11070.559+172.345644*T-31.38*T*LN(T)+4.7051E+26*T**(-9); 1700 N !

PARAMETER G(LIQUID,AL;0) 298.15 +GHSERAL+11005.029-11.841867*T; 6000 N !
PARAMETER G(LIQUID,ZN;0) 298.15 +GHSERZN+7157.213-10.29305*T; 6000 N !
PARAMETER L(LIQUID,AL,ZN;0) 298.15 +10465.55-3.39259*T; 6000 N !
`
