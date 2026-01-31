"""Tests for ferrox coordination analysis functions."""

from __future__ import annotations

import json

import pytest

try:
    from ferrox import _ferrox as ferrox
except ImportError:
    pytest.skip("ferrox not installed", allow_module_level=True)

# Helpers (fixtures auto-discovered from conftest.py)


def make_structure(lattice_a: float, sites: list[dict]) -> str:
    """Create structure JSON with cubic lattice."""
    return json.dumps({
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {"matrix": [[lattice_a, 0, 0], [0, lattice_a, 0], [0, 0, lattice_a]]},
        "sites": sites,
    })


def site(element: str, abc: list[float]) -> dict:
    """Create a site dict."""
    return {"species": [{"element": element, "occu": 1}], "abc": abc}


class TestCutoffCoordination:
    """Tests for cutoff-based coordination number functions."""

    @pytest.mark.parametrize(("fixture", "cutoff", "num_sites", "expected_cn"), [
        ("fcc_cu_json", 3.0, 4, 12),
        ("bcc_fe_json", 2.6, 2, 8),  # first shell only
        ("bcc_fe_json", 3.0, 2, 14),  # both shells
        ("rocksalt_nacl_json", 3.5, 8, 6),
    ])
    def test_coordination_numbers(
        self, fixture: str, cutoff: float, num_sites: int, expected_cn: int, request: pytest.FixtureRequest
    ) -> None:
        """Verify coordination numbers for standard structures."""
        struct_json = request.getfixturevalue(fixture)
        cns = ferrox.get_coordination_numbers(struct_json, cutoff)
        assert len(cns) == num_sites
        assert all(cn == expected_cn for cn in cns), f"Expected CN={expected_cn}, got {cns}"

    def test_single_site_coordination(self, fcc_cu_json: str) -> None:
        """get_coordination_number returns single site CN."""
        assert ferrox.get_coordination_number(fcc_cu_json, 0, 3.0) == 12

    def test_zero_cutoff(self, fcc_cu_json: str) -> None:
        """Zero cutoff gives CN=0."""
        assert all(cn == 0 for cn in ferrox.get_coordination_numbers(fcc_cu_json, 0.0))

    def test_negative_cutoff_error(self, fcc_cu_json: str) -> None:
        """Negative cutoff raises ValueError."""
        with pytest.raises(ValueError, match="non-negative"):
            ferrox.get_coordination_numbers(fcc_cu_json, -1.0)


class TestLocalEnvironment:
    """Tests for get_local_environment function."""

    def test_local_environment_fcc(self, fcc_cu_json: str) -> None:
        """Local environment returns correct neighbors with required fields."""
        neighbors = ferrox.get_local_environment(fcc_cu_json, 0, 3.0)
        assert len(neighbors) == 12

        expected_dist = 3.61 / 2**0.5  # a/sqrt(2) ≈ 2.55 Å
        for n in neighbors:
            assert n["element"] == "Cu"
            assert abs(n["distance"] - expected_dist) < 0.1
            assert len(n["image"]) == 3 and all(isinstance(i, int) for i in n["image"])

        # Sorted by distance
        distances = [n["distance"] for n in neighbors]
        assert distances == sorted(distances)

        # Has periodic images (not all [0,0,0])
        assert any(any(i != 0 for i in n["image"]) for n in neighbors)

    def test_get_neighbors(self, bcc_fe_json: str) -> None:
        """get_neighbors returns (site_idx, distance, image) tuples."""
        neighbors = ferrox.get_neighbors(bcc_fe_json, 0, 2.6)
        assert len(neighbors) == 8
        assert all(2.0 < dist < 2.7 and len(image) == 3 for _, dist, image in neighbors)

    def test_site_bounds_error(self, fcc_cu_json: str) -> None:
        """Out of bounds site raises error."""
        with pytest.raises((ValueError, IndexError)):
            ferrox.get_local_environment(fcc_cu_json, 100, 3.0)


