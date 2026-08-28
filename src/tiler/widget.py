"""Interactive Jupyter widget: draw a motif, pick a wallpaper group, see it tile the plane."""
from __future__ import annotations

import numpy as np

from .domain import FundamentalDomain
from .groups import GROUP_SYMBOLS, WALLPAPER_GROUPS
from .render import generate_covering

try:
    import ipywidgets as widgets
    from ipycanvas import Canvas
except ImportError as exc:  # pragma: no cover - exercised only without optional deps
    raise ImportError(
        "TilerWidget requires the optional 'ipywidgets' and 'ipycanvas' packages. "
        "Install them with: pip install tiler[dev] or pip install ipywidgets ipycanvas"
    ) from exc

_CANVAS_SIZE = 420
_MOTIF_PADDING_CELLS = 0.15  # fraction of a cell shown as margin around the drawing cell
_COVERING_CELLS_RADIUS = 2.2  # how many cells (roughly) to show in the covering preview


class TilerWidget(widgets.VBox):
    """A self-contained ipywidgets app. Display it directly in a notebook cell."""

    def __init__(self, group: str = "p4m", cell_size: float = 1.0, ratio: float = 1.0, angle_deg: float = 70.0):
        self.domain = FundamentalDomain(group=group, cell_size=cell_size, ratio=ratio, angle_deg=angle_deg)
        self._drawing = False
        self._current_stroke: list[tuple[float, float]] = []

        self.group_dropdown = widgets.Dropdown(
            options=[(f"{s}  ({WALLPAPER_GROUPS[s].orbifold})", s) for s in GROUP_SYMBOLS],
            value=group,
            description="Group:",
        )
        self.cell_size_slider = widgets.FloatSlider(
            value=cell_size, min=0.3, max=3.0, step=0.05, description="Cell size:"
        )
        self.ratio_slider = widgets.FloatSlider(
            value=ratio, min=0.3, max=3.0, step=0.05, description="b/a ratio:"
        )
        self.angle_slider = widgets.FloatSlider(
            value=angle_deg, min=20.0, max=160.0, step=1.0, description="Angle:"
        )
        self.clear_button = widgets.Button(description="Clear", icon="trash")
        self.undo_button = widgets.Button(description="Undo", icon="undo")
        self.status = widgets.HTML()

        self.draw_canvas = Canvas(width=_CANVAS_SIZE, height=_CANVAS_SIZE, sync_image_data=False)
        self.cover_canvas = Canvas(width=_CANVAS_SIZE, height=_CANVAS_SIZE, sync_image_data=False)

        self.group_dropdown.observe(self._on_group_change, names="value")
        self.cell_size_slider.observe(self._on_lattice_param_change, names="value")
        self.ratio_slider.observe(self._on_lattice_param_change, names="value")
        self.angle_slider.observe(self._on_lattice_param_change, names="value")
        self.clear_button.on_click(self._on_clear)
        self.undo_button.on_click(self._on_undo)

        self.draw_canvas.on_mouse_down(self._on_mouse_down)
        self.draw_canvas.on_mouse_move(self._on_mouse_move)
        self.draw_canvas.on_mouse_up(self._on_mouse_up)
        self.draw_canvas.on_mouse_out(self._on_mouse_up)

        controls = widgets.VBox(
            [
                self.group_dropdown,
                self.cell_size_slider,
                self.ratio_slider,
                self.angle_slider,
                widgets.HBox([self.undo_button, self.clear_button]),
                self.status,
            ]
        )
        canvases = widgets.HBox(
            [
                widgets.VBox([widgets.Label("Draw the motif in the cell:"), self.draw_canvas]),
                widgets.VBox([widgets.Label("Covering of the plane:"), self.cover_canvas]),
            ]
        )
        super().__init__([controls, canvases])
        self._update_lattice_controls_visibility()
        self._redraw_all()

    # -- coordinate mapping -----------------------------------------------------

    def _view_bounds(self) -> tuple[np.ndarray, np.ndarray]:
        a1, a2 = self.domain.basis
        span = max(np.linalg.norm(a1), np.linalg.norm(a2)) * (1 + _MOTIF_PADDING_CELLS)
        return -np.array([span, span]), np.array([span, span])

    def _to_canvas(self, points: np.ndarray, vmin: np.ndarray, vmax: np.ndarray) -> np.ndarray:
        extent = vmax - vmin
        extent[extent == 0] = 1.0
        x = (points[:, 0] - vmin[0]) / extent[0] * _CANVAS_SIZE
        y = _CANVAS_SIZE - (points[:, 1] - vmin[1]) / extent[1] * _CANVAS_SIZE
        return np.column_stack([x, y])

    def _from_canvas(self, x: float, y: float, vmin: np.ndarray, vmax: np.ndarray) -> tuple[float, float]:
        extent = vmax - vmin
        px = vmin[0] + (x / _CANVAS_SIZE) * extent[0]
        py = vmin[1] + ((_CANVAS_SIZE - y) / _CANVAS_SIZE) * extent[1]
        return px, py

    # -- drawing on the motif canvas ---------------------------------------------

    def _on_mouse_down(self, x: float, y: float) -> None:
        self._drawing = True
        vmin, vmax = self._view_bounds()
        self._current_stroke = [self._from_canvas(x, y, vmin, vmax)]

    def _on_mouse_move(self, x: float, y: float) -> None:
        if not self._drawing:
            return
        vmin, vmax = self._view_bounds()
        px, py = self._from_canvas(x, y, vmin, vmax)
        self._current_stroke.append((px, py))
        p0 = self._to_canvas(np.array([self._current_stroke[-2]]), vmin, vmax)[0]
        p1 = self._to_canvas(np.array([self._current_stroke[-1]]), vmin, vmax)[0]
        self.draw_canvas.stroke_line(p0[0], p0[1], p1[0], p1[1])

    def _on_mouse_up(self, x: float = 0.0, y: float = 0.0) -> None:
        if not self._drawing:
            return
        self._drawing = False
        if len(self._current_stroke) >= 2:
            self.domain.add_path(np.array(self._current_stroke))
        self._current_stroke = []
        self._redraw_all()

    def _on_clear(self, _button=None) -> None:
        self.domain.clear()
        self._redraw_all()

    def _on_undo(self, _button=None) -> None:
        self.domain.undo()
        self._redraw_all()

    def _on_group_change(self, change) -> None:
        self.domain.set_group(change["new"])
        self._update_lattice_controls_visibility()
        self._redraw_all()

    def _on_lattice_param_change(self, _change) -> None:
        self.domain.cell_size = self.cell_size_slider.value
        self.domain.ratio = self.ratio_slider.value
        self.domain.angle_deg = self.angle_slider.value
        self._redraw_all()

    def _update_lattice_controls_visibility(self) -> None:
        kind = self.domain.lattice_kind.value
        self.ratio_slider.layout.display = "none" if kind in ("square", "hexagonal") else None
        self.angle_slider.layout.display = None if kind == "oblique" else "none"

    # -- rendering ----------------------------------------------------------------

    def _draw_cell_outline(self, vmin: np.ndarray, vmax: np.ndarray) -> None:
        a1, a2 = self.domain.basis
        corners = np.array([[0, 0], a1, a1 + a2, a2, [0, 0]])
        canvas_pts = self._to_canvas(corners, vmin, vmax)
        self.draw_canvas.stroke_style = "#bbbbbb"
        self.draw_canvas.line_width = 1
        self.draw_canvas.stroke_lines(canvas_pts)

    def _redraw_all(self) -> None:
        vmin, vmax = self._view_bounds()

        self.draw_canvas.clear()
        self._draw_cell_outline(vmin, vmax)
        self.draw_canvas.stroke_style = "#1a1a1a"
        self.draw_canvas.line_width = 2
        for path in self.domain.paths:
            self.draw_canvas.stroke_lines(self._to_canvas(path, vmin, vmax))

        cvmin = vmin * _COVERING_CELLS_RADIUS
        cvmax = vmax * _COVERING_CELLS_RADIUS
        covering = generate_covering(self.domain, tuple(cvmin), tuple(cvmax))
        self.cover_canvas.clear()
        self.cover_canvas.stroke_style = "#1a1a1a"
        self.cover_canvas.line_width = 1.2
        for path in covering:
            self.cover_canvas.stroke_lines(self._to_canvas(path, cvmin, cvmax))

        self.status.value = f"<b>{len(self.domain.paths)}</b> stroke(s) &middot; <b>{len(covering)}</b> copies shown"
