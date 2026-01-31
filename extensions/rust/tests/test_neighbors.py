"""Tests for the O(n) cell-list neighbor finding implementation."""

import json
import time

import numpy as np
import pytest

import ferrox


def make_fcc_cu(lattice_const: float = 3.61) -> dict:
    """Create FCC Cu structure."""
    return {
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {
            "matrix": [
                [lattice_const, 0.0, 0.0],
                [0.0, lattice_const, 0.0],
                [0.0, 0.0, lattice_const],
            ],
            "pbc": [True, True, True],
        },
        "sites": [
            {"species": [{"element": "Cu", "occu": 1.0}], "abc": [0.0, 0.0, 0.0]},
            {"species": [{"element": "Cu", "occu": 1.0}], "abc": [0.5, 0.5, 0.0]},
            {"species": [{"element": "Cu", "occu": 1.0}], "abc": [0.5, 0.0, 0.5]},
            {"species": [{"element": "Cu", "occu": 1.0}], "abc": [0.0, 0.5, 0.5]},
        ],
    }


def make_bcc_fe(lattice_const: float = 2.87) -> dict:
    """Create BCC Fe structure."""
    return {
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {
            "matrix": [
                [lattice_const, 0.0, 0.0],
                [0.0, lattice_const, 0.0],
                [0.0, 0.0, lattice_const],
            ],
            "pbc": [True, True, True],
        },
        "sites": [
            {"species": [{"element": "Fe", "occu": 1.0}], "abc": [0.0, 0.0, 0.0]},
            {"species": [{"element": "Fe", "occu": 1.0}], "abc": [0.5, 0.5, 0.5]},
        ],
    }


def make_nacl(lattice_const: float = 5.64) -> dict:
    """Create NaCl rocksalt structure."""
    return {
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {
            "matrix": [
                [lattice_const, 0.0, 0.0],
                [0.0, lattice_const, 0.0],
                [0.0, 0.0, lattice_const],
            ],
            "pbc": [True, True, True],
        },
        "sites": [
            {"species": [{"element": "Na", "occu": 1.0}], "abc": [0.0, 0.0, 0.0]},
            {"species": [{"element": "Na", "occu": 1.0}], "abc": [0.5, 0.5, 0.0]},
            {"species": [{"element": "Na", "occu": 1.0}], "abc": [0.5, 0.0, 0.5]},
            {"species": [{"element": "Na", "occu": 1.0}], "abc": [0.0, 0.5, 0.5]},
            {"species": [{"element": "Cl", "occu": 1.0}], "abc": [0.5, 0.5, 0.5]},
            {"species": [{"element": "Cl", "occu": 1.0}], "abc": [0.0, 0.0, 0.5]},
            {"species": [{"element": "Cl", "occu": 1.0}], "abc": [0.0, 0.5, 0.0]},
            {"species": [{"element": "Cl", "occu": 1.0}], "abc": [0.5, 0.0, 0.0]},
        ],
    }


def make_large_supercell(n: int = 3) -> dict:
    """Create a large FCC Cu supercell for performance testing."""
    base = make_fcc_cu()
    base_lattice = np.array(base["lattice"]["matrix"])
    base_sites = base["sites"]

    # Create supercell
    new_lattice = (base_lattice * n).tolist()
    new_sites = []

    for idx_a in range(n):
        for idx_b in range(n):
            for idx_c in range(n):
                for site in base_sites:
                    abc = site["abc"]
                    new_abc = [
                        (abc[0] + idx_a) / n,
                        (abc[1] + idx_b) / n,
                        (abc[2] + idx_c) / n,
                    ]
                    new_sites.append({
                        "species": site["species"],
                        "abc": new_abc,
                    })

    return {
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {
            "matrix": new_lattice,
            "pbc": [True, True, True],
        },
        "sites": new_sites,
    }


