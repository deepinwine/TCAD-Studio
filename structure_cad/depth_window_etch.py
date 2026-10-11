"""Structure Etch's configuration contract, independent of geometry mutation."""
from dataclasses import dataclass
import math
from numbers import Real
from typing import Optional, Tuple

import numpy as np


@dataclass(frozen=True)
class WindowParams:
    etch_mode: str = 'Standard'
    depth_reference: Optional[str] = None
    start_depth_nm: Optional[float] = None
    end_depth_nm: Optional[float] = None
    lower_z_nm: Optional[float] = None
    upper_z_nm: Optional[float] = None
    etch_distance_nm: Optional[float] = None
    directionality: float = 0.0


@dataclass(frozen=True)
class ResolvedWindow:
    lower_z_nm: float
    upper_z_nm: float
    reference_z_nm: Optional[float]
    z_indices: Tuple[int, ...]
    etch_distance_nm: float
    directionality: float


def _finite(params, key, default):
    value = params.get(key, default)
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real) or not math.isfinite(value):
        raise ValueError(f'{key} requires a finite number, not a boolean')
    return float(value)


def parse_window_params(params):
    """Validate only active window inputs; retain drafts in the caller's params."""
    if not isinstance(params, dict):
        raise ValueError('Structure Etch params must be an object')
    allowed = {'material', 'depth_nm', 'sidewall_angle_deg', 'etch_mode', 'depth_reference',
               'start_depth_nm', 'end_depth_nm', 'lower_z_nm', 'upper_z_nm',
               'etch_distance_nm', 'directionality_percent'}
    unknown = set(params) - allowed
    if unknown:
        raise ValueError(f'Unknown Structure Etch parameter: {sorted(unknown, key=str)[0]}')
    mode = params.get('etch_mode', 'Standard')
    if mode not in ('Standard', 'Depth window'):
        raise ValueError('etch_mode must be Standard or Depth window')
    if mode == 'Standard':
        return WindowParams()
    reference = params.get('depth_reference', 'Opening plane')
    if reference not in ('Opening plane', 'Fixed Z'):
        raise ValueError('depth_reference must be Opening plane or Fixed Z')
    distance = _finite(params, 'etch_distance_nm', 30.0)
    if distance <= 0:
        raise ValueError('etch_distance_nm must be positive')
    percent = _finite(params, 'directionality_percent', 0.0)
    if not 0 <= percent <= 100:
        raise ValueError('directionality_percent must be in [0, 100]')
    values = dict(etch_mode=mode, depth_reference=reference, etch_distance_nm=distance,
                  directionality=percent / 100.0)
    if reference == 'Opening plane':
        start = _finite(params, 'start_depth_nm', 100.0)
        end = _finite(params, 'end_depth_nm', 200.0)
        if start < 0 or end <= start:
            raise ValueError('start_depth_nm must be nonnegative and end_depth_nm must exceed start_depth_nm')
        values.update(start_depth_nm=start, end_depth_nm=end)
    else:
        lower = _finite(params, 'lower_z_nm', 100.0)
        upper = _finite(params, 'upper_z_nm', 200.0)
        if lower >= upper:
            raise ValueError('lower_z_nm must be less than upper_z_nm')
        values.update(lower_z_nm=lower, upper_z_nm=upper)
    return WindowParams(**values)


def resolve_window(model, parsed):
    """Freeze a rim reference and sample [lower, upper) at existing voxel centers.

    A local opening uses only closed columns sharing an edge with the opening.
    A fully open mask uses the global top. Neither rule follows the hole bottom.
    This function does not establish air access or construct an etch candidate.
    """
    if parsed.etch_mode == 'Standard':
        return None
    opened = np.asarray(model.open_mask, dtype=bool)
    if not opened.any():
        raise ValueError('Structure Etch Depth window: no effective opening')
    voxel = model.voxel_size_nm
    nz = model.grid.shape[2]
    reference = None
    if parsed.depth_reference == 'Opening plane':
        from structure_cad.operations import heights
        if opened.all():
            rim = opened
        else:
            rim = np.zeros(opened.shape, dtype=bool)
            # Explicit slices prohibit periodic wrapping at the domain edges.
            rim[1:, :] |= opened[:-1, :]
            rim[:-1, :] |= opened[1:, :]
            rim[:, 1:] |= opened[:, :-1]
            rim[:, :-1] |= opened[:, 1:]
            rim &= ~opened
        h = heights(model.grid)
        occupied_rim = rim & (h > 0)
        if not occupied_rim.any():
            raise ValueError('Structure Etch: no nonempty opening rim; use Fixed Z')
        reference = (int(h[occupied_rim].max()) - .5) * voxel
        lower = reference - parsed.end_depth_nm
        upper = reference - parsed.start_depth_nm
    else:
        lower, upper = parsed.lower_z_nm, parsed.upper_z_nm
    domain_lower, domain_upper = -.5 * voxel, (nz - .5) * voxel
    if lower < domain_lower or upper > domain_upper:
        raise ValueError('Structure Etch Depth window height band exceeds domain boundaries')
    centers = np.arange(nz) * voxel
    indices = tuple(int(index) for index in np.flatnonzero((centers >= lower) & (centers < upper)))
    if not indices:
        raise ValueError('Structure Etch Depth window height band contains no voxel center')
    return ResolvedWindow(lower_z_nm=lower, upper_z_nm=upper, reference_z_nm=reference,
                          z_indices=indices, etch_distance_nm=parsed.etch_distance_nm,
                          directionality=parsed.directionality)
