"""Tests for trajectory analysis functions (MSD, diffusion)."""

from __future__ import annotations

import numpy as np
import pytest
from ferrox import trajectory

# === diffusion_from_msd Tests ===


class TestDiffusionFromMsd:
    """Tests for diffusion_from_msd function."""

    def test_linear_msd_gives_correct_diffusion(self) -> None:
        """Linear MSD gives correct diffusion coefficient."""
        # MSD = 6*D*t for 3D diffusion
        # If D = 1.0, MSD = 6*t
        times = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
        d_expected = 1.0
        msd = [6.0 * d_expected * t for t in times]

        diffusion, r_squared = trajectory.diffusion_from_msd(msd, times)

        assert diffusion == pytest.approx(d_expected, rel=0.05)
        assert r_squared == pytest.approx(1.0, abs=0.01)

    def test_2d_diffusion(self) -> None:
        """2D diffusion coefficient from MSD."""
        # MSD = 4*D*t for 2D
        times = list(np.linspace(0, 10, 50))
        d_expected = 0.5
        msd = [4.0 * d_expected * t for t in times]

        diffusion, r_squared = trajectory.diffusion_from_msd(msd, times, dim=2)

        assert diffusion == pytest.approx(d_expected, rel=0.05)

    def test_1d_diffusion(self) -> None:
        """1D diffusion coefficient from MSD."""
        # MSD = 2*D*t for 1D
        times = list(np.linspace(0, 10, 50))
        d_expected = 2.0
        msd = [2.0 * d_expected * t for t in times]

        diffusion, r_squared = trajectory.diffusion_from_msd(msd, times, dim=1)

        assert diffusion == pytest.approx(d_expected, rel=0.05)

    def test_start_end_fractions(self) -> None:
        """Custom start/end fractions work."""
        times = list(np.linspace(0, 10, 100))
        msd = [6.0 * 1.0 * t for t in times]

        # Use only middle 40% of data
        diffusion, _ = trajectory.diffusion_from_msd(
            msd, times, start_fraction=0.3, end_fraction=0.7
        )

        assert diffusion == pytest.approx(1.0, rel=0.1)

    def test_minimum_points_required(self) -> None:
        """At least 2 points required."""
        with pytest.raises((ValueError, RuntimeError)):
            trajectory.diffusion_from_msd([1.0], [1.0])

    def test_mismatched_lengths_raise(self) -> None:
        """Mismatched MSD and times lengths raise error."""
        msd = [1.0, 2.0, 3.0]
        times = [0.0, 1.0]
        with pytest.raises((ValueError, RuntimeError)):
            trajectory.diffusion_from_msd(msd, times)

    @pytest.mark.parametrize("dim", [0, 4])
    def test_invalid_dim_raises(self, dim: int) -> None:
        """Invalid dimension (not 1, 2, or 3) raises error."""
        msd = [0.0, 6.0, 12.0, 18.0]
        times = [0.0, 1.0, 2.0, 3.0]
        with pytest.raises((ValueError, RuntimeError)):
            trajectory.diffusion_from_msd(msd, times, dim=dim)

    @pytest.mark.parametrize(
        ("start_fraction", "end_fraction"),
        [
            (1.5, 1.0),  # start > 1
            (0.0, 1.5),  # end > 1
            (-0.1, 1.0),  # start < 0
            (0.7, 0.3),  # start >= end
            (0.5, 0.5),  # start == end
        ],
        ids=["start>1", "end>1", "start<0", "start>end", "start==end"],
    )
    def test_invalid_fractions_raise(
        self, start_fraction: float, end_fraction: float
    ) -> None:
        """Invalid start/end fractions raise error."""
        msd = [0.0, 6.0, 12.0, 18.0, 24.0, 30.0]
        times = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]
        with pytest.raises((ValueError, RuntimeError)):
            trajectory.diffusion_from_msd(
                msd, times, start_fraction=start_fraction, end_fraction=end_fraction
            )

    @pytest.mark.parametrize(
        ("msd", "times"),
        [
            ([float("nan"), 6.0, 12.0], [0.0, 1.0, 2.0]),  # NaN in msd
            ([0.0, 6.0, 12.0], [float("nan"), 1.0, 2.0]),  # NaN in times
            ([float("inf"), 6.0, 12.0], [0.0, 1.0, 2.0]),  # Inf in msd
            ([0.0, 6.0, 12.0], [0.0, float("inf"), 2.0]),  # Inf in times
        ],
        ids=["nan_msd", "nan_times", "inf_msd", "inf_times"],
    )
    @pytest.mark.xfail(reason="NaN/Inf validation not yet implemented")
    def test_nan_inf_values_raise(self, msd: list[float], times: list[float]) -> None:
        """NaN/Infinity values in msd or times raise error."""
        with pytest.raises((ValueError, RuntimeError)):
            trajectory.diffusion_from_msd(msd, times)


