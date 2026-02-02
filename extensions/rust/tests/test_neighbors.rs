//! Integration tests for the neighbors module.
//!
//! These tests verify large-scale behavior and cross-cutoff consistency.

mod common;

use common::{make_bcc, make_bcc_large, make_fcc, make_fcc_large, make_nacl, make_nacl_supercell};
use ferrox::element::Element;
use ferrox::neighbors::{NeighborListConfig, build_neighbor_list};
use std::time::Instant;

// === Large System Scaling Tests ===

#[test]
fn test_large_fcc_scaling_1000_atoms() {
    // 6x6x6 FCC supercell = 864 atoms
    let large_fcc = make_fcc_large(3.61, Element::Cu, 6);
    let n_atoms = large_fcc.num_sites();
    assert!(
        n_atoms >= 800,
        "Expected at least 800 atoms, got {}",
        n_atoms
    );

    let config = NeighborListConfig {
        cutoff: 3.0,
        ..Default::default()
    };

    let start = Instant::now();
    let nl = build_neighbor_list(&large_fcc, &config);
    let elapsed = start.elapsed();

    // Performance: should complete in < 2 seconds
    assert!(
        elapsed.as_secs_f64() < 2.0,
        "Took {:.2}s for {} atoms - expected < 2s",
        elapsed.as_secs_f64(),
        n_atoms
    );

    // Correctness: each atom should have 12 neighbors
    let mut counts = vec![0usize; n_atoms];
    for &center in &nl.center_indices {
        counts[center] += 1;
    }

    let all_12 = counts.iter().all(|&c| c == 12);
    assert!(all_12, "All FCC atoms should have CN=12");

    println!(
        "Large FCC ({}  atoms): {} pairs in {:.3}s",
        n_atoms,
        nl.len(),
        elapsed.as_secs_f64()
    );
}

#[test]
fn test_large_bcc_scaling_1000_atoms() {
    // 8x8x8 BCC supercell = 1024 atoms
    let large_bcc = make_bcc_large(2.87, Element::Fe, 8);
    let n_atoms = large_bcc.num_sites();
    assert!(
        n_atoms >= 1000,
        "Expected at least 1000 atoms, got {}",
        n_atoms
    );

    let config = NeighborListConfig {
        cutoff: 2.6, // First shell
        ..Default::default()
    };

    let start = Instant::now();
    let nl = build_neighbor_list(&large_bcc, &config);
    let elapsed = start.elapsed();

    // Performance
    assert!(
        elapsed.as_secs_f64() < 2.0,
        "Took {:.2}s for {} atoms",
        elapsed.as_secs_f64(),
        n_atoms
    );

    // Correctness: each atom should have 8 neighbors
    let mut counts = vec![0usize; n_atoms];
    for &center in &nl.center_indices {
        counts[center] += 1;
    }

    let all_8 = counts.iter().all(|&c| c == 8);
    assert!(all_8, "All BCC atoms should have CN=8");

    println!(
        "Large BCC ({} atoms): {} pairs in {:.3}s",
        n_atoms,
        nl.len(),
        elapsed.as_secs_f64()
    );
}

#[test]
fn test_large_nacl_scaling() {
    // 5x5x5 NaCl supercell = 1000 atoms
    let large_nacl = make_nacl_supercell(5.64, 5);
    let n_atoms = large_nacl.num_sites();
    assert!(
        n_atoms >= 1000,
        "Expected at least 1000 atoms, got {}",
        n_atoms
    );

    let config = NeighborListConfig {
        cutoff: 3.5, // First shell Na-Cl distance
        ..Default::default()
    };

    let start = Instant::now();
    let nl = build_neighbor_list(&large_nacl, &config);
    let elapsed = start.elapsed();

    // Performance
    assert!(
        elapsed.as_secs_f64() < 2.0,
        "Took {:.2}s for {} atoms",
        elapsed.as_secs_f64(),
        n_atoms
    );

    // Correctness: each atom should have 6 neighbors (rocksalt CN=6)
    let mut counts = vec![0usize; n_atoms];
    for &center in &nl.center_indices {
        counts[center] += 1;
    }

    let all_6 = counts.iter().all(|&c| c == 6);
    assert!(all_6, "All NaCl atoms should have CN=6");

    println!(
        "Large NaCl ({} atoms): {} pairs in {:.3}s",
        n_atoms,
        nl.len(),
        elapsed.as_secs_f64()
    );
}

// === Cutoff Comparison Tests ===

