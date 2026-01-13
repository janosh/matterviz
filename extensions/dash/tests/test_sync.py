"""Test that generated typed.py stays in sync with component_manifest.toml."""

import subprocess
import sys
from pathlib import Path

import pytest

# Path to the sync script
SCRIPTS_DIR = Path(__file__).parent.parent / "scripts"
SYNC_SCRIPT = SCRIPTS_DIR / "sync_typed_wrappers.py"


@pytest.mark.slow
def test_typed_wrappers_in_sync() -> None:
    """Verify typed.py matches the current component_manifest.toml and .d.ts files.

    This test ensures the Dash extension stays in sync with the main MatterViz
    Svelte library. If this fails, run:
        python scripts/sync_typed_wrappers.py
    """
    result = subprocess.run(
        [sys.executable, str(SYNC_SCRIPT), "--check"],
        capture_output=True,
        text=True,
        cwd=SCRIPTS_DIR.parent,  # extensions/dash/
    )

    if result.returncode != 0:
        pytest.fail(
            f"typed.py is out of sync!\n"
            f"stdout: {result.stdout}\n"
            f"stderr: {result.stderr}\n"
            f"Fix: cd extensions/dash && python scripts/sync_typed_wrappers.py"
        )
