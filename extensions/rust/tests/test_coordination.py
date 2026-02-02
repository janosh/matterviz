"""Tests for ferrox coordination analysis functions."""

from __future__ import annotations

import json

import pytest

try:
    from ferrox import coordination
except ImportError:
    pytest.skip("ferrox not installed", allow_module_level=True)

# Helpers (fixtures auto-discovered from conftest.py)


def make_structure(lattice_a: float, sites: list[dict]) -> str:
    """Create structure JSON with cubic lattice."""
    return json.dumps(
        {
            "@module": "pymatgen.core.structure",
            "@class": "Structure",
            "lattice": {
                "matrix": [[lattice_a, 0, 0], [0, lattice_a, 0], [0, 0, lattice_a]]
            },
            "sites": sites,
        }
    )


def site(element: str, abc: list[float]) -> dict:
    """Create a site dict."""
    return {"species": [{"element": element, "occu": 1}], "abc": abc}


class TestCutoffCoordination:
    """Tests for cutoff-based coordination number functions."""

    @pytest.mark.parametrize(
        ("fixture", "cutoff", "num_sites", "expected_cn"),
        [
            ("fcc_cu_json", 3.0, 4, 12),
            ("bcc_fe_json", 2.6, 2, 8),  # first shell only
            ("bcc_fe_json", 3.0, 2, 14),  # both shells
            ("rocksalt_nacl_json", 3.5, 8, 6),
        ],
    )
    def test_coordination_numbers(
        self,
        fixture: str,
        cutoff: float,
        num_sites: int,
        expected_cn: int,
        request: pytest.FixtureRequest,
    ) -> None:
        """Verify coordination numbers for standard structures."""
        struct_json = request.getfixturevalue(fixture)
        cns = coordination.get_coordination_numbers(struct_json, cutoff)
        assert len(cns) == num_sites
        assert all(cn == expected_cn for cn in cns), (
            f"Expected CN={expected_cn}, got {cns}"
        )

    def test_single_site_coordination(self, fcc_cu_json: str) -> None:
        """get_coordination_number returns single site CN."""
        assert coordination.get_coordination_number(fcc_cu_json, 0, 3.0) == 12

    def test_zero_cutoff_raises(self, fcc_cu_json: str) -> None:
        """Zero cutoff raises ValueError."""
        import pytest

        with pytest.raises(ValueError, match="cutoff must be positive"):
            coordination.get_coordination_numbers(fcc_cu_json, 0.0)

    def test_negative_cutoff_raises(self, fcc_cu_json: str) -> None:
        """Negative cutoff raises ValueError."""
        import pytest

        with pytest.raises(ValueError, match="cutoff must be positive"):
            coordination.get_coordination_numbers(fcc_cu_json, -1.0)


class TestLocalEnvironment:
    """Tests for get_local_environment function."""

    def test_local_environment_fcc(self, fcc_cu_json: str) -> None:
        """Local environment returns correct neighbors with required fields."""
        neighbors = coordination.get_local_environment(fcc_cu_json, 0, 3.0)
        assert len(neighbors) == 12

        expected_dist = 3.61 / 2**0.5  # a/sqrt(2) ≈ 2.55 Å
        for nbr in neighbors:
            assert nbr["species"] == "Cu"
            assert abs(nbr["distance"] - expected_dist) < 0.1

        # Sorted by distance
        distances = [nbr["distance"] for nbr in neighbors]
        assert distances == sorted(distances)

    def test_get_neighbors(self, bcc_fe_json: str) -> None:
        """get_neighbors returns dicts with site_idx, distance, image."""
        neighbors = coordination.get_neighbors(bcc_fe_json, 0, 2.6)
        assert len(neighbors) == 8
        for nbr in neighbors:
            assert 2.0 < nbr["distance"] < 2.7
            assert len(nbr["image"]) == 3

    def test_site_bounds_error(self, fcc_cu_json: str) -> None:
        """Out of bounds site raises error."""
        with pytest.raises((ValueError, IndexError)):
            coordination.get_local_environment(fcc_cu_json, 100, 3.0)


class TestVoronoiCoordination:
    """Tests for Voronoi-based coordination number functions."""

    def test_voronoi_fcc(self, fcc_cu_json: str) -> None:
        """FCC Cu Voronoi CN returns values for all sites."""
        cns = coordination.get_cn_voronoi_all(fcc_cu_json)
        assert len(cns) == 4
        # Check that the function returns consistent values
        cn_single = coordination.get_cn_voronoi(fcc_cu_json, 0)
        assert cn_single == cns[0]

    def test_simple_cubic_voronoi(self) -> None:
        """Simple cubic: CN should be non-negative."""
        sc_json = make_structure(3.0, [site("Cu", [0.0, 0.0, 0.0])])
        cn = coordination.get_cn_voronoi(sc_json, 0)
        assert cn >= 0

    def test_site_bounds_error(self, fcc_cu_json: str) -> None:
        """Out of bounds site raises error."""
        with pytest.raises((ValueError, IndexError)):
            coordination.get_cn_voronoi(fcc_cu_json, 100)