#[test]
fn test_cutoff_comparison_fcc() {
    // Compare neighbor counts at different cutoffs for FCC Cu
    let fcc = make_fcc(3.61, Element::Cu);

    // Expected coordination numbers for FCC at different shells
    // First shell: ~2.55 Å, CN=12
    // Second shell: ~3.61 Å, CN=6
    // Third shell: ~4.42 Å, CN=24

    let cutoffs = [2.5, 3.0, 4.0, 5.0];
    let mut prev_count = 0;

    for cutoff in cutoffs {
        let config = NeighborListConfig {
            cutoff,
            ..Default::default()
        };

        let nl = build_neighbor_list(&fcc, &config);
        let total_neighbors = nl.len() / 4; // per atom average

        // Neighbor count should be non-decreasing with cutoff
        assert!(
            total_neighbors >= prev_count,
            "Cutoff {}: {} neighbors < previous {}",
            cutoff,
            total_neighbors,
            prev_count
        );

        prev_count = total_neighbors;
        println!(
            "FCC Cu cutoff {:.1} Å: {} neighbors/atom",
            cutoff, total_neighbors
        );
    }
}

#[test]
fn test_cutoff_comparison_bcc() {
    // Compare neighbor counts at different cutoffs for BCC Fe
    let bcc = make_bcc(2.87, Element::Fe);

    // BCC: first shell ~2.48 Å (CN=8), second shell ~2.87 Å (CN=6)

    let cutoffs = [2.5, 3.0, 4.0, 5.0];
    let mut prev_count = 0;

    for cutoff in cutoffs {
        let config = NeighborListConfig {
            cutoff,
            ..Default::default()
        };

        let nl = build_neighbor_list(&bcc, &config);
        let total_neighbors = nl.len() / 2; // per atom average

        assert!(
            total_neighbors >= prev_count,
            "Cutoff {}: {} neighbors < previous {}",
            cutoff,
            total_neighbors,
            prev_count
        );

        prev_count = total_neighbors;
        println!(
            "BCC Fe cutoff {:.1} Å: {} neighbors/atom",
            cutoff, total_neighbors
        );
    }
}

#[test]
fn test_cutoff_comparison_nacl() {
    // Compare neighbor counts at different cutoffs for NaCl
    let nacl = make_nacl(5.64);

    // NaCl: Na-Cl first shell ~2.82 Å (CN=6)

    let cutoffs = [2.5, 3.0, 4.0, 5.0];
    let mut prev_count = 0;

    for cutoff in cutoffs {
        let config = NeighborListConfig {
            cutoff,
            ..Default::default()
        };

        let nl = build_neighbor_list(&nacl, &config);
        let total_neighbors = nl.len() / 8; // per atom average

        assert!(
            total_neighbors >= prev_count,
            "Cutoff {}: {} neighbors < previous {}",
            cutoff,
            total_neighbors,
            prev_count
        );

        prev_count = total_neighbors;
        println!(
            "NaCl cutoff {:.1} Å: {} neighbors/atom",
            cutoff, total_neighbors
        );
    }
}

#[test]
fn test_distance_distribution_consistency() {
    // Verify that distance distributions are consistent across cutoffs
    let fcc = make_fcc(3.61, Element::Cu);
    let _nn_dist = 3.61 / 2.0_f64.sqrt(); // First shell distance

    // Get neighbors at cutoff 3.0
    let config_small = NeighborListConfig {
        cutoff: 3.0,
        ..Default::default()
    };
    let nl_small = build_neighbor_list(&fcc, &config_small);

    // Get neighbors at cutoff 5.0
    let config_large = NeighborListConfig {
        cutoff: 5.0,
        ..Default::default()
    };
    let nl_large = build_neighbor_list(&fcc, &config_large);

    // All distances from small cutoff should appear in large cutoff
    let small_dists: std::collections::HashSet<i64> = nl_small
        .distances
        .iter()
        .map(|d| (d * 1000.0).round() as i64) // round to 0.001 Å
        .collect();

    let large_dists: std::collections::HashSet<i64> = nl_large
        .distances
        .iter()
        .map(|d| (d * 1000.0).round() as i64)
        .collect();

    for dist in &small_dists {
        assert!(
            large_dists.contains(dist),
            "Distance {} from small cutoff not found in large cutoff",
            *dist as f64 / 1000.0
        );
    }
}

#[test]
fn test_supercell_consistency() {
    // Neighbor counts should be the same for unit cell and supercell
    let unit_cell = make_fcc(3.61, Element::Cu);
    let supercell = make_fcc_large(3.61, Element::Cu, 3);

    let config = NeighborListConfig {
        cutoff: 3.0,
        ..Default::default()
    };

    let nl_unit = build_neighbor_list(&unit_cell, &config);
    let nl_super = build_neighbor_list(&supercell, &config);

    // Count per atom
    let unit_per_atom = nl_unit.len() / unit_cell.num_sites();
    let super_per_atom = nl_super.len() / supercell.num_sites();

    assert_eq!(
        unit_per_atom, super_per_atom,
        "Unit cell ({}) and supercell ({}) should have same CN",
        unit_per_atom, super_per_atom
    );
}
