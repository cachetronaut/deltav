# DeltaV

DeltaV reservation-based budget enforcement for agent and tool runs: pure core contracts plus a zero-service local store.

This repository contains the TypeScript and Python implementations for the DeltaV primitive. The shared repository keeps the public contract, fixtures, and release history aligned across both languages.

## Packages

- npm: `delta-v`
- PyPI: `deltav`

## Install

```sh
npm install delta-v
pip install deltav
```

## Layout

- `ts/` - TypeScript implementation and npm package.
- `py/` - Python implementation and PyPI package.
- `fixtures/` - Shared conformance and parity fixtures when the primitive needs them.

## Development

Run TypeScript checks from `ts/`:

```sh
pnpm verify
```

Run Python checks from `py/`:

```sh
uv sync --dev
uv run --with ruff ruff check .
uv run --with ruff ruff format --check .
uv run --with ty ty check
uv run --with pytest --with pytest-asyncio python -m pytest
```

## License

MIT