class TestNeighborListBasics:
    """Basic neighbor list functionality tests."""

    def test_fcc_coordination_12(self) -> None:
        """FCC structure should have CN=12 for each site."""
        fcc = json.dumps(make_fcc_cu())
        cutoff = 3.0  # covers first shell at ~2.55 Å

        centers, neighbors, images, distances = ferrox.get_neighbor_list(fcc, cutoff)

        # Count neighbors per site
        counts = [0] * 4
        for center in centers:
            counts[center] += 1

        # Each site should have 12 neighbors
        assert all(count == 12 for count in counts), f"Expected CN=12, got {counts}"

    def test_bcc_coordination_8(self) -> None:
        """BCC structure should have CN=8 for first shell."""
        bcc = json.dumps(make_bcc_fe())
        cutoff = 2.6  # covers first shell at ~2.48 Å

        centers, neighbors, images, distances = ferrox.get_neighbor_list(bcc, cutoff)

        # Count neighbors per site
        counts = [0] * 2
        for center in centers:
            counts[center] += 1

        # Each site should have 8 neighbors
        assert all(count == 8 for count in counts), f"Expected CN=8, got {counts}"

    def test_nacl_coordination_6(self) -> None:
        """NaCl structure should have CN=6 for each site."""
        nacl = json.dumps(make_nacl())
        cutoff = 3.5  # covers first shell at ~2.82 Å

        centers, neighbors, images, distances = ferrox.get_neighbor_list(nacl, cutoff)

        # Count neighbors per site
        counts = [0] * 8
        for center in centers:
            counts[center] += 1

        # Each site should have 6 neighbors
        assert all(count == 6 for count in counts), f"Expected CN=6, got {counts}"

    def test_distance_values(self) -> None:
        """Check that distance values are correct for FCC."""
        fcc = json.dumps(make_fcc_cu(3.61))
        cutoff = 3.0

        centers, neighbors, images, distances = ferrox.get_neighbor_list(fcc, cutoff)

        # Expected first shell distance: a/sqrt(2) ≈ 2.552 Å
        expected_dist = 3.61 / np.sqrt(2)

        for dist in distances:
            assert abs(dist - expected_dist) < 0.1, f"Distance {dist} doesn't match expected {expected_dist}"

    def test_empty_result_for_small_cutoff(self) -> None:
        """Very small cutoff should return empty neighbor list."""
        fcc = json.dumps(make_fcc_cu())
        cutoff = 0.1  # too small to find any neighbors

        centers, neighbors, images, distances = ferrox.get_neighbor_list(fcc, cutoff)

        assert len(centers) == 0

    def test_negative_cutoff(self) -> None:
        """Negative cutoff should raise an error."""
        fcc = json.dumps(make_fcc_cu())

        with pytest.raises(ValueError):
            ferrox.get_neighbor_list(fcc, -1.0)


class TestPeriodicImages:
    """Tests for periodic boundary condition handling."""

    def test_periodic_images_present(self) -> None:
        """Neighbor list should include periodic images."""
        fcc = json.dumps(make_fcc_cu())
        cutoff = 3.0

        centers, neighbors, images, distances = ferrox.get_neighbor_list(fcc, cutoff)

        # Some images should be non-zero
        nonzero_images = [img for img in images if img != [0, 0, 0]]
        assert len(nonzero_images) > 0, "Expected some periodic images"

    def test_image_offsets_correct(self) -> None:
        """Image offsets should be small integers."""
        fcc = json.dumps(make_fcc_cu())
        cutoff = 3.0

        centers, neighbors, images, distances = ferrox.get_neighbor_list(fcc, cutoff)

        for img in images:
            assert all(abs(x) <= 1 for x in img), f"Unexpected large image offset: {img}"


class TestPerformance:
    """Performance tests to verify O(n) scaling."""

    @pytest.mark.parametrize("supercell_size", [2, 3, 4])
    def test_scaling_with_system_size(self, supercell_size: int) -> None:
        """Verify that neighbor finding completes in reasonable time."""
        struct = make_large_supercell(supercell_size)
        num_atoms = len(struct["sites"])
        struct_json = json.dumps(struct)
        cutoff = 3.0

        start = time.perf_counter()
        centers, neighbors, images, distances = ferrox.get_neighbor_list(struct_json, cutoff)
        elapsed = time.perf_counter() - start

        # Should complete in well under 1 second even for ~500 atoms
        assert elapsed < 2.0, f"Neighbor finding took {elapsed:.2f}s for {num_atoms} atoms"

        # Verify we found neighbors
        assert len(centers) > 0, f"No neighbors found for {num_atoms} atom system"


class TestConsistency:
    """Tests for consistency with coordination analysis functions."""

    def test_consistency_with_coordination_numbers(self) -> None:
        """Neighbor list should be consistent with coordination numbers."""
        fcc = json.dumps(make_fcc_cu())
        cutoff = 3.0

        # Get neighbor list
        centers, neighbors, images, distances = ferrox.get_neighbor_list(fcc, cutoff)

        # Get coordination numbers
        cns = ferrox.get_coordination_numbers(fcc, cutoff)

        # Count from neighbor list
        nl_counts = [0] * len(cns)
        for center in centers:
            nl_counts[center] += 1

        assert nl_counts == cns, f"Mismatch: NL counts {nl_counts} vs CN {cns}"

    def test_consistency_with_local_environment(self) -> None:
        """Neighbor list should be consistent with local environment."""
        fcc = json.dumps(make_fcc_cu())
        cutoff = 3.0

        # Get neighbor list
        centers, neighbors, images, distances = ferrox.get_neighbor_list(fcc, cutoff)

        # Get local environment for site 0
        local_env = ferrox.get_local_environment(fcc, 0, cutoff)

        # Count neighbors of site 0 from neighbor list
        nl_count = sum(1 for center in centers if center == 0)

        assert nl_count == len(local_env), f"NL count {nl_count} vs local_env {len(local_env)}"
