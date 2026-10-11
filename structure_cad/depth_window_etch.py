"""Frozen contact faces and bounded geometric Structure Etch candidates."""
from dataclasses import dataclass
import math
from numbers import Real
from typing import Optional, Tuple

import numpy as np
from scipy.ndimage import binary_propagation, distance_transform_edt


MAX_WORK_BYTES = 256 * 1024 * 1024
MAX_WORK_VISITS = 128 * 1024 * 1024


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
    material: object = 'Silicon Dioxide'


@dataclass(frozen=True)
class ResolvedWindow:
    lower_z_nm: float
    upper_z_nm: float
    reference_z_nm: Optional[float]
    z_indices: Tuple[int, ...]
    etch_distance_nm: float
    directionality: float
    target_id: int


@dataclass(frozen=True)
class AccessibleSurface:
    """Six original target face masks, ordered -X,+X,-Y,+Y,-Z,+Z.

    Face coordinates follow voxel boundaries, not voxel centers. Their Z patch
    intervals are intersected with the resolved band during distance evaluation.
    All arrays own detached, read-only storage.
    """
    faces: Tuple[np.ndarray, ...]
    reachable_air: np.ndarray
    open_mask: np.ndarray


def precheck_budget(model, window):
    """Reject before even resolve_window's O(N) occupied/height work.

    The workspace envelope includes six face masks, flood-fill queues, complete
    candidate/selection arrays, and SciPy's doubled-XY EDT feature workspace.
    The work envelope counts three XY transforms per source Z layer and the
    bounded Z interval comparisons. No distance-cubed kernel is allocated.
    """
    nx, ny, nz = (int(n) for n in model.grid.shape)
    voxel = float(model.voxel_size_nm)
    distance, a = window.etch_distance_nm, window.directionality
    if min(nx, ny, nz) <= 0 or not math.isfinite(voxel) or voxel <= 0:
        raise ValueError('Structure Etch Depth window: invalid domain')
    scaled = distance / voxel
    if not math.isfinite(scaled) or scaled > math.hypot(nx, ny, nz):
        raise ValueError('Structure Etch Depth window distance exceeds domain distance budget')
    count = nx * ny * nz
    plane = (2*nx+1) * (2*ny+1)
    required = count * (80 + model.grid.dtype.itemsize) + plane * 64 + nx*ny*32
    if required > MAX_WORK_BYTES:
        raise ValueError('Structure Etch Depth window exceeds workspace memory budget')
    span = min(nz, int(math.ceil((2-a)*scaled)) + 3)
    visits = 3*nz*plane + 3*count*span
    if visits > MAX_WORK_VISITS:
        raise ValueError('Structure Etch Depth window exceeds distance work budget')


def _finite(params, key, default):
    value = params.get(key, default)
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real):
        raise ValueError(f'{key} requires a finite number, not a boolean')
    try:
        number = float(value)
    except (OverflowError, ValueError):
        raise ValueError(f'{key} requires a finite representable number') from None
    if not math.isfinite(number):
        raise ValueError(f'{key} requires a finite number')
    return number


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
    if isinstance(params.get('material'), (bool, np.bool_)):
        raise ValueError('material requires a registered material, not a boolean')
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
                  directionality=percent / 100.0, material=params.get('material', 'Silicon Dioxide'))
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
    precheck_budget(model, parsed)
    from structure_cad.operations import material_id
    target_id = material_id(model, parsed.material)
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
                          directionality=parsed.directionality, target_id=target_id)


def accessible_surface(model, resolved):
    """Freeze real target/air faces reached only from current mask top inlets."""
    from structure_cad.operations import top
    top(model)
    precheck_budget(model, resolved)
    opened = np.array(model.open_mask, dtype=bool, copy=True)
    if not opened.any():
        raise ValueError('Structure Etch Depth window: no effective opening')
    air = model.grid == 0
    inlet = np.zeros(model.grid.shape, dtype=bool)
    inlet[:, :, -1] = opened & air[:, :, -1]
    reachable = binary_propagation(inlet, mask=air)
    target = model.grid == resolved.target_id
    faces = []
    voxel = model.voxel_size_nm
    for axis in range(3):
        for sign in (-1, 1):
            face = np.zeros(model.grid.shape, dtype=bool)
            destination, neighbor = [slice(None)]*3, [slice(None)]*3
            destination[axis] = slice(1, None) if sign < 0 else slice(None, -1)
            neighbor[axis] = slice(None, -1) if sign < 0 else slice(1, None)
            face[tuple(destination)] = target[tuple(destination)] & reachable[tuple(neighbor)]
            if axis == 2 and sign == 1:
                # External air exists above the domain only at the top mask.
                face[:, :, -1] |= target[:, :, -1] & opened
            for k in range(model.grid.shape[2]):
                if axis == 2:
                    z = (k + sign*.5)*voxel
                    intersects = resolved.lower_z_nm <= z < resolved.upper_z_nm
                else:
                    intersects = max((k-.5)*voxel, resolved.lower_z_nm) < min((k+.5)*voxel, resolved.upper_z_nm)
                if not intersects:
                    face[:, :, k] = False
            face.flags.writeable = False
            faces.append(face)
    if not any(face.any() for face in faces):
        raise ValueError('Structure Etch Depth window: no accessible target surface; create a channel or adjust the band')
    reachable.flags.writeable = False
    opened.flags.writeable = False
    return AccessibleSurface(tuple(faces), reachable, opened)


