"""GPU-aware timing utilities for benchmarks."""

import time
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass

import torch


@dataclass
class TimingResult:
    """Result of a timed operation."""

    elapsed: float  # seconds
    n_steps: int
    steps_per_second: float


@contextmanager
def gpu_timer() -> Generator[TimingResult, None, None]:
    """Context manager for GPU-synchronized timing.

    Yields a TimingResult object that gets populated after the context exits.
    Usage:
        with gpu_timer() as timer:
            # ... do work ...
            timer.n_steps = 100
        print(timer.elapsed, timer.steps_per_second)
    """
    if torch.cuda.is_available():
        torch.cuda.synchronize()

    result = TimingResult(elapsed=0.0, n_steps=0, steps_per_second=0.0)
    start = time.perf_counter()

    yield result

    if torch.cuda.is_available():
        torch.cuda.synchronize()

    result.elapsed = time.perf_counter() - start
    if result.n_steps > 0:
        result.steps_per_second = result.n_steps / result.elapsed
