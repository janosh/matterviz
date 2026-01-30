"""Tests for ferrox coordination analysis functions."""

from __future__ import annotations

import json

import pytest

try:
    from ferrox import _ferrox as ferrox
except ImportError:
    pytest.skip("ferrox not installed", allow_module_level=True)


# ============================================================================
# Fixtures
# ============================================================================


def make_structure(lattice_a: float, sites: list[dict]) -> str:
    """Helper to create structure JSON."""
    return json.dumps({
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {"matrix": [[lattice_a, 0, 0], [0, lattice_a, 0], [0, 0, lattice_a]]},
        "sites": sites,
    })


def site(element: str, abc: list[float]) -> dict:
    """Helper to create a site dict."""
    return {"species": [{"element": element, "occu": 1}], "abc": abc}


@pytest.fixture
def fcc_cu_json() -> str:
    """FCC Cu conventional cell (4 atoms, CN=12)."""
    return make_structure(3.61, [
        site("Cu", [0.0, 0.0, 0.0]), site("Cu", [0.5, 0.5, 0.0]),
        site("Cu", [0.5, 0.0, 0.5]), site("Cu", [0.0, 0.5, 0.5]),
    ])


@pytest.fixture
def bcc_fe_json() -> str:
    """BCC Fe conventional cell (2 atoms, CN=8 for first shell)."""
    return make_structure(2.87, [site("Fe", [0.0, 0.0, 0.0]), site("Fe", [0.5, 0.5, 0.5])])


@pytest.fixture
def rocksalt_nacl_json() -> str:
    """NaCl rocksalt conventional cell (8 atoms, CN=6)."""
    return make_structure(5.64, [
        # Na FCC positions
        site("Na", [0.0, 0.0, 0.0]), site("Na", [0.5, 0.5, 0.0]),
        site("Na", [0.5, 0.0, 0.5]), site("Na", [0.0, 0.5, 0.5]),
        # Cl FCC positions shifted
        site("Cl", [0.5, 0.0, 0.0]), site("Cl", [0.0, 0.5, 0.0]),
        site("Cl", [0.0, 0.0, 0.5]), site("Cl", [0.5, 0.5, 0.5]),
    ])


# ============================================================================
# Cutoff-based coordination tests
# ============================================================================


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

        # Check structure and values
        expected_dist = 3.61 / 2**0.5  # a/sqrt(2) ≈ 2.55 Å
        for n in neighbors:
            assert n["element"] == "Cu"
            assert abs(n["distance"] - expected_dist) < 0.1
            assert len(n["image"]) == 3
            assert all(isinstance(i, int) for i in n["image"])
            assert isinstance(n["species"], str) and "Cu" in n["species"]

    def test_distances_sorted(self, fcc_cu_json: str) -> None:
        """Neighbors are sorted by distance."""
        neighbors = ferrox.get_local_environment(fcc_cu_json, 0, 5.0)
        distances = [n["distance"] for n in neighbors]
        assert distances == sorted(distances)

    def test_periodic_images_present(self, fcc_cu_json: str) -> None:
        """FCC has neighbors in periodic images."""
        neighbors = ferrox.get_local_environment(fcc_cu_json, 0, 3.0)
        assert any(any(i != 0 for i in n["image"]) for n in neighbors)

    def test_site_bounds_error(self, fcc_cu_json: str) -> None:
        """Out of bounds site raises error."""
        with pytest.raises((ValueError, IndexError)):
            ferrox.get_local_environment(fcc_cu_json, 100, 3.0)


# ============================================================================
# Voronoi-based coordination tests
# ============================================================================


class TestVoronoiCoordination:
    """Tests for Voronoi-based coordination number functions."""

    def test_voronoi_fcc(self, fcc_cu_json: str) -> None:
        """FCC Cu has ~12 Voronoi neighbors."""
        cns = ferrox.get_cn_voronoi_all(fcc_cu_json)
        assert len(cns) == 4
        assert all(10 <= cn <= 14 for cn in cns)

        # Single site agrees
        assert 10 <= ferrox.get_cn_voronoi(fcc_cu_json, 0) <= 14

    def test_voronoi_neighbors(self, fcc_cu_json: str) -> None:
        """Voronoi neighbors have valid structure and are sorted by solid angle."""
        neighbors = ferrox.get_voronoi_neighbors(fcc_cu_json, 0)
        assert len(neighbors) > 0

        solid_angles = []
        for site_idx, solid_angle in neighbors:
            assert isinstance(site_idx, int)
            assert 0 <= solid_angle <= 1.0
            solid_angles.append(solid_angle)

        # Sorted descending by solid angle
        assert solid_angles == sorted(solid_angles, reverse=True)

    def test_voronoi_local_environment(self, fcc_cu_json: str) -> None:
        """Voronoi local environment has solid angles and species."""
        neighbors = ferrox.get_local_environment_voronoi(fcc_cu_json, 0)
        assert len(neighbors) > 0

        for n in neighbors:
            assert n["element"] == "Cu"
            assert n["solid_angle"] > 0
            assert isinstance(n["species"], str)

    def test_min_solid_angle_filter(self, fcc_cu_json: str) -> None:
        """Higher min_solid_angle filters more neighbors."""
        low = ferrox.get_voronoi_neighbors(fcc_cu_json, 0, min_solid_angle=0.0)
        default = ferrox.get_voronoi_neighbors(fcc_cu_json, 0)  # 0.01
        high = ferrox.get_voronoi_neighbors(fcc_cu_json, 0, min_solid_angle=0.1)
        assert len(low) >= len(default) >= len(high)

    def test_simple_cubic_voronoi(self) -> None:
        """Single atom simple cubic has CN=6 (cube with 6 faces)."""
        sc_json = make_structure(3.0, [site("Cu", [0.0, 0.0, 0.0])])
        assert ferrox.get_cn_voronoi(sc_json, 0) == 6.0


class TestVoronoiErrors:
    """Tests for Voronoi method error handling."""

    @pytest.mark.parametrize("func", [
        lambda s: ferrox.get_cn_voronoi(s, 0, min_solid_angle=-0.1),
        lambda s: ferrox.get_cn_voronoi_all(s, min_solid_angle=-0.1),
        lambda s: ferrox.get_voronoi_neighbors(s, 0, min_solid_angle=-0.1),
    ])
    def test_negative_solid_angle_error(self, fcc_cu_json: str, func) -> None:
        """Negative min_solid_angle raises ValueError."""
        with pytest.raises(ValueError, match="non-negative"):
            func(fcc_cu_json)

    @pytest.mark.parametrize("func", [
        lambda s: ferrox.get_cn_voronoi(s, 100),
        lambda s: ferrox.get_voronoi_neighbors(s, 100),
        lambda s: ferrox.get_local_environment_voronoi(s, 100),
    ])
    def test_site_bounds_error(self, fcc_cu_json: str, func) -> None:
        """Out of bounds site raises error."""
        with pytest.raises((ValueError, IndexError)):
            func(fcc_cu_json)


# ============================================================================
# Rocksalt element type tests
# ============================================================================


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
        assert cl_count >= 4  # Na should have mostly Cl neighbors


# ============================================================================
# Edge cases
# ============================================================================


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
