//! ASE unit conversion constants and helpers.

use rand::SeedableRng;
use rand::rngs::StdRng;

/// Boltzmann constant in eV/K.
pub const KB: f64 = 8.617333262e-5;

/// Internal time unit in femtoseconds: sqrt(amu * Å² / eV) ≈ 10.18 fs
pub const INTERNAL_TIME_FS: f64 = 10.1805055073576;

/// Conversion: fs to internal time units.
pub const FS_TO_INTERNAL: f64 = 1.0 / INTERNAL_TIME_FS;

/// Conversion: internal time to fs.
pub const INTERNAL_TO_FS: f64 = INTERNAL_TIME_FS;

/// Conversion: GPa to eV/Å³
pub const GPA_TO_EV_PER_ANG3: f64 = 0.00624150913;

/// Create an RNG from optional seed.
#[inline]
pub fn make_rng(seed: Option<u64>) -> StdRng {
    seed.map_or_else(StdRng::from_entropy, StdRng::seed_from_u64)
}
