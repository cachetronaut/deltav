# deltav

Python implementation of DeltaV.

For product-level context, shared contracts, and cross-language repository information, see the public repository: https://github.com/cachetronaut/deltav.

## Install

```sh
pip install deltav
```

## Import

```python
import deltav
```

## Development

Run from `py/`:

```sh
uv sync --dev
uv run --with ruff ruff check .
uv run --with ruff ruff format --check .
uv run --with ty ty check
uv run --with pytest --with pytest-asyncio python -m pytest
```

## License

MIT
