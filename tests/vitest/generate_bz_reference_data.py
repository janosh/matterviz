"""
Generate reference Brillouin zone data using seekpath for all 7 crystal systems.
This data will be used for unit testing the TypeScript BZ computation implementation.

Requirements:
    pip install seekpath numpy pymatgen
"""

import json
from pathlib import Path
from typing import Any

import numpy as np
from pymatgen.core import Lattice, Structure
from seekpath import get_explicit_k_path


def create_structure_for_lattice_type(lattice_type: str) -> Structure:
    """Create a simple structure for each of the 7 crystal systems."""

    # Define lattice parameters for each crystal system
    # Format: (a, b, c, alpha, beta, gamma) in Angstroms and degrees
    lattice_params = {
        # Cubic: a = b = c, α = β = γ = 90°
        "cubic": (4.0, 4.0, 4.0, 90, 90, 90),
        # Tetragonal: a = b ≠ c, α = β = γ = 90°
        "tetragonal": (4.0, 4.0, 6.0, 90, 90, 90),
        # Orthorhombic: a ≠ b ≠ c, α = β = γ = 90°
        "orthorhombic": (3.0, 4.0, 5.0, 90, 90, 90),
        # Hexagonal: a = b ≠ c, α = β = 90°, γ = 120°
        "hexagonal": (4.0, 4.0, 6.0, 90, 90, 120),
        # Rhombohedral (Trigonal): a = b = c, α = β = γ ≠ 90°
        "rhombohedral": (4.0, 4.0, 4.0, 75, 75, 75),
        # Monoclinic: a ≠ b ≠ c, α = γ = 90° ≠ β
        "monoclinic": (3.0, 4.0, 5.0, 90, 110, 90),
        # Triclinic: a ≠ b ≠ c, α ≠ β ≠ γ
        "triclinic": (3.0, 4.0, 5.0, 80, 100, 110),
    }

    # Create lattice
    a, b, c, alpha, beta, gamma = lattice_params[lattice_type]
    lattice = Lattice.from_parameters(a, b, c, alpha, beta, gamma)

    # Create a simple structure with one atom at origin
    # Use Si as a generic atom (atomic number 14)
    structure = Structure(lattice, ["Si"], [[0, 0, 0]])

    return structure


def get_brillouin_zone_data(structure: Structure) -> dict[str, Any]:
    """
    Get Brillouin zone data using seekpath.

    Returns:
        Dictionary containing BZ vertices, edges, faces, and reciprocal lattice vectors.
    """
    # Convert to tuple format required by seekpath
    cell = structure.lattice.matrix.tolist()
    positions = structure.frac_coords.tolist()
    numbers = [site.specie.Z for site in structure]

    # Get k-path and BZ data from seekpath
    result = get_explicit_k_path(
        structure=(cell, positions, numbers),
        with_time_reversal=True,
        reference_distance=0.025,
        recipe="hpkot",
        threshold=1e-7,
        symprec=1e-5,
        angle_tolerance=-1.0,
    )

    # Extract Brillouin zone information
    bz_data = {
        "lattice_type": result.get("bravais_lattice", "unknown"),
        "lattice_extended": result.get("bravais_lattice_extended", "unknown"),
        "space_group_number": result.get("spacegroup_number", None),
        "space_group_international": result.get("spacegroup_international", None),
        # Real space lattice
        "real_lattice": structure.lattice.matrix.tolist(),
        # Reciprocal lattice (in 2π/Å units)
        "reciprocal_lattice": structure.lattice.reciprocal_lattice.matrix.tolist(),
        # Reciprocal lattice parameters
        "reciprocal_lattice_params": {
            "a": float(structure.lattice.reciprocal_lattice.a),
            "b": float(structure.lattice.reciprocal_lattice.b),
            "c": float(structure.lattice.reciprocal_lattice.c),
            "alpha": float(structure.lattice.reciprocal_lattice.alpha),
            "beta": float(structure.lattice.reciprocal_lattice.beta),
            "gamma": float(structure.lattice.reciprocal_lattice.gamma),
        },
        # High-symmetry points
        "kpoints": {
            k: v.tolist() if isinstance(v, np.ndarray) else v
            for k, v in result.get("point_coords", {}).items()
        },
        # Primitive cell
        "primitive_lattice": np.array(result["primitive_lattice"]).tolist(),
        "primitive_positions": [
            pos.tolist() if isinstance(pos, np.ndarray) else pos
            for pos in result["primitive_positions"]
        ],
        "primitive_types": [int(t) for t in result["primitive_types"]],
    }

    # Try to get explicit BZ vertices if available
    # Note: seekpath doesn't directly provide BZ polyhedron vertices,
    # but we can compute them from the reciprocal lattice
    reciprocal_lattice = structure.lattice.reciprocal_lattice.matrix

    # Generate k-space grid for Voronoi construction (same as our TS implementation)
    k_points = []
    for i in range(-1, 2):
        for j in range(-1, 2):
            for k in range(-1, 2):
                point = (
                    i * reciprocal_lattice[0]
                    + j * reciprocal_lattice[1]
                    + k * reciprocal_lattice[2]
                )
                k_points.append(point.tolist())

    bz_data["k_space_grid"] = k_points

    # Add BZ volume (volume of reciprocal lattice fundamental domain)
    bz_data["bz_volume_approximation"] = abs(np.linalg.det(reciprocal_lattice))

    return bz_data


def generate_all_reference_data() -> dict[str, Any]:
    """Generate reference data for all 7 crystal systems."""

    reference_data = {}

    for lattice_type in [
        "cubic",
        "tetragonal",
        "orthorhombic",
        "hexagonal",
        "rhombohedral",
        "monoclinic",
        "triclinic",
    ]:
        print(f"Generating reference data for {lattice_type}...")

        try:
            structure = create_structure_for_lattice_type(lattice_type)
            bz_data = get_brillouin_zone_data(structure)
            reference_data[lattice_type] = bz_data

            print(f"  ✓ {lattice_type}: {bz_data['lattice_extended']}")
            print(
                f"    Space group: {bz_data['space_group_international']} (#{bz_data['space_group_number']})"
            )

        except Exception as exc:
            print(f"  ✗ Failed to generate data for {lattice_type}: {exc}")
            reference_data[lattice_type] = {"error": str(exc)}

    return reference_data


def main() -> None:
    """Main entry point."""
    print("Generating Brillouin zone reference data using seekpath...")
    print("=" * 70)

    reference_data = generate_all_reference_data()

    # Save to JSON file
    output_dir = Path(__file__).parent
    output_file = output_dir / "bz_reference_data.json"

    with open(output_file, "w") as file_handle:
        json.dump(reference_data, file_handle, indent=2)

    print("=" * 70)
    print(f"Reference data saved to: {output_file}")
    print(f"Generated data for {len(reference_data)} lattice types")

    # Print summary statistics
    print("\nSummary:")
    for lattice_type, data in reference_data.items():
        if "error" in data:
            print(f"  {lattice_type}: ERROR - {data['error']}")
        else:
            n_kpoints = len(data.get("kpoints", {}))
            print(f"  {lattice_type}: {n_kpoints} high-symmetry k-points")


if __name__ == "__main__":
    main()
