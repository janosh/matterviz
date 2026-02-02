//! Trajectory analysis functions.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

use crate::trajectory;

/// Validate dimension parameter (must be 1, 2, or 3).
fn validate_dim(dim: usize) -> PyResult<()> {
    if dim == 0 || dim > 3 {
        return Err(PyValueError::new_err("dim must be 1, 2, or 3"));
    }
    Ok(())
}

/// Calculate diffusion coefficient from mean squared displacement.
#[pyfunction]
#[pyo3(signature = (msd, times, dim = 3, start_fraction = 0.2, end_fraction = 0.8))]
fn diffusion_from_msd(
    msd: Vec<f64>,
    times: Vec<f64>,
    dim: usize,
    start_fraction: f64,
    end_fraction: f64,
) -> PyResult<(f64, f64)> {
    if msd.len() < 2 || times.len() < 2 {
        return Err(PyValueError::new_err(
            "MSD and times must have at least 2 points",
        ));
    }
    if msd.len() != times.len() {
        return Err(PyValueError::new_err("MSD and times must have same length"));
    }
    if !(0.0..=1.0).contains(&start_fraction) || !(0.0..=1.0).contains(&end_fraction) {
        return Err(PyValueError::new_err(
            "start_fraction and end_fraction must be in [0.0, 1.0]",
        ));
    }
    if start_fraction >= end_fraction {
        return Err(PyValueError::new_err(
            "start_fraction must be less than end_fraction",
        ));
    }
    validate_dim(dim)?;
    Ok(trajectory::diffusion_coefficient_from_msd(
        &msd,
        &times,
        dim,
        start_fraction,
        end_fraction,
    ))
}

/// Calculate diffusion coefficient from velocity autocorrelation function.
#[pyfunction]
#[pyo3(signature = (vacf, dt, dim = 3))]
fn diffusion_from_vacf(vacf: Vec<f64>, dt: f64, dim: usize) -> PyResult<f64> {
    if vacf.len() < 2 {
        return Err(PyValueError::new_err("VACF must have at least 2 points"));
    }
    if dt <= 0.0 {
        // MUTATION: removed is_finite check
        return Err(PyValueError::new_err("dt must be a finite positive number"));
    }
    validate_dim(dim)?;
    Ok(trajectory::diffusion_coefficient_from_vacf(&vacf, dt, dim))
}

/// Register the trajectory submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "trajectory")?;
    submod.add_function(wrap_pyfunction!(diffusion_from_msd, &submod)?)?;
    submod.add_function(wrap_pyfunction!(diffusion_from_vacf, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
