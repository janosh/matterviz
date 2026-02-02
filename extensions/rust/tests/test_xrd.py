"""Tests for ferrox XRD (X-ray diffraction) pattern calculation."""

from __future__ import annotations

import json

import pytest

try:
    from ferrox import compute_xrd, get_atomic_scattering_params
except ImportError:
    pytest.skip("ferrox not installed", allow_module_level=True)

# nacl_json fixture imported from conftest.py


@pytest.fixture
def si_diamond_json() -> str:
    """Silicon diamond structure, 2 sites."""
    return json.dumps(
        {
            "@module": "pymatgen.core.structure",
            "@class": "Structure",
            "lattice": {"matrix": [[5.431, 0, 0], [0, 5.431, 0], [0, 0, 5.431]]},
            "sites": [
                {"species": [{"element": "Si", "occu": 1}], "abc": [0, 0, 0]},
                {"species": [{"element": "Si", "occu": 1}], "abc": [0.25, 0.25, 0.25]},
            ],
        }
    )


def test_pattern_structure(nacl_json: str) -> None:
    """XRD pattern has expected keys and consistent array lengths."""
    pattern = compute_xrd(nacl_json)
    assert all(
        key in pattern for key in ("two_theta", "intensities", "hkls", "d_spacings")
    )
    n = len(pattern["two_theta"])
    assert n > 0
    assert (
        len(pattern["intensities"])
        == len(pattern["hkls"])
        == len(pattern["d_spacings"])
        == n
    )


def test_scaling(nacl_json: str) -> None:
    """Scaled max=100, unscaled all positive."""
    assert max(compute_xrd(nacl_json, scaled=True)["intensities"]) == pytest.approx(
        100.0, abs=0.1
    )
    assert all(i > 0 for i in compute_xrd(nacl_json, scaled=False)["intensities"])


def test_two_theta_range(nacl_json: str) -> None:
    """2θ filtering works and narrower range gives fewer peaks."""
    pattern = compute_xrd(nacl_json, two_theta_range=(20.0, 80.0))
    assert all(20.0 <= tt <= 80.0 for tt in pattern["two_theta"])
    wide = compute_xrd(nacl_json, two_theta_range=(10.0, 90.0))
    narrow = compute_xrd(nacl_json, two_theta_range=(20.0, 60.0))
    assert len(narrow["two_theta"]) <= len(wide["two_theta"])


def test_wavelength_effect(nacl_json: str) -> None:
    """Shorter wavelength -> peaks at lower 2θ (Bragg's law)."""
    cu_ka = compute_xrd(nacl_json, wavelength=1.54184)
    mo_ka = compute_xrd(nacl_json, wavelength=0.71073)
    assert min(mo_ka["two_theta"]) < min(cu_ka["two_theta"])


def test_hkl_structure(nacl_json: str) -> None:
    """HKL info: 3 indices, positive multiplicity."""
    for peak_hkls in compute_xrd(nacl_json)["hkls"]:
        for info in peak_hkls:
            assert len(info["hkl"]) == 3 and info["multiplicity"] > 0


def test_d_spacings(nacl_json: str) -> None:
    """d-spacings positive and decrease with increasing 2θ."""
    pattern = compute_xrd(nacl_json)
    assert all(d > 0 for d in pattern["d_spacings"])
    if len(pattern["d_spacings"]) > 1:
        assert pattern["d_spacings"][0] > pattern["d_spacings"][-1]


def test_silicon_111_peak(si_diamond_json: str) -> None:
    """Silicon has (111) reflection."""
    pattern = compute_xrd(si_diamond_json)
    has_111 = any(
        sorted(abs(h) for h in info["hkl"]) == [1, 1, 1]
        for peak_hkls in pattern["hkls"]
        for info in peak_hkls
    )
    assert has_111, "Silicon should have (111) reflection"


@pytest.mark.parametrize("wavelength", [-1.0, 0.0])
def test_invalid_wavelength(nacl_json: str, wavelength: float) -> None:
    """Invalid wavelength raises ValueError."""
    with pytest.raises(ValueError, match="wavelength must be positive"):
        compute_xrd(nacl_json, wavelength=wavelength)


@pytest.mark.parametrize(
    "two_theta_range",
    [(-10.0, 90.0), (0.0, 200.0), (90.0, 10.0)],
    ids=["min<0", "max>180", "min>max"],
)
def test_invalid_two_theta_range(
    nacl_json: str, two_theta_range: tuple[float, float]
) -> None:
    """Invalid 2θ range raises ValueError."""
    with pytest.raises(ValueError, match="two_theta_range"):
        compute_xrd(nacl_json, two_theta_range=two_theta_range)


def test_scattering_params_structure() -> None:
    """Returns dict with common elements, each having 4 [a,b] pairs."""
    params = get_atomic_scattering_params()
    for elem in ("H", "C", "N", "O", "Fe", "Na", "Cl", "Si", "Cu"):
        assert elem in params, f"Missing: {elem}"
    for elem, coeffs in params.items():
        assert len(coeffs) == 4 and all(len(p) == 2 for p in coeffs), (
            f"Bad structure: {elem}"
        )


def test_deuterium_equals_hydrogen() -> None:
    """Deuterium has same scattering as hydrogen."""
    params = get_atomic_scattering_params()
    assert params["D"] == params["H"]
