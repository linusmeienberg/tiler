"""Interactive Jupyter widget: place an image (or draw a motif) in the true fundamental
domain of a wallpaper group, and watch it tile the plane."""
from __future__ import annotations

import numpy as np

from .domain import FundamentalDomain
from .groups import GROUP_SYMBOLS, WALLPAPER_GROUPS
from .render import covering_transforms
from .transforms import Affine2D

try:
    import ipywidgets as widgets
    from ipycanvas import Canvas, hold_canvas
except ImportError as exc:  # pragma: no cover - exercised only without optional deps
    raise ImportError(
        "TilerWidget requires the optional 'ipywidgets' and 'ipycanvas' packages. "
        "Install them with: pip install tiler[dev] or pip install ipywidgets ipycanvas"
    ) from exc

_CANVAS_SIZE = 420
_DOMAIN_PADDING = 0.35  # fraction of the domain's bounding-box size shown as margin
_COVERING_VIEW_RADIUS = 2.4  # how far out (in domain bbox units) the covering preview extends


def _view_transform(vmin: np.ndarray, vmax: np.ndarray, size: int) -> Affine2D:
    extent = vmax - vmin
    extent[extent == 0] = 1.0
    scale_x = size / extent[0]
    scale_y = size / extent[1]
    matrix = np.array([[scale_x, 0.0], [0.0, -scale_y]])
    translation = np.array([-scale_x * vmin[0], size + scale_y * vmin[1]])
    return Affine2D(matrix, translation)


def _canvas_params(affine: Affine2D) -> tuple[float, float, float, float, float, float]:
    m, t = affine.matrix, affine.translation
    return float(m[0, 0]), float(m[1, 0]), float(m[0, 1]), float(m[1, 1]), float(t[0]), float(t[1])


def _apply_transform(canvas: Canvas, affine: Affine2D) -> None:
    canvas.transform(*_canvas_params(affine))


