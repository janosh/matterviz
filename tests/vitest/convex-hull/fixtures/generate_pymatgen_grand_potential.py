"""Generate pymatgen GrandPotentialPhaseDiagram references for the shipped Li-Co-Ni-O hull.

Run from the repo root:
uv run --no-project --with pymatgen python tests/vitest/convex-hull/fixtures/generate_pymatgen_grand_potential.py
"""

import gzip
import json
import os

from pymatgen.analysis.phase_diagram import GrandPotentialPhaseDiagram
from pymatgen.core import Composition, Element
from pymatgen.entries.computed_entries import ComputedEntry

# Oxygen chemical potentials relative to the lowest-energy elemental O entry (eV/atom)
DELTA_MU_O = (0.0, -1.5, -3.0)


def generate_reference() -> dict:
    """Grand-potential e_above_hull (eV per non-O atom) of every entry with a non-O element."""
    repo_root = f"{os.path.dirname(__file__)}/../../../.."
    data_path = f"{repo_root}/src/site/convex-hull/quaternaries/Li-Co-Ni-O.json.gz"
    with gzip.open(data_path, "rt") as file:
        raw_entries = json.load(file)
    if len({raw["entry_id"] for raw in raw_entries}) != len(raw_entries):
        raise ValueError("entry_ids must be unique to key the reference")
    entries = [
        ComputedEntry(
            Composition(raw["composition"]),
            raw["energy"],
            correction=raw.get("correction", 0.0),
            entry_id=raw["entry_id"],
        )
        for raw in raw_entries
    ]
    o_ref = min(
        entry.energy_per_atom
        for entry in entries
        if entry.composition.reduced_formula == "O2"
    )
    cases = []
    for delta_mu in DELTA_MU_O:
        mu_o = o_ref + delta_mu
        grand_pd = GrandPotentialPhaseDiagram(entries, {Element("O"): mu_o})
        hull_distances = {
            entry.original_entry.entry_id: round(float(grand_pd.get_e_above_hull(entry)), 12)
            for entry in grand_pd.all_entries
        }
        cases.append({"mu_O": mu_o, "e_above_hull": hull_distances})
    return {"o_ref_energy_per_atom": o_ref, "cases": cases}


if __name__ == "__main__":
    reference = generate_reference()
    out_path = f"{os.path.dirname(__file__)}/li_co_ni_o_grand_potential_reference.json.gz"
    with gzip.GzipFile(out_path, mode="wb", mtime=0) as file:
        file.write(json.dumps(reference, separators=(",", ":")).encode())
