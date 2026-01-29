"""Extract oxidation states and Shannon radii from pymatgen's periodic table data.

This script reads pymatgen's periodic_table.json.gz and extracts:
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
    deno (for parsing TypeScript files)
"""

import gzip
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

# Project root is the parent of the scripts/ directory
PROJECT_ROOT = Path(__file__).parent.parent.resolve()


def load_pymatgen_data() -> dict[str, Any]:
    """Load pymatgen's periodic table JSON data."""
    try:
        import pymatgen.core
        pymatgen_path = Path(pymatgen.core.__file__).parent / "periodic_table.json.gz"
    except ImportError:
        print("pymatgen not installed. Install with: pip install pymatgen")
        raise

    with gzip.open(pymatgen_path, "rb") as file:
        data = json.loads(file.read())

    # Remove the _unit metadata key
    data.pop("_unit", None)
    return data


def load_existing_data(path: Path) -> list[dict[str, Any]]:
    """Load existing element data from TypeScript file or JSON."""
    if path.suffix == ".json":
        with open(path, encoding="utf-8") as file:
            return json.load(file)

    # For TypeScript files, use Deno to export as JSON
    if not shutil.which("deno"):
        raise RuntimeError(
            "deno is required to parse TypeScript files. "
            "Install from https://deno.land or run: curl -fsSL https://deno.land/install.sh | sh"
        )

    relative_path = path.relative_to(PROJECT_ROOT)
    result = subprocess.run(
        ["deno", "eval", f"import data from './{relative_path}'; console.log(JSON.stringify(data))"],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        raise RuntimeError(f"deno failed to parse {path}:\n{result.stderr}")

    return json.loads(result.stdout)


def extract_pymatgen_properties(pymatgen_data: dict[str, Any], symbol: str) -> dict[str, Any]:
    """Extract relevant properties from pymatgen data for a given element."""
    if symbol not in pymatgen_data:
        return {}

    elem_data = pymatgen_data[symbol]
    result: dict[str, Any] = {}

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
            str(k): v for k, v in elem_data["Ionic radii"].items()
        }

    # Shannon radii (full nested structure)
    if "Shannon radii" in elem_data:
        result["shannon_radii"] = elem_data["Shannon radii"]

    return result


def merge_data(
    existing: list[dict[str, Any]],
    pymatgen_data: dict[str, Any]
) -> list[dict[str, Any]]:
    """Merge pymatgen data into existing element data."""
    result = []

    for elem in existing:
        symbol = elem["symbol"]
        merged = {**elem}

        # Extract and add pymatgen properties
        pymatgen_props = extract_pymatgen_properties(pymatgen_data, symbol)
        merged.update(pymatgen_props)

        result.append(merged)

    return result


def main() -> None:
    """Main entry point."""
    data_path = PROJECT_ROOT / "src" / "lib" / "element" / "data.ts"
    output_path = PROJECT_ROOT / "src" / "lib" / "element" / "data.json"

    print(f"Loading existing data from {data_path}")
    existing_data = load_existing_data(data_path)
    print(f"Loaded {len(existing_data)} elements")

    print("Loading pymatgen periodic table data...")
    pymatgen_data = load_pymatgen_data()
    print(f"Loaded pymatgen data for {len(pymatgen_data)} elements")

    print("Merging data...")
    merged_data = merge_data(existing_data, pymatgen_data)

    # Verify we have oxidation states for common elements
    sample_elements = ["Fe", "O", "Na", "Cl"]
    for symbol in sample_elements:
        elem = next((e for e in merged_data if e["symbol"] == symbol), None)
        if elem:
            oxi = elem.get("oxidation_states", [])
            common = elem.get("common_oxidation_states", [])
            shannon = "yes" if elem.get("shannon_radii") else "no"
            print(f"  {symbol}: oxidation_states={oxi}, common={common}, shannon={shannon}")

    print(f"Writing output to {output_path}")
    with open(output_path, "w", encoding="utf-8") as file:
        json.dump(merged_data, file, indent=2, ensure_ascii=False)

    print("Done!")


if __name__ == "__main__":
    main()
