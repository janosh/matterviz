//! WASM bindings for ferrox types.
//!
//! This module provides JavaScript-accessible wrappers for Element, Species,
//! Structure, and StructureMatcher types via wasm-bindgen.
//!
//! All structure functions use strongly-typed `JsCrystal` inputs/outputs.
//! Results are returned as `WasmResult<T>` = `{ ok: T }` | `{ error: string }`.

// Submodules
pub mod cell;
pub mod composition;
pub mod defects;
pub mod elastic;
pub mod element;
pub mod io;
pub mod lattice;
pub mod md;
pub mod neighbors;
pub mod optimizers;
pub mod order_params;
pub mod potentials;
pub mod properties;
pub mod species;
pub mod structure;
pub mod surfaces;
pub mod symmetry;
pub mod trajectory;
pub mod transformations;
pub mod xrd;

// Re-export all public items from submodules for backward compatibility
pub use cell::*;
pub use composition::*;
pub use defects::*;
pub use elastic::*;
pub use element::*;
pub use io::*;
pub use lattice::*;
pub use md::*;
pub use neighbors::*;
pub use optimizers::*;
pub use order_params::*;
pub use potentials::*;
pub use properties::*;
pub use species::*;
pub use structure::*;
pub use surfaces::*;
pub use symmetry::*;
pub use trajectory::*;
pub use transformations::*;
pub use xrd::*;

// Shared helper functions used across multiple modules

use nalgebra::Vector3;

// Helper to parse flat [x0,y0,z0,x1,y1,z1,...] to Vec<Vector3>
pub(crate) fn parse_flat_vec3(data: &[f64], n_atoms: usize) -> Result<Vec<Vector3<f64>>, String> {
    if data.len() != n_atoms * 3 {
        return Err(format!(
            "Expected {} values ({}*3), got {}",
            n_atoms * 3,
            n_atoms,
            data.len()
        ));
    }
    Ok(data
        .chunks(3)
        .map(|c| Vector3::new(c[0], c[1], c[2]))
        .collect())
}

// Helper to parse flat 9-element cell array to Matrix3 (row-major)
pub(crate) fn parse_flat_cell(
    data: Option<&[f64]>,
) -> Result<Option<nalgebra::Matrix3<f64>>, String> {
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
            Ok(Some(nalgebra::Matrix3::new(
                cell[0], cell[1], cell[2], cell[3], cell[4], cell[5], cell[6], cell[7], cell[8],
            )))
        }
    }
}

// Helper to convert nalgebra Matrix3 to [[f64; 3]; 3]
pub(crate) fn mat3_to_array(m: &nalgebra::Matrix3<f64>) -> [[f64; 3]; 3] {
    [
        [m[(0, 0)], m[(0, 1)], m[(0, 2)]],
        [m[(1, 0)], m[(1, 1)], m[(1, 2)]],
        [m[(2, 0)], m[(2, 1)], m[(2, 2)]],
    ]
}
