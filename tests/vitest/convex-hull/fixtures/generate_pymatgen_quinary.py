"""Generate pymatgen reference data for 5-element (quinary) convex hull validation.

This script creates a PhaseDiagram using pymatgen and exports the entries
with their hull distances to JSON for comparison with our TypeScript implementation.

The reference uses a simple structure that avoids numerical degeneracy issues:
- 5 elemental corners at energy = 0
- A few quinary (5-element) compounds at various energy levels
- One stable interior point that creates a non-trivial lower hull

This structure tests the core N-dimensional hull algorithm without the complexity
of handling many lower-arity subsystems embedded in the higher-dimensional space.
"""

import json
import os

from pymatgen.analysis.phase_diagram import PDEntry, PhaseDiagram
from pymatgen.core import Composition


def generate_quinary_reference() -> dict:
    """Generate reference data for a 5-element system using pymatgen."""
    # Create entries for a Li-Na-K-Rb-Cs system (alkali metals)
    # Use a simple structure: 5 corners + quinary compounds only
    # This avoids numerical degeneracy from lower-arity subsystems

    entries = [
        # Pure elements (reference state, e_form = 0)
        PDEntry(Composition("Li"), 0.0),
        PDEntry(Composition("Na"), 0.0),
        PDEntry(Composition("K"), 0.0),
        PDEntry(Composition("Rb"), 0.0),
        PDEntry(Composition("Cs"), 0.0),
        # Quinary compounds - all contain all 5 elements
        # Stable: below tie-hyperplane (energy < 0)
        PDEntry(Composition("LiNaKRbCs"), -0.50),  # Stable, deep below hull
        # Unstable: above the hull formed by corners + stable interior
        PDEntry(Composition("LiNaKRbCs"), 0.10),  # Unstable, above hull
        PDEntry(Composition("LiNaKRbCs"), 0.30),  # More unstable
        # Different stoichiometries (still quinary)
        PDEntry(Composition("Li2NaKRbCs"), -0.20),  # Stable at this composition
        PDEntry(Composition("Li2NaKRbCs"), 0.15),  # Unstable at this composition
        PDEntry(Composition("LiNa2K2RbCs"), -0.15),  # Stable
        PDEntry(Composition("LiNaK2Rb2Cs"), -0.10),  # Stable
    ]

    # Build phase diagram
    pd = PhaseDiagram(entries)

    # Extract data for each entry
    output_entries = []
    for idx, entry in enumerate(entries):
        comp_dict = {str(el): float(amt) for el, amt in entry.composition.items()}
        e_above_hull_raw = pd.get_e_above_hull(entry)
        e_above_hull = float(e_above_hull_raw) if e_above_hull_raw is not None else 0.0

        output_entries.append(
            {
                "id": f"entry_{idx}",
                "composition": comp_dict,
                "energy_per_atom": float(entry.energy_per_atom),
                "e_above_hull": e_above_hull,
                "is_stable": bool(e_above_hull < 1e-10),
            }
        )

    return {
        "elements": ["Li", "Na", "K", "Rb", "Cs"],
        "entries": output_entries,
        "n_stable": len([entry for entry in output_entries if entry["is_stable"]]),
        "n_unstable": len(
            [entry for entry in output_entries if not entry["is_stable"]]
        ),
    }


def main() -> None:
    """Generate and save pymatgen reference data."""
    data = generate_quinary_reference()

    # Save to JSON file in the same directory
    output_path = os.path.join(
        os.path.dirname(__file__), "quinary_pymatgen_reference.json"
    )
    with open(output_path, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=2)

    print(f"Generated {output_path}")
    print(f"  Elements: {data['elements']}")
    print(f"  Total entries: {len(data['entries'])}")
    print(f"  Stable: {data['n_stable']}, Unstable: {data['n_unstable']}")


if __name__ == "__main__":
    main()