# === diffusion_from_vacf Tests ===


class TestDiffusionFromVacf:
    """Tests for diffusion_from_vacf function."""

    def test_exponential_vacf(self) -> None:
        """Exponential VACF gives finite diffusion."""
        # VACF = v0^2 * exp(-t/tau)
        # D = (1/(3)) * integral(VACF dt) = v0^2 * tau / 3
        dt = 0.01
        tau = 1.0
        v0_sq = 1.0
        times = np.arange(0, 10 * tau, dt)
        vacf = list(v0_sq * np.exp(-times / tau))

        diffusion = trajectory.diffusion_from_vacf(vacf, dt)

        # Expected: v0^2 * tau / 3 = 1.0 * 1.0 / 3 = 0.333
        assert diffusion == pytest.approx(v0_sq * tau / 3, rel=0.1)

    def test_2d_vacf(self) -> None:
        """2D diffusion from VACF."""
        dt = 0.01
        tau = 1.0
        v0_sq = 1.0
        times = np.arange(0, 10 * tau, dt)
        vacf = list(v0_sq * np.exp(-times / tau))

        diffusion = trajectory.diffusion_from_vacf(vacf, dt, dim=2)

        # Expected: v0^2 * tau / 2 = 0.5
        assert diffusion == pytest.approx(v0_sq * tau / 2, rel=0.1)

    def test_negative_dt_raises(self) -> None:
        """Negative timestep raises error."""
        vacf = [1.0, 0.5, 0.25]
        with pytest.raises((ValueError, RuntimeError)):
            trajectory.diffusion_from_vacf(vacf, dt=-0.1)

    def test_zero_dt_raises(self) -> None:
        """Zero timestep raises error."""
        vacf = [1.0, 0.5, 0.25]
        with pytest.raises((ValueError, RuntimeError)):
            trajectory.diffusion_from_vacf(vacf, dt=0.0)

    def test_nan_dt_raises(self) -> None:
        """NaN timestep raises error."""
        vacf = [1.0, 0.5, 0.25]
        with pytest.raises((ValueError, RuntimeError)):
            trajectory.diffusion_from_vacf(vacf, dt=float("nan"))

    def test_inf_dt_raises(self) -> None:
        """Infinity timestep raises error."""
        vacf = [1.0, 0.5, 0.25]
        with pytest.raises((ValueError, RuntimeError)):
            trajectory.diffusion_from_vacf(vacf, dt=float("inf"))

    def test_minimum_points_required(self) -> None:
        """At least 2 points required."""
        with pytest.raises((ValueError, RuntimeError)):
            trajectory.diffusion_from_vacf([1.0], dt=0.1)

    @pytest.mark.parametrize("dim", [0, 4])
    def test_invalid_dim_raises(self, dim: int) -> None:
        """Invalid dimension raises error."""
        vacf = [1.0, 0.5, 0.25]
        with pytest.raises((ValueError, RuntimeError)):
            trajectory.diffusion_from_vacf(vacf, dt=0.1, dim=dim)