class TestVoronoiCoordination:
    """Tests for Voronoi-based coordination number functions."""

    def test_voronoi_fcc(self, fcc_cu_json: str) -> None:
        """FCC Cu has ~12 Voronoi neighbors with valid solid angles."""
        # Coordination numbers
        cns = ferrox.get_cn_voronoi_all(fcc_cu_json)
        assert len(cns) == 4 and all(10 <= cn <= 14 for cn in cns)
        assert 10 <= ferrox.get_cn_voronoi(fcc_cu_json, 0) <= 14

        # Neighbors sorted by solid angle (descending)
        neighbors = ferrox.get_voronoi_neighbors(fcc_cu_json, 0)
        solid_angles = [sa for _, sa in neighbors]
        assert all(0 <= sa <= 1.0 for sa in solid_angles)
        assert solid_angles == sorted(solid_angles, reverse=True)

        # Local environment has solid angles
        env = ferrox.get_local_environment_voronoi(fcc_cu_json, 0)
        assert all(n["element"] == "Cu" and n["solid_angle"] > 0 for n in env)

        # min_solid_angle filter: higher = fewer neighbors
        low = ferrox.get_voronoi_neighbors(fcc_cu_json, 0, min_solid_angle=0.0)
        high = ferrox.get_voronoi_neighbors(fcc_cu_json, 0, min_solid_angle=0.1)
        assert len(low) >= len(high)

    def test_simple_cubic_voronoi(self) -> None:
        """Simple cubic: CN=6 (cube faces)."""
        sc_json = make_structure(3.0, [site("Cu", [0.0, 0.0, 0.0])])
        assert ferrox.get_cn_voronoi(sc_json, 0) == pytest.approx(6.0, abs=1e-6)

    @pytest.mark.parametrize("func", [
        pytest.param(lambda s: ferrox.get_cn_voronoi(s, 0, min_solid_angle=-0.1), id="cn"),
        pytest.param(lambda s: ferrox.get_cn_voronoi_all(s, min_solid_angle=-0.1), id="cn_all"),
        pytest.param(lambda s: ferrox.get_voronoi_neighbors(s, 0, min_solid_angle=-0.1), id="neighbors"),
    ])
    def test_negative_solid_angle_error(self, fcc_cu_json: str, func) -> None:
        """Negative min_solid_angle raises ValueError."""
        with pytest.raises(ValueError, match="0.0 and 1.0"):
            func(fcc_cu_json)

    @pytest.mark.parametrize("func", [
        pytest.param(lambda s: ferrox.get_cn_voronoi(s, 100), id="cn"),
        pytest.param(lambda s: ferrox.get_voronoi_neighbors(s, 100), id="neighbors"),
        pytest.param(lambda s: ferrox.get_local_environment_voronoi(s, 100), id="env"),
    ])
    def test_site_bounds_error(self, fcc_cu_json: str, func) -> None:
        """Out of bounds site raises error."""
        with pytest.raises((ValueError, IndexError)):
            func(fcc_cu_json)


class TestRocksaltElementTypes:
    """Verify correct element identification in mixed structures."""

    @pytest.mark.parametrize(("site_idx", "expected_neighbor"), [
        (0, "Cl"),  # Na at origin has Cl neighbors
        (4, "Na"),  # Cl at (0.5,0,0) has Na neighbors
    ])
    def test_neighbor_elements(
        self, rocksalt_nacl_json: str, site_idx: int, expected_neighbor: str
    ) -> None:
        """Each site has 6 neighbors of the opposite element type."""
        neighbors = ferrox.get_local_environment(rocksalt_nacl_json, site_idx, 3.5)
        assert len(neighbors) == 6
        assert all(n["element"] == expected_neighbor for n in neighbors)

    def test_voronoi_element_types(self, rocksalt_nacl_json: str) -> None:
        """Voronoi also identifies correct neighbor elements."""
        neighbors = ferrox.get_local_environment_voronoi(rocksalt_nacl_json, 0)
        cl_count = sum(1 for n in neighbors if n["element"] == "Cl")
        assert cl_count >= 5


