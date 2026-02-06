//! X-ray diffraction calculations.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;
use pyo3_stub_gen::derive::gen_stub_pyfunction;

use crate::xrd;

use super::helpers::{StructureJson, parse_struct};

/// Compute X-ray diffraction pattern.
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (structure, two_theta_range = None, wavelength = 1.5406))]
fn compute_xrd(
    py: Python<'_>,
    structure: StructureJson,
    two_theta_range: Option<(f64, f64)>,
    wavelength: f64,
) -> PyResult<Py<PyDict>> {
    if !wavelength.is_finite() || wavelength <= 0.0 {
        return Err(PyValueError::new_err(
            "wavelength must be positive and finite",
        ));
    }
    if let Some((min_angle, max_angle)) = two_theta_range {
        if !min_angle.is_finite() || !max_angle.is_finite() {
            return Err(PyValueError::new_err(
                "two_theta_range must be finite with min < max",
            ));
        }
        if min_angle < 0.0 || max_angle > 180.0 {
            return Err(PyValueError::new_err(
                "two_theta_range must be within [0, 180] degrees",
            ));
        }
        if min_angle >= max_angle {
            return Err(PyValueError::new_err(
                "two_theta_range must be finite with min < max",
            ));
        }
    }
    let struc = parse_struct(&structure)?;

    let config = xrd::XrdConfig {
        two_theta_range,
        wavelength,
        ..Default::default()
    };
    let pattern = xrd::compute_xrd(&struc, &config);

    let dict = PyDict::new(py);
    dict.set_item("two_theta", &pattern.two_theta)?;
    dict.set_item("intensities", &pattern.intensities)?;
    dict.set_item("d_spacings", &pattern.d_spacings)?;

    // Convert HklInfo to simple arrays
    let hkls: Vec<Vec<[i32; 3]>> = pattern
        .hkls
        .iter()
        .map(|hkl_group| hkl_group.iter().map(|h| h.hkl).collect())
        .collect();
    dict.set_item("hkls", hkls)?;

    Ok(dict.unbind())
}

/// Get atomic scattering parameters for all elements.
/// Returns a dict of element -> [[a1,b1], [a2,b2], [a3,b3], [a4,b4]] coefficients.
#[gen_stub_pyfunction]
#[pyfunction]
fn get_atomic_scattering_params(py: Python<'_>) -> PyResult<Py<PyDict>> {
    let dict = PyDict::new(py);

    // Get the loaded scattering params map
    // ScatteringCoeffs is [[f64; 2]; 4], so it's already the format we want
    let params_map = xrd::get_scattering_params();
    for (elem_sym, coeffs) in params_map {
        dict.set_item(elem_sym, coeffs.to_vec())?;
    }

    Ok(dict.unbind())
}

/// Register the xrd submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "xrd")?;
    submod.add_function(wrap_pyfunction!(compute_xrd, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_atomic_scattering_params, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
