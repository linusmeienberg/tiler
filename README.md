# tiler

Interactively place a fundamental domain motif and watch it tile the plane under
any of the 17 two-dimensional wallpaper groups.

## Install

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

## Use it

In a Jupyter notebook:

```python
from tiler import TilerWidget

TilerWidget(group="p4m")
```

Pick a wallpaper group and lattice parameters, draw a motif with the mouse in the
left canvas, and the right canvas live-updates with the derived covering of the
plane.

## As a library

```python
import numpy as np
from tiler import FundamentalDomain, generate_covering, svg_from_paths

domain = FundamentalDomain(group="p6m", cell_size=1.0)
domain.add_path(np.array([[0.1, 0.0], [0.3, 0.2], [0.15, 0.35]]))

covering = generate_covering(domain, viewport_min=(-3, -3), viewport_max=(3, 3))
svg = svg_from_paths(covering, viewport_min=(-3, -3), viewport_max=(3, 3))
```

## Layout

- `tiler.lattice` — the 5 Bravais lattice types (oblique, rectangular, centered
  rectangular, square, hexagonal) and their basis vectors.
- `tiler.groups` — the 17 wallpaper groups, each as a lattice type plus coset
  representatives of its point group (rotations, mirrors, glides). Verified for
  correct order and closure in `tests/test_groups.py`.
- `tiler.domain` — `FundamentalDomain`: a motif (vector paths) placed in one cell.
- `tiler.render` — applies the group's symmetry orbit to the motif to produce the
  covering of a viewport; also exports a standalone SVG.
- `tiler.widget` — the interactive `TilerWidget` (ipywidgets + ipycanvas).

## Note on the fundamental domain

For simplicity, the drawing canvas shows the full lattice *unit cell* as a guide
rather than the exact (and per-group differently-shaped) fundamental domain
polygon. You can draw anywhere in or near that cell — symmetric points where
multiple group operations coincide (e.g. on a mirror line) will simply overlap
themselves in the covering, which is visually harmless.

## Tests

```bash
pytest
```
