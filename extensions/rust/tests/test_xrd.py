"""Tests for ferrox XRD (X-ray diffraction) pattern calculation."""

from __future__ import annotations

import json

import pytest

try:
    from ferrox import xrd
except ImportError:
    pytest.skip("ferrox not installed", allow_module_level=True)

# Check if XRD API has changed (hkls now returns list of list instead of list of dict)
_pattern_sample = None
try:
    _sample = json.dumps(
        {
            "@class": "Structure",
            "lattice": {"matrix": [[5.64, 0, 0], [0, 5.64, 0], [0, 0, 5.64]]},
            "sites": [
                {"species": [{"element": "Na", "occu": 1.0}], "abc": [0, 0, 0]},
                {"species": [{"element": "Cl", "occu": 1.0}], "abc": [0.5, 0.5, 0.5]},
            ],
        }
    )
    _pattern_sample = xrd.compute_xrd(_sample)
except Exception:  # noqa: S110
    pass  # Expected if ferrox API changes

# HKLs are now list of list[int] not list of dict with "hkl" key
_hkl_is_list = (
    _pattern_sample is not None
    and "hkls" in _pattern_sample
    and len(_pattern_sample["hkls"]) > 0
    and isinstance(_pattern_sample["hkls"][0], list)
    and len(_pattern_sample["hkls"][0]) > 0
    and isinstance(_pattern_sample["hkls"][0][0], list)
)

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
    pattern = xrd.compute_xrd(nacl_json)
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


def test_intensities_positive(nacl_json: str) -> None:
    """All intensities should be positive."""
    assert all(i > 0 for i in xrd.compute_xrd(nacl_json)["intensities"])


def test_two_theta_range(nacl_json: str) -> None:
    """2θ filtering works and narrower range gives fewer peaks."""
    pattern = xrd.compute_xrd(nacl_json, two_theta_range=(20.0, 80.0))
    assert all(20.0 <= tt <= 80.0 for tt in pattern["two_theta"])
    wide = xrd.compute_xrd(nacl_json, two_theta_range=(10.0, 90.0))
    narrow = xrd.compute_xrd(nacl_json, two_theta_range=(20.0, 60.0))
    assert len(narrow["two_theta"]) <= len(wide["two_theta"])


def test_wavelength_effect(nacl_json: str) -> None:
    """Shorter wavelength -> peaks at lower 2θ (Bragg's law)."""
    cu_ka = xrd.compute_xrd(nacl_json, wavelength=1.54184)
    mo_ka = xrd.compute_xrd(nacl_json, wavelength=0.71073)
    assert min(mo_ka["two_theta"]) < min(cu_ka["two_theta"])


def test_hkl_structure(nacl_json: str) -> None:
    """HKL info: each peak has list of [h,k,l] arrays with 3 indices."""
    for peak_hkls in xrd.compute_xrd(nacl_json)["hkls"]:
        # Each peak can have multiple equivalent hkl reflections
        assert len(peak_hkls) > 0
        for hkl in peak_hkls:
            assert len(hkl) == 3  # h, k, l indices


def test_d_spacings(nacl_json: str) -> None:
    """d-spacings positive and decrease with increasing 2θ."""
    pattern = xrd.compute_xrd(nacl_json)
    assert all(d > 0 for d in pattern["d_spacings"])
    if len(pattern["d_spacings"]) > 1:
        assert pattern["d_spacings"][0] > pattern["d_spacings"][-1]


def test_silicon_111_peak(si_diamond_json: str) -> None:
    """Silicon has (111) reflection."""
    pattern = xrd.compute_xrd(si_diamond_json)
    # HKLs is list of list of [h,k,l] arrays
    has_111 = any(
        sorted(abs(h) for h in hkl) == [1, 1, 1]
        for peak_hkls in pattern["hkls"]
        for hkl in peak_hkls
    )
    assert has_111


@pytest.mark.parametrize("wavelength", [-1.0, 0.0])
def test_invalid_wavelength(nacl_json: str, wavelength: float) -> None:
    """Invalid wavelength raises ValueError."""
    with pytest.raises(ValueError, match="wavelength must be positive"):
        xrd.compute_xrd(nacl_json, wavelength=wavelength)


@pytest.mark.parametrize(
    ("two_theta_range", "match"),
    [
        ((90.0, 10.0), "two_theta_range"),
        ((-10.0, 90.0), "two_theta_range"),
        ((0.0, 200.0), "two_theta_range"),
    ],
    ids=["min>max", "min<0", "max>180"],
)
def test_invalid_two_theta_range(
    nacl_json: str, two_theta_range: tuple[float, float], match: str
) -> None:
    """Invalid 2θ range raises ValueError."""
    with pytest.raises(ValueError, match=match):
        xrd.compute_xrd(nacl_json, two_theta_range=two_theta_range)


def test_scattering_params_structure() -> None:
    """Returns dict with common elements, each having 4 [a,b] pairs."""
    params = xrd.get_atomic_scattering_params()
    for elem in ("H", "C", "N", "O", "Fe", "Na", "Cl", "Si", "Cu"):
        assert elem in params, f"Missing: {elem}"
    for elem, coeffs in params.items():
        assert len(coeffs) == 4 and all(len(p) == 2 for p in coeffs), (
            f"Bad structure: {elem}"
        )


def test_deuterium_equals_hydrogen() -> None:
    """Deuterium has same scattering as hydrogen."""
    params = xrd.get_atomic_scattering_params()
    # D might not be in the params if we only have element symbols
    if "D" in params:
        assert params["D"] == params["H"]
    else:
        # Deuterium treated same as hydrogen in X-ray scattering
        pytest.skip("D not in scattering params")
