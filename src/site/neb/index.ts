// Demo reaction-path fixtures.
//
// SYNTHETIC — li-mgo-interstitial-hop.json.gz is NOT a real calculation. No DFT, NEB or MD
// code produced it. Geometries are an ideal rocksalt MgO cell (cubic, a = 4.21 Å, 8
// framework atoms) plus one Li interstitial walked along a hand-chosen route; energies come
// from E(u) = A·sin²(πu) + 0.18·u eV (A = 0.75 direct, A = 1.05 curved, u the normalised arc
// length) shifted by a constant −284.317 eV so they look like VASP totals; the direct hop's
// forces are the analytic −dE/ds of that expression projected on the path tangent. The same
// disclosure is carried in the file's own `_comment` field so it survives a download.
//
// It is shaped to exercise the viewer: the Li leaves the cell through the z face and
// re-enters on the other side, so the reaction coordinate is only correct under the
// minimum-image convention. Both mechanisms share endpoints — and therefore a reaction
// energy of +0.18 eV — but differ in barrier: the direct hop carries force data
// (force-projected spline), the curved hop does not (natural cubic).

import type { ReactionPath } from '$lib/neb'
import { parse_reaction_path_json } from '$lib/neb/parse'
import raw_doc from './li-mgo-interstitial-hop.json.gz'

export const LI_MGO_HOP_FILENAME = `li-mgo-interstitial-hop.json`

export const li_mgo_hop_json: string = JSON.stringify(raw_doc)

export const reaction_paths: Record<string, ReactionPath> = parse_reaction_path_json(
  li_mgo_hop_json,
  LI_MGO_HOP_FILENAME,
)
