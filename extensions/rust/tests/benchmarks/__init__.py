"""Benchmark suite for comparing ferrox, torch-sim, and ASE performance.

Scripts in this directory are self-contained and can be run with `uv run`:

    uv run lj_benchmark.py --md-steps 100 --output results.json
    uv run potential_benchmark.py --steps 50 --output results.json

Each script includes inline PEP 723 metadata specifying its dependencies.
"""
