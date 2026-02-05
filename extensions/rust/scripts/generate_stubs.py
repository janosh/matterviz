"""Generate Python type stubs from Rust via pyo3-stub-gen.

This script:
1. Runs pyo3-stub-gen via cargo to generate raw stubs
2. Cleans stubs (prefix removal, Optional->X|None, deduplication)
3. Auto-derives namespace classes by parsing Rust register() functions

Formatting is handled by ruff pre-commit hooks (run after this script).

Usage:
    python scripts/generate_stubs.py
    python scripts/generate_stubs.py --clean-only  # just clean stubs
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

RUST_DIR = Path(__file__).parent.parent
STUB_ROOT = RUST_DIR / "python" / "ferrox"
PYTHON_SRC = RUST_DIR / "src" / "python"

# Namespace class name overrides to avoid collisions with real @final classes
NS_CLASS_OVERRIDES = {"species": "SpeciesNamespace"}


def run_stub_gen() -> bool:
    """Run cargo stub_gen binary to produce raw stubs."""
    # pyo3 with abi3 requires PYTHONHOME set to base Python (not venv)
    env = {**os.environ, "PYTHONHOME": sys.base_prefix}
    result = subprocess.run(
        ["cargo", "run", "--bin", "stub_gen", "--features", "stub-gen"],
        cwd=RUST_DIR,
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    if result.returncode != 0:
        print(f"stub_gen failed:\n{result.stderr}", file=sys.stderr)
        return False
    return True


def _parse_rs_module(content: str) -> tuple[str, list[str]] | None:
    """Parse a single .rs file for its submodule name and registered python names."""
    mod_match = re.search(r'PyModule::new\([^,]+,\s*"(\w+)"\)', content)
    if not mod_match:
        return None

    # Build fn rename map: #[pyo3(name = "py_name")] before fn rust_name
    fn_renames: dict[str, str] = {}
    for match in re.finditer(r'#\[pyo3\(name\s*=\s*"(\w+)"\)\]', content):
        region = content[match.end() : match.end() + 300]
        fn_match = re.search(r"fn\s+(\w+)", region)
        if fn_match:
            fn_renames[fn_match.group(1)] = match.group(1)

    # Build class map: #[pyclass(name = "PyName")] ... struct RustName
    class_map: dict[str, str] = {}
    for match in re.finditer(
        r'#\[pyclass\(name\s*=\s*"(\w+)"\)\][\s\S]{0,300}?struct\s+(\w+)',
        content,
    ):
        class_map[match.group(2)] = match.group(1)

    names: list[str] = []

    # Extract registered functions (handles multi-line wrap_pyfunction! calls)
    for match in re.finditer(r"wrap_pyfunction!\(\s*(\w+)\s*,", content):
        rust_name = match.group(1)
        names.append(fn_renames.get(rust_name, rust_name))

    # Extract registered classes: add_class::<RustStruct>()
    for match in re.finditer(r"add_class::<(\w+)>", content):
        rust_name = match.group(1)
        names.append(class_map.get(rust_name, rust_name))

    if not names:
        return None
    return mod_match.group(1), sorted(set(names))


def parse_rust_namespaces() -> dict[str, list[str]]:
    """Auto-detect submodule -> [python_names] by parsing Rust register() functions."""
    namespaces: dict[str, list[str]] = {}
    for rs_file in sorted(PYTHON_SRC.glob("*.rs")):
        if rs_file.name in ("mod.rs", "helpers.rs"):
            continue
        result = _parse_rs_module(rs_file.read_text())
        if result:
            namespaces[result[0]] = result[1]
    return namespaces


def to_pascal_case(name: str) -> str:
    """Convert snake_case to PascalCase."""
    return "".join(word.capitalize() for word in name.split("_"))


def _convert_optional(content: str) -> str:
    """Convert Optional[X] to X | None, handling nested brackets."""
    result: list[str] = []
    idx = 0
    while idx < len(content):
        match = re.search(r"\bOptional\[", content[idx:])
        if not match:
            result.append(content[idx:])
            break
        result.append(content[idx : idx + match.start()])
        # Find the matching ] by counting bracket depth
        start = idx + match.end()
        depth = 1
        pos = start
        while pos < len(content) and depth > 0:
            if content[pos] == "[":
                depth += 1
            elif content[pos] == "]":
                depth -= 1
            pos += 1
        result.append(f"{content[start : pos - 1]} | None")
        idx = pos
    return "".join(result)


def clean_stub(content: str) -> str:
    """Clean pyo3-stub-gen output to produce deterministic stubs.

    Ruff pre-commit hooks handle formatting separately.
    """
    # Strip trailing whitespace (pyo3-stub-gen emits spaces on blank docstring lines)
    content = re.sub(r"[ \t]+$", "", content, flags=re.MULTILINE)
    # Strip builtins./typing. prefixes and their import lines
    content = re.sub(r"\b(builtins|typing)\.(\w+)\b", r"\2", content)
    content = re.sub(r"^import (builtins|typing)\n", "", content, flags=re.MULTILINE)
    # Remove __all__ (we don't support star imports)
    content = re.sub(r"__all__\s*=\s*\[[^\]]*\]\n*", "", content)
    # __eq__ should accept object, not a specific class
    content = re.sub(
        r"def __eq__\(self, other: \w+\)", "def __eq__(self, other: object)", content
    )
    # Bare dict/list in type positions should have params: dict -> dict[str, Any]
    # Only match after type annotation markers (-> : [ ( , |) to avoid docstrings
    content = re.sub(r"(-> |: |\[|\(|, |\| )dict\b(?!\[)", r"\1dict[str, Any]", content)
    content = re.sub(r"(-> |: |\[|\(|, |\| )list\b(?!\[)", r"\1list[Any]", content)
    # Convert Optional[X] -> X | None (deterministic, no ruff needed)
    content = _convert_optional(content)
    # Remove __repr__/__str__ stubs (PYI029)
    content = re.sub(
        r'\n    def __(repr|str)__\(self\) -> str:( \.\.\.|\n        r?""".*?""")',
        "",
        content,
        flags=re.DOTALL,
    )
    # Deduplicate @final classes (keep first occurrence)
    seen: set[str] = set()
    parts: list[str] = []
    last = 0
    for match in re.finditer(
        r"(@final\nclass (\w+):.*?)(?=\n@final\nclass |\ndef |\nclass \w|\Z)",
        content,
        re.DOTALL,
    ):
        parts.append(content[last : match.start()])
        if match.group(2) not in seen:
            seen.add(match.group(2))
            parts.append(match.group(1))
        last = match.end()
    parts.append(content[last:])
    content = "".join(parts)

    # Replace header: only add imports that the file actually uses
    body_match = re.search(
        r"^(@|# ruff:|class |def |from \.|[A-Za-z_]\w*\s*[:=])", content, re.MULTILINE
    )
    if not body_match:
        # No substantive content (e.g. ferrox/__init__.pyi with just a comment)
        return "# This file is automatically generated by pyo3_stub_gen\n"
    body = content[body_match.start() :]
    imports: list[str] = []
    abc_names = [name for name in ("Mapping", "Sequence") if name in body]
    if abc_names:
        imports.append(f"from collections.abc import {', '.join(abc_names)}")
    typing_names = [name for name in ("Any", "final") if name in body]
    if typing_names:
        imports.append(f"from typing import {', '.join(typing_names)}")
    header = "# This file is automatically generated by pyo3_stub_gen\n"
    if imports:
        header += "\n".join(imports) + "\n"
    content = header + "\n" + body
    content = re.sub(r"\n{3,}", "\n\n", content)
    return content.rstrip() + "\n"


def generate_namespace_block(namespaces: dict[str, list[str]]) -> str:
    """Generate namespace class stubs and lowercase aliases."""
    # __version__ is added at runtime but not picked up by pyo3-stub-gen
    lines = [
        "",
        "__version__: str",
        "",
        "# Namespace classes that group related functions",
        "",
    ]
    for ns, funcs in sorted(namespaces.items()):
        cls = NS_CLASS_OVERRIDES.get(ns, to_pascal_case(ns))
        lines.append(f"class {cls}:")
        lines.extend(f"    {func} = {func}" for func in funcs)
        lines.append("")
    lines.append("# Lowercase aliases for module-style imports")
    lines.extend(
        f"{ns} = {NS_CLASS_OVERRIDES.get(ns, to_pascal_case(ns))}"
        for ns in sorted(namespaces)
    )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    """Generate and clean ferrox Python stubs."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--clean-only", action="store_true", help="Skip cargo, just clean stubs"
    )
    parser.add_argument(
        "--strict", action="store_true", help="Kept for CI compat (no-op)"
    )
    args = parser.parse_args()

    if not args.clean_only and not run_stub_gen():
        return 1

    if not STUB_ROOT.exists():
        print(f"Stub root not found: {STUB_ROOT}", file=sys.stderr)
        return 1

    # Clean all generated stubs
    for pyi in sorted(STUB_ROOT.rglob("*.pyi")):
        content = pyi.read_text()
        cleaned = clean_stub(content)
        if content != cleaned:
            pyi.write_text(cleaned)
            print(f"  Cleaned: {pyi.relative_to(RUST_DIR)}")

    # Augment _ferrox/__init__.pyi with namespace classes (auto-derived from Rust)
    ferrox_stub = STUB_ROOT / "_ferrox" / "__init__.pyi"
    if ferrox_stub.exists() and "# Namespace classes" not in ferrox_stub.read_text():
        stub_content = ferrox_stub.read_text()
        # Only include names that are actually defined in this stub file
        defined = {
            m.group(1) or m.group(2)
            for m in re.finditer(
                r"^(?:def (\w+)\(|(?:@final\n)?class (\w+)[\(:])",
                stub_content,
                re.MULTILINE,
            )
        }
        namespaces = {
            ns: [name for name in names if name in defined]
            for ns, names in parse_rust_namespaces().items()
        }
        # Drop empty namespaces (all members in a separate stub file)
        namespaces = {ns: names for ns, names in namespaces.items() if names}
        block = generate_namespace_block(namespaces)
        ferrox_stub.write_text(stub_content.rstrip() + "\n" + block)
        print(f"  Augmented: {ferrox_stub.relative_to(RUST_DIR)}")

    # Formatting is handled by the ruff pre-commit hooks (run after this script)
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
