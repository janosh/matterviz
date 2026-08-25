# /// script
# requires-python = ">=3.11"
# dependencies = ["pymatgen>=2024.1.1"]
# ///
"""Reference values from pymatgen for the synthesis planner tests.

Builds a PhaseDiagram from the Ba-Ti-O demo fixture's formation energies (elements at 0 eV/atom)
and records every entry's hull distance plus the InterfacialReactivity profile along BaO-TiO2, so
the LP-based hull and the per-reactant-atom driving forces can be checked against pymatgen.

Run with: uv run tests/vitest/synthesis-planning/fixtures/generate_pymatgen_reference.py
"""

from __future__ import annotations

import gzip
import json
import os

from pymatgen.analysis.interface_reactions import InterfacialReactivity
from pymatgen.analysis.phase_diagram import PDEntry, PhaseDiagram
from pymatgen.core import Composition

fixtures_dir = os.path.dirname(os.path.abspath(__file__))
system_file = f"{fixtures_dir}/../../../../src/site/phase-diagrams/ternary/Ba-Ti-O.json.gz"


def main() -> None:
    """Write ba_ti_o_pymatgen_reference.json next to this script."""
    with gzip.open(system_file, mode="rt", encoding="utf-8") as file:
        raw_entries = json.load(file)
    entries = [PDEntry(Composition("Ba"), 0), PDEntry(Composition("Ti"), 0), PDEntry(Composition("O"), 0)]
    for raw in raw_entries:
        composition = Composition(raw["composition"])
        entries.append(
            PDEntry(composition, raw["e_form_per_atom"] * composition.num_atoms, attribute=raw["entry_id"])
        )
    diagram = PhaseDiagram(entries)
    hull_distances = {
        entry.attribute: diagram.get_e_above_hull(entry) for entry in entries if entry.attribute
    }
    # Lowest-energy entry per formula, as the planner deduplicates polymorphs
    best: dict[str, PDEntry] = {}
    for entry in entries:
        key = entry.composition.reduced_formula
        if key not in best or entry.energy_per_atom < best[key].energy_per_atom:
            best[key] = entry
    reactivity = InterfacialReactivity(
        Composition("BaO"), Composition("TiO2"), diagram, norm=True, use_hull_energy=False
    )
    kinks = [
        {
            "mixing_ratio": ratio,
            "reaction_energy_per_atom": energy,
            "reaction": str(reaction),
        }
        for _idx, ratio, energy, reaction, _rxn_energy in reactivity.get_kinks()
    ]
    reference = {
        "e_above_hull": hull_distances,
        "stable_formulas": sorted(entry.composition.reduced_formula for entry in diagram.stable_entries),
        "bao_tio2_kinks": kinks,
    }
    out_path = f"{fixtures_dir}/ba_ti_o_pymatgen_reference.json"
    with open(out_path, mode="w", encoding="utf-8") as file:
        json.dump(reference, file, indent=1)
    print(f"wrote {len(hull_distances)} hull distances and {len(kinks)} kinks to {out_path}")


if __name__ == "__main__":
    main()
