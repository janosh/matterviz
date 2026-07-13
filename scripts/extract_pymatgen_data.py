"""Extract oxidation states, Shannon radii, and Mendeleev numbers from pymatgen data.

This script reads pymatgen's periodic_table.json.gz and extracts:
- Mendeleev number (Pettifor's chemical scale for crystal-structure maps)
- Oxidation states (all known)
- Common oxidation states
- ICSD oxidation states
- Ionic radii (by oxidation state)
- Shannon radii (full nested structure with coordination and spin)

The output is merged with the existing element data to create a complete JSON file.

Usage:
    python scripts/extract_pymatgen_data.py

Requirements:
    pip install pymatgen
"""

import gzip
import json
from pathlib import Path
from typing import Any

# Project root is the parent of the scripts/ directory
PROJECT_ROOT = Path(__file__).parent.parent.resolve()


def extract_pymatgen_properties(
    pymatgen_data: dict[str, Any], symbol: str
) -> dict[str, Any]:
    """Extract relevant properties from pymatgen data for a given element."""
    if symbol not in pymatgen_data:
        return {}

    elem_data = pymatgen_data[symbol]
    result: dict[str, Any] = {}

    # Mendeleev number (Pettifor's chemical scale for crystal-structure maps)
    if "Mendeleev no" in elem_data:
        result["mendeleev_number"] = elem_data["Mendeleev no"]

    # Oxidation states
    if "Oxidation states" in elem_data:
        result["oxidation_states"] = sorted(elem_data["Oxidation states"])

    if "Common oxidation states" in elem_data:
        result["common_oxidation_states"] = sorted(elem_data["Common oxidation states"])

    if "ICSD oxidation states" in elem_data:
        result["icsd_oxidation_states"] = sorted(elem_data["ICSD oxidation states"])

    # Ionic radii (simplified: just oxidation state -> radius)
    if "Ionic radii" in elem_data:
        result["ionic_radii"] = {
            str(oxi_state): radius
            for oxi_state, radius in elem_data["Ionic radii"].items()
        }

    # Shannon radii (full nested structure)
    if "Shannon radii" in elem_data:
        result["shannon_radii"] = elem_data["Shannon radii"]

    return result


def main() -> None:
    """Main entry point."""
    gz_path = PROJECT_ROOT / "src" / "lib" / "element" / "data.json.gz"

    print(f"Loading existing data from {gz_path}")
    with gzip.open(gz_path, "rb") as file:
        existing_data: list[dict[str, Any]] = json.loads(file.read())
    print(f"Loaded {len(existing_data)} elements")

    print("Loading pymatgen periodic table data...")
    try:
        import pymatgen.core
    except ImportError:
        print("pymatgen not installed. Install with: pip install pymatgen")
        raise
    pymatgen_path = Path(pymatgen.core.__file__).parent / "periodic_table.json.gz"
    with gzip.open(pymatgen_path, "rb") as file:
        pymatgen_data: dict[str, Any] = json.loads(file.read())
    pymatgen_data.pop("_unit", None)
    print(f"Loaded pymatgen data for {len(pymatgen_data)} elements")

    print("Merging data...")
    merged_data = [
        {**elem, **extract_pymatgen_properties(pymatgen_data, elem["symbol"])}
        for elem in existing_data
    ]

    # Verify we have key properties for common elements
    sample_elements = ["Fe", "O", "Na", "Cl"]
    for symbol in sample_elements:
        elem = next((el for el in merged_data if el["symbol"] == symbol), None)
        if elem:
            oxi = elem.get("oxidation_states", [])
            common = elem.get("common_oxidation_states", [])
            shannon = "yes" if elem.get("shannon_radii") else "no"
            mendeleev = elem.get("mendeleev_number", "N/A")
            print(
                f"  {symbol}: mendeleev_number={mendeleev}, "
                f"oxidation_states={oxi}, common={common}, shannon={shannon}"
            )

    # Write gzipped JSON (used by TypeScript via Vite plugin and Rust via flate2)
    json_bytes = json.dumps(merged_data, indent=2, ensure_ascii=False).encode("utf-8")
    print(f"Writing gzipped output to {gz_path}")
    with gzip.open(gz_path, "wb") as file:
        file.write(json_bytes)

    print(f"Done! {len(json_bytes):,} bytes -> {gz_path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