class TilerWidget(widgets.VBox):
    """A self-contained ipywidgets app. Display it directly in a notebook cell."""

    def __init__(self, group: str = "p4m", cell_size: float = 1.0, ratio: float = 1.0, angle_deg: float = 70.0):
        self.domain = FundamentalDomain(group=group, cell_size=cell_size, ratio=ratio, angle_deg=angle_deg)
        self._image_widget: widgets.Image | None = None
        self._drawing = False
        self._dragging_image = False
        self._current_stroke: list[tuple[float, float]] = []
        self._drag_start_canvas: tuple[float, float] | None = None
        self._drag_start_center: np.ndarray | None = None

        self.group_dropdown = widgets.Dropdown(
            options=[(f"{s}  ({WALLPAPER_GROUPS[s].orbifold})", s) for s in GROUP_SYMBOLS],
            value=group,
            description="Group:",
        )
        # continuous_update=False: these drive a full covering redraw (up to ~1000+
        # copies), so only redraw when the slider is released, not on every tick.
        self.cell_size_slider = widgets.FloatSlider(
            value=cell_size, min=0.3, max=3.0, step=0.05, description="Cell size:", continuous_update=False
        )
        self.ratio_slider = widgets.FloatSlider(
            value=ratio, min=0.3, max=3.0, step=0.05, description="b/a ratio:", continuous_update=False
        )
        self.angle_slider = widgets.FloatSlider(
            value=angle_deg, min=20.0, max=160.0, step=1.0, description="Angle:", continuous_update=False
        )

        self.mode_toggle = widgets.ToggleButtons(options=["Draw", "Move image"], value="Draw", description="Mouse:")
        self.upload_button = widgets.FileUpload(accept=".png,.jpg,.jpeg,.svg", multiple=False, description="Load image")
        self.image_scale_slider = widgets.FloatLogSlider(
            value=1.0, base=2, min=-4, max=4, step=0.05, description="Img scale:", continuous_update=False
        )
        self.image_rotation_slider = widgets.FloatSlider(
            value=0.0, min=-180.0, max=180.0, step=1.0, description="Img rotate:", continuous_update=False
        )
        self.remove_image_button = widgets.Button(description="Remove image", icon="trash")

        self.clear_button = widgets.Button(description="Clear strokes", icon="eraser")
        self.undo_button = widgets.Button(description="Undo stroke", icon="undo")
        self.status = widgets.HTML()
        self._n_copies = 0

        self.draw_canvas = Canvas(width=_CANVAS_SIZE, height=_CANVAS_SIZE, sync_image_data=False)
        self.cover_canvas = Canvas(width=_CANVAS_SIZE, height=_CANVAS_SIZE, sync_image_data=False)

        self.group_dropdown.observe(self._on_group_change, names="value")
        self.cell_size_slider.observe(self._on_lattice_param_change, names="value")
        self.ratio_slider.observe(self._on_lattice_param_change, names="value")
        self.angle_slider.observe(self._on_lattice_param_change, names="value")
        self.upload_button.observe(self._on_upload, names="value")
        self.image_scale_slider.observe(self._on_image_param_change, names="value")
        self.image_rotation_slider.observe(self._on_image_param_change, names="value")
        self.remove_image_button.on_click(self._on_remove_image)
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
                widgets.HTML("<hr/>"),
                self.upload_button,
                self.mode_toggle,
                self.image_scale_slider,
                self.image_rotation_slider,
                self.remove_image_button,
                widgets.HTML("<hr/>"),
                widgets.HBox([self.undo_button, self.clear_button]),
                self.status,
            ]
        )
        canvases = widgets.HBox(
            [
                widgets.VBox([widgets.Label("Fundamental domain:"), self.draw_canvas]),
                widgets.VBox([widgets.Label("Covering of the plane:"), self.cover_canvas]),
            ]
        )
        super().__init__([controls, canvases])
        self._update_controls_visibility()
        self._redraw_all()

    # -- coordinate mapping -------------------------------------------------------

    def _view_bounds(self) -> tuple[np.ndarray, np.ndarray]:
        polygon = self.domain.polygon
        bbox_min, bbox_max = polygon.min(axis=0), polygon.max(axis=0)
        center = (bbox_min + bbox_max) / 2
        half_extent = max(bbox_max - bbox_min) / 2 * (1 + _DOMAIN_PADDING)
        half_extent = max(half_extent, 1e-6)
        return center - half_extent, center + half_extent

    def _to_canvas(self, points: np.ndarray, vmin: np.ndarray, vmax: np.ndarray) -> np.ndarray:
        return _view_transform(vmin, vmax, _CANVAS_SIZE).apply(points)

    def _from_canvas(self, x: float, y: float, vmin: np.ndarray, vmax: np.ndarray) -> tuple[float, float]:
        extent = vmax - vmin
        px = vmin[0] + (x / _CANVAS_SIZE) * extent[0]
        py = vmin[1] + ((_CANVAS_SIZE - y) / _CANVAS_SIZE) * extent[1]
        return px, py

    def _canvas_delta_to_world(self, dx: float, dy: float, vmin: np.ndarray, vmax: np.ndarray) -> tuple[float, float]:
        extent = vmax - vmin
        return dx / _CANVAS_SIZE * extent[0], -dy / _CANVAS_SIZE * extent[1]

    # -- mouse interaction ---------------------------------------------------------

    def _on_mouse_down(self, x: float, y: float) -> None:
        if self.mode_toggle.value == "Move image" and self.domain.image is not None:
            self._dragging_image = True
            self._drag_start_canvas = (x, y)
            self._drag_start_center = np.array(self.domain.image.center)
            return
        self._drawing = True
        vmin, vmax = self._view_bounds()
        self._current_stroke = [self._from_canvas(x, y, vmin, vmax)]

    def _on_mouse_move(self, x: float, y: float) -> None:
        if self._dragging_image and self.domain.image is not None:
            vmin, vmax = self._view_bounds()
            dx, dy = x - self._drag_start_canvas[0], y - self._drag_start_canvas[1]
            wdx, wdy = self._canvas_delta_to_world(dx, dy, vmin, vmax)
            self.domain.image.center = self._drag_start_center + np.array([wdx, wdy])
            self._redraw_draw_canvas()  # cheap live feedback; full covering redraws on mouse-up
            return
        if not self._drawing:
            return
        vmin, vmax = self._view_bounds()
        px, py = self._from_canvas(x, y, vmin, vmax)
        self._current_stroke.append((px, py))
        p0 = self._to_canvas(np.array([self._current_stroke[-2]]), vmin, vmax)[0]
        p1 = self._to_canvas(np.array([self._current_stroke[-1]]), vmin, vmax)[0]
        self.draw_canvas.stroke_line(p0[0], p0[1], p1[0], p1[1])

    def _on_mouse_up(self, x: float = 0.0, y: float = 0.0) -> None:
        if self._dragging_image:
            self._dragging_image = False
            self._drag_start_canvas = None
            self._drag_start_center = None
            self._redraw_cover_canvas()
            return
        if not self._drawing:
            return
        self._drawing = False
        if len(self._current_stroke) >= 2:
            self.domain.add_path(np.array(self._current_stroke))
        self._current_stroke = []
        self._redraw_all()

    # -- control callbacks -----------------------------------------------------------

    def _on_clear(self, _button=None) -> None:
        self.domain.clear()
        self._redraw_all()

    def _on_undo(self, _button=None) -> None:
        self.domain.undo()
        self._redraw_all()

    def _on_group_change(self, change) -> None:
        self.domain.set_group(change["new"])
        self._update_controls_visibility()
        self._redraw_all()

    def _on_lattice_param_change(self, _change) -> None:
        self.domain.cell_size = self.cell_size_slider.value
        self.domain.ratio = self.ratio_slider.value
        self.domain.angle_deg = self.angle_slider.value
        self._redraw_all()

    def _on_upload(self, change) -> None:
        uploads = change["new"]
        if not uploads:
            return
        item = uploads[0]
        self.domain.set_image(bytes(item["content"]), item["name"])
        self._sync_image_widget()
        self.image_scale_slider.unobserve(self._on_image_param_change, names="value")
        self.image_rotation_slider.unobserve(self._on_image_param_change, names="value")
        self.image_scale_slider.value = self.domain.image.scale
        self.image_rotation_slider.value = self.domain.image.rotation_deg
        self.image_scale_slider.observe(self._on_image_param_change, names="value")
        self.image_rotation_slider.observe(self._on_image_param_change, names="value")
        self.mode_toggle.value = "Move image"
        self.upload_button.value = ()
        self._update_controls_visibility()
        self._redraw_all()

    def _on_image_param_change(self, _change) -> None:
        if self.domain.image is None:
            return
        self.domain.image.scale = self.image_scale_slider.value
        self.domain.image.rotation_deg = self.image_rotation_slider.value
        self._redraw_all()

    def _on_remove_image(self, _button=None) -> None:
        self.domain.clear_image()
        self._image_widget = None
        self.mode_toggle.value = "Draw"
        self._update_controls_visibility()
        self._redraw_all()

    def _sync_image_widget(self) -> None:
        image = self.domain.image
        if image is None:
            self._image_widget = None
            return
        self._image_widget = widgets.Image(value=image.data, format=image.format)

    def _update_controls_visibility(self) -> None:
        kind = self.domain.lattice_kind.value
        self.ratio_slider.layout.display = "none" if kind in ("square", "hexagonal") else None
        self.angle_slider.layout.display = None if kind == "oblique" else "none"

        has_image = self.domain.image is not None
        display = None if has_image else "none"
        self.image_scale_slider.layout.display = display
        self.image_rotation_slider.layout.display = display
        self.remove_image_button.layout.display = display
        self.mode_toggle.disabled = not has_image

    # -- rendering --------------------------------------------------------------------

    def _draw_polygon_path(self, canvas: Canvas) -> None:
        pts = self.domain.polygon
        canvas.begin_path()
        canvas.move_to(pts[0, 0], pts[0, 1])
        for p in pts[1:]:
            canvas.line_to(p[0], p[1])
        canvas.close_path()

    def _redraw_all(self) -> None:
        self._redraw_draw_canvas()
        self._redraw_cover_canvas()

    def _redraw_draw_canvas(self) -> None:
        vmin, vmax = self._view_bounds()
        view = _view_transform(vmin, vmax, _CANVAS_SIZE)

        # -- reference canvas: base cell only, no group orbit --
        with hold_canvas():
            self._draw_reference_canvas(view)
        self._update_status()

    def _draw_reference_canvas(self, view: Affine2D) -> None:
        self.draw_canvas.clear()
        self.draw_canvas.save()  # S0: identity transform, no clip
        _apply_transform(self.draw_canvas, view)
        self._draw_polygon_path(self.draw_canvas)
        self.draw_canvas.clip()  # clip now active in this (view-transformed) state
        if self._image_widget is not None and self.domain.image is not None:
            self.draw_canvas.save()  # S1: transform=view, clip=polygon
            _apply_transform(self.draw_canvas, self.domain.image.to_world_transform())
            w, h = self.domain.image.pixel_size
            self.draw_canvas.draw_image(self._image_widget, 0, 0, w, h)
            self.draw_canvas.restore()  # back to S1: transform=view, clip still active
        self.draw_canvas.stroke_style = "#1a1a1a"
        self.draw_canvas.line_width = 2 / view.matrix[0, 0]
        for path in self.domain.paths:
            self.draw_canvas.stroke_lines(path)
        self.draw_canvas.restore()  # back to S0: identity transform, no clip

        self.draw_canvas.save()
        _apply_transform(self.draw_canvas, view)
        self.draw_canvas.stroke_style = "#4488ff"
        self.draw_canvas.line_width = 2 / view.matrix[0, 0]
        self._draw_polygon_path(self.draw_canvas)
        self.draw_canvas.stroke()
        self.draw_canvas.restore()

    def _redraw_cover_canvas(self) -> None:
        vmin, vmax = self._view_bounds()
        cvmin, cvmax = vmin * _COVERING_VIEW_RADIUS, vmax * _COVERING_VIEW_RADIUS
        cview = _view_transform(cvmin, cvmax, _CANVAS_SIZE)
        transforms = covering_transforms(self.domain, tuple(cvmin), tuple(cvmax))

        with hold_canvas():
            self.cover_canvas.clear()
            for t, rep in transforms:
                self.cover_canvas.save()
                _apply_transform(self.cover_canvas, cview)
                _apply_transform(self.cover_canvas, Affine2D(np.eye(2), t))
                _apply_transform(self.cover_canvas, rep)
                self._draw_polygon_path(self.cover_canvas)
                self.cover_canvas.clip()
                if self._image_widget is not None and self.domain.image is not None:
                    self.cover_canvas.save()
                    _apply_transform(self.cover_canvas, self.domain.image.to_world_transform())
                    w, h = self.domain.image.pixel_size
                    self.cover_canvas.draw_image(self._image_widget, 0, 0, w, h)
                    self.cover_canvas.restore()
                if self.domain.paths:
                    self.cover_canvas.stroke_style = "#1a1a1a"
                    self.cover_canvas.line_width = 1.2 / cview.matrix[0, 0]
                    for path in self.domain.paths:
                        self.cover_canvas.stroke_lines(path)
                self.cover_canvas.restore()

        self._n_copies = len(transforms)
        self._update_status()

    def _update_status(self) -> None:
        self.status.value = (
            f"<b>{len(self.domain.paths)}</b> stroke(s) &middot; "
            f"image: <b>{'yes' if self.domain.image else 'no'}</b> &middot; "
            f"<b>{self._n_copies}</b> copies shown"
        )
