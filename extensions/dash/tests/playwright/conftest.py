"""Pytest fixtures for Playwright integration tests."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from collections.abc import Generator

import pytest
from playwright.sync_api import Page


def _find_free_port() -> int:
    """Find an available port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="session")
def dash_server() -> Generator[str, None, None]:
    """Start the sample Dash app for integration testing. Yields the base URL."""
    port = _find_free_port()
    scripts_dir = os.path.join(os.path.dirname(__file__), "..", "..", "scripts")
    sample_app_path = os.path.join(scripts_dir, "sample_app.py")

    env = os.environ.copy()
    env["DASH_DEBUG"] = "0"
    env["DASH_PORT"] = str(port)

    process = subprocess.Popen(
        [sys.executable, sample_app_path],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=os.path.dirname(sample_app_path),
    )

    base_url = f"http://127.0.0.1:{port}"

    # Wait for server to start (max 30s)
    for _ in range(60):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(1)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                time.sleep(1)  # Extra time to fully initialize
                break
        time.sleep(0.5)
    else:
        process.terminate()
        stdout, stderr = process.communicate(timeout=5)
        raise RuntimeError(
            f"Dash server failed to start.\nstdout: {stdout.decode()}\nstderr: {stderr.decode()}"
        )

    yield base_url

    # Cleanup: terminate the server
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


@pytest.fixture
def dash_page(page: Page, dash_server: str) -> Page:
    """Navigate to the Dash app and return the page."""
    page.goto(dash_server)
    # Wait for the app to load
    page.wait_for_selector("mv-matterviz", timeout=30000)
    return page