def _project_faces(surface, k, group, shape):
    """Exact XY patch projection on a 2D half-voxel lattice.

    A voxel-center query's closest point on an axis-aligned patch always lies
    at a center or half-grid edge in XY. Marking those points makes EDT exact
    for these queries, including patch edges/corners; no 3D refinement occurs.
    """
    nx, ny = shape
    projected = np.zeros((2*nx+1, 2*ny+1), dtype=bool)
    if group < 2:
        selected = surface.faces[4+group][:, :, k]
        for dx in range(3):
            for dy in range(3):
                projected[dx:dx+2*nx:2, dy:dy+2*ny:2] |= selected
    else:
        for axis in range(2):
            for side in range(2):
                selected = surface.faces[2*axis+side][:, :, k]
                for tangent in range(3):
                    dx, dy = (2*side, tangent) if axis == 0 else (tangent, 2*side)
                    projected[dx:dx+2*nx:2, dy:dy+2*ny:2] |= selected
    return projected


def window_etch_candidate(model, resolved):
    """Return a detached complete candidate, without publishing model writes.

    For each original face layer, its rectangle swept along -Z is a Cartesian
    product of its XY patch and a continuous Z interval. EDT supplies exact XY
    distance; distance to that interval supplies the Z term. Testing the sum
    against ((1-a)*r)^2 implements precisely the sphere-plus-segment rule.
    """
    precheck_budget(model, resolved)
    surface = accessible_surface(model, resolved)
    voxel = model.voxel_size_nm
    radius = (1-resolved.directionality)*resolved.etch_distance_nm
    sweep = resolved.directionality*resolved.etch_distance_nm
    selected = np.zeros(model.grid.shape, dtype=bool)
    # Use voxel units to avoid squaring unbounded physical coordinates.
    radius2 = (radius/voxel)**2
    tolerance = 16*np.finfo(float).eps*max(1, radius2)
    for k in range(model.grid.shape[2]):
        for group in range(3):
            if group < 2:
                lower = upper = (k + (-.5 if group == 0 else .5))*voxel
                if not resolved.lower_z_nm <= lower < resolved.upper_z_nm:
                    continue
            else:
                lower = max((k-.5)*voxel, resolved.lower_z_nm)
                upper = min((k+.5)*voxel, resolved.upper_z_nm)
                if lower >= upper:
                    continue
            projected = _project_faces(surface, k, group, model.grid.shape[:2])
            if not projected.any():
                continue  # EDT on all-nonzero input invents an exterior seed.
            lower = (lower-sweep)/voxel
            upper /= voxel
            xy = distance_transform_edt(~projected, sampling=.5)[1::2, 1::2]
            xy2 = np.square(xy)
            for z in resolved.z_indices:
                dz = max(lower-z, z-upper, 0)
                if dz*dz <= radius2 + tolerance:
                    selected[:, :, z] |= xy2 <= radius2-dz*dz+tolerance
    selected &= model.grid == resolved.target_id
    # Restrict connectivity to eligible deletion voxels plus original reachable
    # air: no path may tunnel through barriers or detour through unetched target.
    traversable = selected | surface.reachable_air
    inlet = surface.reachable_air.copy()
    inlet[:, :, -1] |= selected[:, :, -1] & surface.open_mask
    connected = binary_propagation(inlet, mask=traversable)
    selected &= connected
    if not selected.any():
        raise ValueError('Structure Etch Depth window: no effective deletion (no geometry changed)')
    candidate = model.grid.copy()
    candidate[selected] = 0
    return candidate
