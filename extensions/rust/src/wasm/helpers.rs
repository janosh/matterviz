//! Shared helper functions for WASM bindings.

use nalgebra::{Matrix3, Vector3};

/// Validate cutoff is finite and positive.
#[inline]
pub fn validate_cutoff(cutoff: f64) -> Result<(), String> {
    if !cutoff.is_finite() || cutoff <= 0.0 {
        return Err("Cutoff must be a finite positive number".to_string());
    }
    Ok(())
}

/// Validate temperature is finite and non-negative.
#[inline]
pub fn validate_temperature(temp: f64) -> Result<(), String> {
    if !temp.is_finite() || temp < 0.0 {
        return Err(format!(
            "temperature must be finite and non-negative, got {temp}"
        ));
    }
    Ok(())
}

/// Validate a positive f64 parameter (finite and > 0).
#[inline]
pub fn validate_positive_f64(value: f64, name: &str) -> Result<(), String> {
    if !value.is_finite() || value <= 0.0 {
        return Err(format!("{name} must be finite and positive, got {value}"));
    }
    Ok(())
}

/// Validate cutoff is finite and non-negative (allows zero).
#[inline]
pub fn validate_cutoff_nonneg(cutoff: f64) -> Result<(), String> {
    if !cutoff.is_finite() || cutoff < 0.0 {
        return Err("Cutoff must be a finite non-negative number".to_string());
    }
    Ok(())
}

/// Parse flat [x0,y0,z0,x1,y1,z1,...] to Vec<Vector3>.
pub fn parse_flat_vec3(data: &[f64], n_atoms: usize) -> Result<Vec<Vector3<f64>>, String> {
    if data.len() != n_atoms * 3 {
        return Err(format!(
            "Expected {} values ({}*3), got {}",
            n_atoms * 3,
            n_atoms,
            data.len()
        ));
    }
    // Validate all coordinates are finite
    if let Some(idx) = data.iter().position(|v| !v.is_finite()) {
        let atom_idx = idx / 3;
        let component = idx % 3;
        let axis = ["x", "y", "z"][component];
        return Err(format!(
            "Coordinate {axis} for atom {atom_idx} must be finite, got {}",
            data[idx]
        ));
    }
    Ok(data
        .chunks(3)
        .map(|c| Vector3::new(c[0], c[1], c[2]))
        .collect())
}

/// Parse flat 9-element cell array to Matrix3 (row-major).
pub fn parse_flat_cell(data: Option<&[f64]>) -> Result<Option<Matrix3<f64>>, String> {
    match data {
        None => Ok(None),
        Some(cell) => {
            if cell.len() != 9 {
                return Err(format!("Cell must have 9 elements, got {}", cell.len()));
            }
            if let Some(idx) = cell.iter().position(|v| !v.is_finite()) {
                let row = idx / 3;
                let col = idx % 3;
                return Err(format!(
                    "cell[{row}][{col}] must be finite, got {}",
                    cell[idx]
                ));
            }
            Ok(Some(Matrix3::new(
                cell[0], cell[1], cell[2], cell[3], cell[4], cell[5], cell[6], cell[7], cell[8],
            )))
        }
    }
}

/// Convert nalgebra Matrix3 to [[f64; 3]; 3].
pub fn mat3_to_array(m: &Matrix3<f64>) -> [[f64; 3]; 3] {
    [
        [m[(0, 0)], m[(0, 1)], m[(0, 2)]],
        [m[(1, 0)], m[(1, 1)], m[(1, 2)]],
        [m[(2, 0)], m[(2, 1)], m[(2, 2)]],
    ]
}

/// Flatten Vec<Vector3<f64>> to Vec<f64>.
pub fn flatten_vec3(vecs: &[Vector3<f64>]) -> Vec<f64> {
    vecs.iter().flat_map(|v| [v.x, v.y, v.z]).collect()
}
