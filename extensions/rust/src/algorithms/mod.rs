//! Algorithms for structure analysis and manipulation.
//!
//! This module contains computational algorithms used by transformations:
//!
//! - `ewald`: Ewald summation for Coulomb energies
//! - `enumerate`: HNF/SNF-based derivative structure enumeration

pub mod enumerate;
pub mod ewald;

// Re-export main types
pub use enumerate::{EnumConfig, EnumerateDerivativesTransform};
pub use ewald::Ewald;
