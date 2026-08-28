# tiler

Load a PNG or SVG image, position it inside the true fundamental domain of a chosen
wallpaper group, and watch it tile the plane — interactively, in Jupyter.

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

Pick a wallpaper group and lattice parameters, then **Load image** to upload a PNG
or SVG. The blue outline in the left canvas is the group's true fundamental domain
(a Dirichlet/Voronoi cell — not just the unit cell); drag inside it to reposition the
image, and use the scale/rotate sliders to fit it. The right canvas live-updates
with the derived covering: every copy is the same image, clipped to the fundamental
domain polygon and placed by one of the group's symmetry operations, so edges tile
seamlessly. Freehand sketching (no image needed) still works too, via the "Draw"
mouse mode.

## As a library

```python
import numpy as np
from tiler import FundamentalDomain, generate_covering, svg_from_paths

domain = FundamentalDomain(group="p6m", cell_size=1.0)
domain.add_path(np.array([[0.1, 0.0], [0.3, 0.2], [0.15, 0.35]]))  # a vector motif

covering = generate_covering(domain, viewport_min=(-3, -3), viewport_max=(3, 3))
svg = svg_from_paths(covering, viewport_min=(-3, -3), viewport_max=(3, 3))
```

```python
domain = FundamentalDomain(group="p4g", cell_size=1.0)
domain.set_image(open("photo.png", "rb").read(), "photo.png")  # centers + auto-scales
domain.image.rotation_deg = 15.0
# tiler.render.covering_transforms() gives the (translation, Affine2D) pairs used
# by the widget to clip+place each copy on an HTML canvas; generate_covering() is
# for vector paths (domain.paths), not for compositing raster/SVG images.
```

## Layout

- `tiler.lattice` — the 5 Bravais lattice types (oblique, rectangular, centered
  rectangular, square, hexagonal) and their basis vectors.
- `tiler.groups` — the 17 wallpaper groups, each as a lattice type plus coset
  representatives of its point group (rotations, mirrors, glides). Verified for
  correct order and closure in `tests/test_groups.py`.
- `tiler.fundamental_domain` — the true fundamental-domain polygon, built as a
  Dirichlet (Voronoi) cell of the group's orbit — general for all 17 groups, not
  hand-derived per group. Verified (area, convexity, and gap/overlap-free tiling
  under random sampling) in `tests/test_fundamental_domain.py`.
- `tiler.image_source` — PNG/SVG format detection and intrinsic pixel-size parsing.
- `tiler.domain` — `FundamentalDomain` (paths + optional `ImagePlacement`) and the
  `polygon` property.
- `tiler.render` — `covering_transforms()` (the shared translation × point-group
  enumeration), `generate_covering()` for vector paths, and `svg_from_paths()`.
- `tiler.widget` — the interactive `TilerWidget` (ipywidgets + ipycanvas). Image
  compositing is done directly on the HTML canvas: each copy is
  `canvas.clip()`-ped to the fundamental-domain polygon under that copy's
  symmetry transform, then `draw_image()`-ed.

## Note on image placement

The auto-fit on image load scales to the fundamental domain's axis-aligned
*bounding box*, not the polygon itself — for a non-rectangular domain (e.g. the
triangular one in p4m/p31m/p6m) the image may slightly overflow the polygon at
first; the visible tiling is still exactly correct since the covering always clips
to the true polygon, so just scale/reposition until it looks right.

## Tests

```bash
pytest
```