class TestEdgeCases:
    """Edge case and boundary condition tests."""

    def test_empty_structure(self) -> None:
        """Empty structure returns empty results."""
        empty_json = make_structure(5.0, [])
        assert ferrox.get_coordination_numbers(empty_json, 3.0) == []
        assert ferrox.get_cn_voronoi_all(empty_json) == []

    def test_methods_consistent(self, fcc_cu_json: str) -> None:
        """Cutoff and Voronoi methods give similar results for FCC."""
        cutoff_cns = ferrox.get_coordination_numbers(fcc_cu_json, 3.0)
        voronoi_cns = ferrox.get_cn_voronoi_all(fcc_cu_json)
        assert all(cn == 12 for cn in cutoff_cns)
        assert all(abs(cn - 12) <= 2 for cn in voronoi_cns)


try:
    from pymatgen.core import Lattice, Structure

    PYMATGEN_AVAILABLE = True
except ImportError:
    PYMATGEN_AVAILABLE = False


def _make_pymatgen_struct(name: str) -> "Structure":
    """Create pymatgen structure by name."""
    if name == "fcc_cu":
        return Structure(Lattice.cubic(3.61), ["Cu"] * 4,
            [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]])
    if name == "bcc_fe":
        return Structure(Lattice.cubic(2.87), ["Fe"] * 2, [[0, 0, 0], [0.5, 0.5, 0.5]])
    if name == "rocksalt":
        return Structure(Lattice.cubic(5.64), ["Na"] * 4 + ["Cl"] * 4, [
            [0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5],
            [0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5], [0.5, 0.5, 0.5]])
    raise ValueError(f"Unknown structure: {name}")


@pytest.mark.skipif(not PYMATGEN_AVAILABLE, reason="pymatgen not installed")
class TestPymatgenCompatibility:
    """Compare ferrox coordination results with pymatgen get_all_neighbors."""

    @pytest.mark.parametrize(("struct_name", "cutoff"), [
        ("fcc_cu", 3.0),
        ("bcc_fe", 2.6),  # first shell
        ("bcc_fe", 3.0),  # both shells
        ("rocksalt", 3.5),
    ])
    def test_coordination_matches_pymatgen(self, struct_name: str, cutoff: float) -> None:
        """Coordination numbers match pymatgen."""
        struct = _make_pymatgen_struct(struct_name)
        py_cns = [len(nn) for nn in struct.get_all_neighbors(cutoff)]
        ferrox_cns = ferrox.get_coordination_numbers(json.dumps(struct.as_dict()), cutoff)
        assert ferrox_cns == py_cns

    def test_neighbor_distances_match_pymatgen(self) -> None:
        """Neighbor distances match pymatgen."""
        struct = _make_pymatgen_struct("fcc_cu")
        ferrox_dists = sorted(n["distance"] for n in ferrox.get_local_environment(
            json.dumps(struct.as_dict()), 0, 3.0))
        py_dists = sorted(n.nn_distance for n in struct.get_all_neighbors(3.0)[0])
        assert len(ferrox_dists) == len(py_dists)
        assert all(abs(fd - pd) < 1e-6 for fd, pd in zip(ferrox_dists, py_dists))

    def test_neighbor_elements_match_pymatgen(self) -> None:
        """Neighbor elements match pymatgen in rocksalt."""
        struct = _make_pymatgen_struct("rocksalt")
        ferrox_elems = sorted(n["element"] for n in ferrox.get_local_environment(
            json.dumps(struct.as_dict()), 0, 3.5))
        py_elems = sorted(str(n.specie) for n in struct.get_all_neighbors(3.5)[0])
        assert ferrox_elems == py_elems

    def test_periodic_images_present(self) -> None:
        """Both have periodic images for FCC."""
        struct = _make_pymatgen_struct("fcc_cu")
        ferrox_neighbors = ferrox.get_local_environment(json.dumps(struct.as_dict()), 0, 3.0)
        py_neighbors = struct.get_all_neighbors(3.0)[0]
        assert len(ferrox_neighbors) == len(py_neighbors) == 12
        assert any(n["image"] != [0, 0, 0] for n in ferrox_neighbors)
        assert any(tuple(n.image) != (0, 0, 0) for n in py_neighbors)