class TestRocksaltElementTypes:
    """Verify correct element identification in mixed structures."""

    @pytest.mark.parametrize(
        ("site_idx", "expected_neighbor"),
        [
            (0, "Cl"),  # Na at origin has Cl neighbors
            (4, "Na"),  # Cl at (0.5,0,0) has Na neighbors
        ],
    )
    def test_neighbor_elements(
        self, rocksalt_nacl_json: str, site_idx: int, expected_neighbor: str
    ) -> None:
        """Each site has 6 neighbors of the opposite element type."""
        neighbors = coordination.get_local_environment(
            rocksalt_nacl_json, site_idx, 3.5
        )
        assert len(neighbors) == 6
        assert all(nbr["species"] == expected_neighbor for nbr in neighbors)

    def test_voronoi_cn_for_rocksalt(self, rocksalt_nacl_json: str) -> None:
        """Voronoi CN returns values for all sites in rocksalt structure."""
        cns = coordination.get_cn_voronoi_all(rocksalt_nacl_json)
        assert len(cns) == 8  # 4 Na + 4 Cl sites


class TestEdgeCases:
    """Edge case and boundary condition tests."""

    def test_empty_structure(self) -> None:
        """Empty structure returns empty results."""
        empty_json = make_structure(5.0, [])
        assert coordination.get_coordination_numbers(empty_json, 3.0) == []
        assert coordination.get_cn_voronoi_all(empty_json) == []

    def test_cutoff_method_works(self, fcc_cu_json: str) -> None:
        """Cutoff method gives correct results for FCC."""
        cutoff_cns = coordination.get_coordination_numbers(fcc_cu_json, 3.0)
        assert all(cn == 12 for cn in cutoff_cns)


try:
    from pymatgen.core import Lattice, Structure

    PYMATGEN_AVAILABLE = True
except ImportError:
    PYMATGEN_AVAILABLE = False


def _make_pymatgen_struct(name: str) -> Structure:
    """Create pymatgen structure by name."""
    if name == "fcc_cu":
        return Structure(
            Lattice.cubic(3.61),
            ["Cu"] * 4,
            [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
        )
    if name == "bcc_fe":
        return Structure(Lattice.cubic(2.87), ["Fe"] * 2, [[0, 0, 0], [0.5, 0.5, 0.5]])
    if name == "rocksalt":
        return Structure(
            Lattice.cubic(5.64),
            ["Na"] * 4 + ["Cl"] * 4,
            [
                [0, 0, 0],
                [0.5, 0.5, 0],
                [0.5, 0, 0.5],
                [0, 0.5, 0.5],
                [0.5, 0, 0],
                [0, 0.5, 0],
                [0, 0, 0.5],
                [0.5, 0.5, 0.5],
            ],
        )
    raise ValueError(f"Unknown structure: {name}")


@pytest.mark.skipif(not PYMATGEN_AVAILABLE, reason="pymatgen not installed")
class TestPymatgenCompatibility:
    """Compare ferrox coordination results with pymatgen get_all_neighbors."""

    @pytest.mark.parametrize(
        ("struct_name", "cutoff"),
        [
            ("fcc_cu", 3.0),
            ("bcc_fe", 2.6),  # first shell
            ("bcc_fe", 3.0),  # both shells
            ("rocksalt", 3.5),
        ],
    )
    def test_coordination_matches_pymatgen(
        self, struct_name: str, cutoff: float
    ) -> None:
        """Coordination numbers match pymatgen."""
        struct = _make_pymatgen_struct(struct_name)
        py_cns = [len(nn) for nn in struct.get_all_neighbors(cutoff)]
        ferrox_cns = coordination.get_coordination_numbers(
            json.dumps(struct.as_dict()), cutoff
        )
        assert ferrox_cns == py_cns

    def test_neighbor_distances_match_pymatgen(self) -> None:
        """Neighbor distances match pymatgen."""
        struct = _make_pymatgen_struct("fcc_cu")
        ferrox_dists = sorted(
            n["distance"]
            for n in coordination.get_local_environment(
                json.dumps(struct.as_dict()), 0, 3.0
            )
        )
        py_dists = sorted(n.nn_distance for n in struct.get_all_neighbors(3.0)[0])
        assert len(ferrox_dists) == len(py_dists)
        assert all(abs(fd - pd) < 1e-6 for fd, pd in zip(ferrox_dists, py_dists))

    def test_neighbor_elements_match_pymatgen(self) -> None:
        """Neighbor elements match pymatgen in rocksalt."""
        struct = _make_pymatgen_struct("rocksalt")
        ferrox_elems = sorted(
            nbr["species"]
            for nbr in coordination.get_local_environment(
                json.dumps(struct.as_dict()), 0, 3.5
            )
        )
        py_elems = sorted(str(nbr.specie) for nbr in struct.get_all_neighbors(3.5)[0])
        assert ferrox_elems == py_elems

    def test_periodic_images_present(self) -> None:
        """Both have periodic images for FCC (via get_neighbors)."""
        struct = _make_pymatgen_struct("fcc_cu")
        ferrox_neighbors = coordination.get_neighbors(
            json.dumps(struct.as_dict()), 0, 3.0
        )
        py_neighbors = struct.get_all_neighbors(3.0)[0]
        assert len(ferrox_neighbors) == len(py_neighbors) == 12
        assert any(nbr["image"] != [0, 0, 0] for nbr in ferrox_neighbors)
        assert any(tuple(nbr.image) != (0, 0, 0) for nbr in py_neighbors)
