"""Structure Etch configuration and frozen, center-sampled height bands."""
import importlib
from collections import deque
from types import SimpleNamespace
import unittest
from dataclasses import FrozenInstanceError
from unittest import mock

import numpy as np
import tcad_simulator as tcad
from recipe_planner.schema import parameter_errors, step_schema
from structure_cad.operations import preflight_candidate


def face_oracle(model, resolved):
    """Small-fixture oracle: BFS air, enumerate real rectangles, clamp each point.

    Deliberately uses neither EDT nor production face masks/projection helpers.
    """
    grid, voxel = model.grid, model.voxel_size_nm
    shape = grid.shape
    directions = [(axis, sign) for axis in range(3) for sign in (-1, 1)]

    def neighbors(point):
        for axis, sign in directions:
            q = list(point)
            q[axis] += sign
            if 0 <= q[axis] < shape[axis]:
                yield tuple(q)

    air = set((x, y, shape[2]-1) for x, y in np.ndindex(shape[:2])
              if model.open_mask[x, y] and grid[x, y, -1] == 0)
    queue = deque(air)
    while queue:
        for q in neighbors(queue.popleft()):
            if grid[q] == 0 and q not in air:
                air.add(q)
                queue.append(q)
    faces = []
    for point in np.ndindex(shape):
        if grid[point] != resolved.target_id:
            continue
        for axis, sign in directions:
            q = list(point)
            q[axis] += sign
            exterior_top = axis == 2 and sign == 1 and q[2] == shape[2] and model.open_mask[point[:2]]
            if tuple(q) not in air and not exterior_top:
                continue
            lo = [(i-.5)*voxel for i in point]
            hi = [(i+.5)*voxel for i in point]
            lo[axis] = hi[axis] = (point[axis]+sign*.5)*voxel
            if axis == 2:
                if not resolved.lower_z_nm <= lo[2] < resolved.upper_z_nm:
                    continue
            else:
                lo[2] = max(lo[2], resolved.lower_z_nm)
                hi[2] = min(hi[2], resolved.upper_z_nm)
                if lo[2] >= hi[2]:
                    continue
            lo[2] -= resolved.directionality * resolved.etch_distance_nm
            faces.append((lo, hi))
    radius = (1-resolved.directionality)*resolved.etch_distance_nm
    eligible = set()
    for point in np.ndindex(shape):
        if grid[point] != resolved.target_id or point[2] not in resolved.z_indices:
            continue
        center = [i*voxel for i in point]
        if any(sum(max(low-value, value-high, 0)**2 for value, low, high in zip(center, lo, hi))
               <= radius**2 + 1e-10 for lo, hi in faces):
            eligible.add(point)
    reached = set(air)
    reached.update(p for p in eligible if p[2] == shape[2]-1 and model.open_mask[p[:2]])
    queue = deque(reached)
    while queue:
        for q in neighbors(queue.popleft()):
            if q in eligible and q not in reached:
                reached.add(q)
                queue.append(q)
    expected = grid.copy()
    for p in eligible & reached:
        expected[p] = 0
    return expected, faces


class DepthWindowGeometryTests(unittest.TestCase):
    def setUp(self):
        self.api = importlib.import_module('structure_cad.depth_window_etch')
        self.db = tcad.MaterialDatabase()
        self.si = self.db.id_for('Silicon')
        self.cu = self.db.id_for('Copper')

    def model(self, shape=(9, 9, 12), voxel=10):
        model = tcad.ProcessModel(self.db, grid_shape=shape, voxel_size_nm=voxel, max_workers=1)
        self.addCleanup(model.parallel.shutdown)
        model.grid.fill(0)
        model.open_mask.fill(False)
        return model

    def resolved(self, model, **overrides):
        params = dict(etch_mode='Depth window', material='Silicon', depth_reference='Fixed Z',
                      lower_z_nm=20, upper_z_nm=70, etch_distance_nm=30,
                      directionality_percent=0)
        params.update(overrides)
        resolved = self.api.resolve_window(model, self.api.parse_window_params(params))
        self.assertTrue(hasattr(resolved, 'target_id'), 'Resolved target material must be frozen')
        return resolved

    def candidate(self, model, resolved):
        method = getattr(self.api, 'window_etch_candidate', None)
        self.assertTrue(callable(method), 'Real contact-face candidate geometry is missing')
        return method(model, resolved)

    def channel(self, shape=(9, 9, 12)):
        model = self.model(shape)
        model.grid[:, :, :10] = self.si
        model.grid[4, 4, 2:] = 0
        model.open_mask[4, 4] = True
        return model

    def assert_oracle(self, model, resolved):
        before = model.grid.copy()
        expected, faces = face_oracle(model, resolved)
        self.assertTrue(faces)
        if not np.any(expected != before):
            with self.assertRaisesRegex(ValueError, 'no geometry changed|no effective deletion'):
                self.candidate(model, resolved)
            np.testing.assert_array_equal(model.grid, before)
            return expected
        actual = self.candidate(model, resolved)
        np.testing.assert_array_equal(actual, expected)
        np.testing.assert_array_equal(model.grid, before)
        self.assertFalse(np.shares_memory(actual, model.grid))
        return actual

    def test_contact_face_30nm_deletes_three_layers_not_four(self):
        model = self.channel((11, 9, 12))
        resolved = self.resolved(model)
        actual = self.assert_oracle(model, resolved)
        # Wall face at x=45 nm: centers x=50/60/70 removed, x=80 retained.
        np.testing.assert_array_equal(actual[5:8, 4, 4], 0)
        self.assertEqual(actual[8, 4, 4], self.si)
        np.testing.assert_array_equal(actual[:, :, :2], model.grid[:, :, :2])
        np.testing.assert_array_equal(actual[:, :, 7:], model.grid[:, :, 7:])

    def test_pure_z_from_vertical_walls_is_no_change(self):
        model = self.channel()
        resolved = self.resolved(model, directionality_percent=100)
        _, faces = face_oracle(model, resolved)
        self.assertTrue(faces)
        before = model.grid.copy()
        with self.assertRaisesRegex(ValueError, 'no geometry changed|no effective deletion'):
            self.candidate(model, resolved)
        np.testing.assert_array_equal(model.grid, before)

    def test_directionality_sweeps_real_floor_and_wall_patches(self):
        model = self.channel()
        candidates = []
        for percent in (0, 50, 100):
            resolved = self.resolved(model, lower_z_nm=-5, upper_z_nm=75,
                                     directionality_percent=percent)
            candidates.append(self.assert_oracle(model, resolved))
        self.assertFalse(np.array_equal(candidates[0], candidates[2]))
        self.assertEqual(candidates[2][4, 4, 0], 0)
        self.assertEqual(candidates[2][5, 4, 4], self.si)
        self.assertEqual(candidates[1][6, 4, 4], 0)  # 15 nm sphere radius.
        self.assertEqual(candidates[1][7, 4, 4], self.si)

    def test_all_face_orientations_noninteger_distance_and_fractional_band_clip(self):
        model = self.model((7, 7, 9))
        model.grid[:, :, :7] = self.si
        # Inlet joins a chamber exposing floors, ceilings and four wall directions.
        model.grid[3, 3, 3:] = 0
        model.grid[2:5, 2:5, 3:5] = 0
        model.open_mask[3, 3] = True
        for percent in (0, 17, 50, 83, 100):
            for lower, upper in ((12.3, 58.7), (34.2, 46.1)):
                resolved = self.resolved(model, lower_z_nm=lower, upper_z_nm=upper,
                                         etch_distance_nm=23.7, directionality_percent=percent)
                self.assert_oracle(model, resolved)

    def test_rectangular_circular_multiple_inlets_and_nonflat_surface(self):
        model = self.model((11, 11, 12))
        for x, y in np.ndindex(model.grid.shape[:2]):
            model.grid[x, y, :8 + (x+y) % 3] = self.si
        xx, yy = np.indices(model.open_mask.shape)
        opened = ((xx-3)**2 + (yy-3)**2 <= 2) | ((xx >= 7) & (xx <= 8) & (yy >= 6) & (yy <= 8))
        model.open_mask[:] = opened
        model.grid[opened, 2:] = 0
        for percent in (0, 50, 100):
            resolved = self.resolved(model, lower_z_nm=-5, upper_z_nm=65,
                                     etch_distance_nm=17.3, directionality_percent=percent)
            self.assert_oracle(model, resolved)

    def test_air_inlet_cannot_start_at_side_or_closed_cavity(self):
        model = self.model((7, 7, 9))
        model.grid.fill(self.cu)
        model.grid[3, 3, 7:] = 0
        model.open_mask[3, 3] = True
        model.grid[0, 1:3, 2:4] = 0  # side-only void, disconnected from inlet.
        model.grid[1, 1:3, 2:4] = self.si
        model.grid[4, 4, 3] = 0  # sealed cavity.
        model.grid[4, 5, 3] = self.si
        with self.assertRaisesRegex(ValueError, 'surface|channel|target'):
            self.candidate(model, self.resolved(model))

    def test_no_channel_no_target_and_top_mask_only(self):
        for case in ('buried', 'absent', 'wrong inlet'):
            model = self.model((7, 7, 9))
            model.grid[:, :, :7] = self.si if case != 'absent' else self.cu
            model.open_mask[3, 3] = True
            if case == 'wrong inlet':
                model.grid[:, :, 7:] = self.cu
                model.grid[1, 1, 2:] = 0
            with self.subTest(case=case), self.assertRaisesRegex(ValueError, 'surface|channel|target'):
                self.candidate(model, self.resolved(model, upper_z_nm=55))

    def test_other_material_blocks_isolated_same_material_and_does_not_change(self):
        model = self.model((9, 9, 9))
        model.grid.fill(self.cu)
        model.grid[2, 4, 2:] = 0
        model.open_mask[2, 4] = True
        model.grid[3, 4, 2:7] = self.si
        model.grid[5, 4, 2:7] = self.si  # within 30nm, across copper barrier.
        # Same-material detour below the band must not bypass that barrier.
        model.grid[3:6, 4, 1] = self.si
        resolved = self.resolved(model, etch_distance_nm=35)
        actual = self.assert_oracle(model, resolved)
        np.testing.assert_array_equal(actual[3, 4, 2:7], 0)
        np.testing.assert_array_equal(actual[5, 4, 2:7], self.si)
        np.testing.assert_array_equal(actual[:, :, :2], model.grid[:, :, :2])
        np.testing.assert_array_equal(actual[model.grid == self.cu], self.cu)

    def test_distance_monotonicity_and_directionality_lateral_extent(self):
        model = self.channel((11, 9, 12))
        deletions = []
        for distance in (10, 20, 30):
            candidate = self.candidate(model, self.resolved(model, etch_distance_nm=distance))
            deletions.append((candidate == 0) & (model.grid == self.si))
        self.assertTrue(np.all(~deletions[0] | deletions[1]))
        self.assertTrue(np.all(~deletions[1] | deletions[2]))
        extents = []
        for percent in (0, 50, 100):
            candidate = self.assert_oracle(model, self.resolved(model, lower_z_nm=-5, upper_z_nm=75,
                                                               directionality_percent=percent))
            x, y, _ = np.nonzero((candidate == 0) & (model.grid == self.si))
            extents.append(max(np.max(abs(x-4)), np.max(abs(y-4))))
        self.assertEqual(extents, [3, 2, 0])

    def test_surfaces_and_target_are_frozen_and_arrays_readonly(self):
        model = self.channel()
        method = getattr(self.api, 'accessible_surface', None)
        self.assertTrue(callable(method), 'Accessible contact-face seeds are missing')
        resolved = self.resolved(model)
        self.assertEqual(resolved.target_id, self.si)
        surface = method(model, resolved)
        self.assertTrue(any(face.any() for face in surface.faces))
        for array in (*surface.faces, surface.reachable_air, surface.open_mask):
            self.assertFalse(array.flags.writeable)
            saved = array.copy()
            model.grid.fill(self.cu)
            model.open_mask.fill(True)
            np.testing.assert_array_equal(array, saved)

    def test_default_and_numeric_material_use_existing_registry_contract(self):
        model = self.channel()
        for value in ('Silicon', self.si, np.int64(self.si)):
            resolved = self.resolved(model, material=value)
            self.assertEqual(resolved.target_id, self.si)
        parsed = self.api.parse_window_params(dict(etch_mode='Depth window', depth_reference='Fixed Z',
                                                  lower_z_nm=20, upper_z_nm=70))
        resolved = self.api.resolve_window(model, parsed)
        self.assertTrue(hasattr(resolved, 'target_id'), 'Resolved target material must be frozen')
        self.assertEqual(resolved.target_id, self.db.id_for('Silicon Dioxide'))

    def test_budgets_reject_before_resolve_heights_or_candidate_allocations(self):
        self.assertTrue(hasattr(self.api, 'MAX_WORK_BYTES'), 'Preallocation workspace budget is missing')
        model = self.channel()
        resolved = self.resolved(model)
        parsed = self.api.parse_window_params(dict(etch_mode='Depth window', material='Silicon',
                                                  start_depth_nm=10, end_depth_nm=30))
        with mock.patch.object(self.api, 'MAX_WORK_BYTES', 1), \
                mock.patch('structure_cad.operations.heights', side_effect=AssertionError('allocated occupied')), \
                mock.patch.object(self.api.np, 'zeros', side_effect=AssertionError('allocated volume')):
            with self.assertRaisesRegex(ValueError, 'budget'):
                self.api.resolve_window(model, parsed)
            with self.assertRaisesRegex(ValueError, 'budget'):
                self.candidate(model, resolved)
        with mock.patch.object(self.api, 'MAX_WORK_VISITS', 1):
            with self.assertRaisesRegex(ValueError, 'budget'):
                self.api.resolve_window(model, parsed)
        with self.assertRaisesRegex(ValueError, 'distance|budget'):
            self.resolved(model, etch_distance_nm=1e300)

    def test_grid128_default_geometry_budget_is_accepted(self):
        model = self.model((128, 128, 128), voxel=5)
        model.grid[:, :, :100] = self.si
        model.grid[64, 64, 20:] = 0
        model.open_mask[64, 64] = True
        resolved = self.resolved(model, lower_z_nm=250, upper_z_nm=350)
        actual = self.candidate(model, resolved)
        self.assertTrue(np.any(actual != model.grid))
        self.assertEqual(actual[71, 64, 60], self.si)  # 32.5nm from contact face.
        self.assertEqual(actual[70, 64, 60], 0)  # 27.5nm, within r=30nm.

    def prepared_commit(self):
        model = self.model()
        for factory, thickness in ((tcad.StructureWaferStep, 50), (tcad.StructureDepositStep, 50)):
            step = factory(self.db)
            step.params.update(material='Silicon', thickness_nm=thickness)
            step.execute(model)
        model.grid[4, 4, 2:] = 0
        model.display_provenance.owners[model.grid == 0] = 0
        model._rebuild_height_map(preserve_display=True)
        model.open_mask.fill(False)
        model.open_mask[4, 4] = True
        model.doping = np.full(model.grid.shape, 7, dtype=np.float32)
        model.active_dopants = np.full(model.grid.shape, 3, dtype=np.float32)
        model.dopant_species_fields['B'] = np.full(model.grid.shape, 2, dtype=np.float32)
        etch = tcad.StructureEtchStep(self.db)
        etch.params.update(etch_mode='Depth window', material='Silicon', depth_reference='Fixed Z',
                           lower_z_nm=20, upper_z_nm=70, etch_distance_nm=30, directionality_percent=0)
        return model, etch

    def saved_state(self, model):
        return ({name: getattr(model, name).copy() for name in ('grid', 'height_map', 'open_mask',
                                                               'doping', 'active_dopants')},
                model.dopant_species_fields['B'].copy(), model.display_provenance.owners.copy(),
                dict(model.display_provenance.step_ids))

    def assert_saved_state(self, model, saved):
        arrays, species, owners, identities = saved
        for name, array in arrays.items():
            np.testing.assert_array_equal(getattr(model, name), array)
        np.testing.assert_array_equal(model.dopant_species_fields['B'], species)
        np.testing.assert_array_equal(model.display_provenance.owners, owners)
        self.assertEqual(model.display_provenance.step_ids, identities)

    def test_construct_and_execute_commit_only_deleted_fields_and_owners(self):
        from structure_cad.operations import construct
        for direct in (True, False):
            model, step = self.prepared_commit()
            saved = self.saved_state(model)
            resolved = self.api.resolve_window(model, self.api.parse_window_params(step.params))
            expected, _ = face_oracle(model, resolved)
            deleted = expected != model.grid
            with self.subTest(direct=direct):
                if direct:
                    self.assertEqual(construct(model, 'Etch', step_id=step.step_id, **step.params), int(deleted.sum()))
                else:
                    self.assertIn(str(int(deleted.sum())), step.execute(model))
                np.testing.assert_array_equal(model.grid, expected)
                for name in ('doping', 'active_dopants'):
                    self.assertFalse(getattr(model, name)[deleted].any())
                    np.testing.assert_array_equal(getattr(model, name)[~deleted], saved[0][name][~deleted])
                self.assertFalse(model.dopant_species_fields['B'][deleted].any())
                np.testing.assert_array_equal(model.dopant_species_fields['B'][~deleted], saved[1][~deleted])
                self.assertFalse(model.display_provenance.owners[deleted].any())
                np.testing.assert_array_equal(model.display_provenance.owners[~deleted], saved[2][~deleted])
                self.assertEqual(model.display_provenance.step_ids, saved[3])
                self.assertEqual(model.display_provenance.owner_for(step.step_id), 0)
                np.testing.assert_array_equal(model.open_mask, saved[0]['open_mask'])
                self.assertEqual(model.current_time_s, 0)

    def test_direct_and_execute_readonly_source_and_spatial_failures_are_atomic(self):
        from structure_cad.operations import construct
        for direct in (True, False):
            for readonly in ('grid', 'doping', 'species', 'owners', 'source shape'):
                model, step = self.prepared_commit()
                if readonly == 'species':
                    model.dopant_species_fields['B'].flags.writeable = False
                elif readonly == 'owners':
                    model.display_provenance.owners.flags.writeable = False
                elif readonly == 'source shape':
                    model.display_provenance.owners = model.display_provenance.owners[:, :, :-1].copy()
                else:
                    getattr(model, readonly).flags.writeable = False
                saved = self.saved_state(model)
                with self.subTest(direct=direct, readonly=readonly), self.assertRaisesRegex(ValueError, 'writable|owners'):
                    if direct:
                        construct(model, 'Etch', step_id=step.step_id, **step.params)
                    else:
                        step.execute(model)
                self.assert_saved_state(model, saved)

    def test_no_change_budget_and_no_surface_fail_without_partial_publish(self):
        model, step = self.prepared_commit()
        for case in ('directional wall', 'budget', 'no surface'):
            step.params.update(lower_z_nm=20, upper_z_nm=70, directionality_percent=0,
                               etch_distance_nm=30)
            if case == 'directional wall':
                step.params['directionality_percent'] = 100
            elif case == 'budget':
                step.params['etch_distance_nm'] = 1e300
            else:
                step.params.update(lower_z_nm=0, upper_z_nm=5)
            saved = self.saved_state(model)
            with self.subTest(case=case), self.assertRaisesRegex(ValueError, 'deletion|distance|budget|surface'):
                step.execute(model)
            self.assert_saved_state(model, saved)

    def test_approved_deep_hole_opening_plane_and_fixed_z_produce_same_candidate(self):
        model = self.model((11, 11, 50))
        model.grid[:, :, :40] = self.si
        model.grid[5, 5, 10:] = 0
        model.open_mask[5, 5] = True
        before = model.grid.copy()
        results = []
        for percent in (0, 50, 100):
            opening = self.resolved(model, depth_reference='Opening plane', start_depth_nm=100,
                                    end_depth_nm=200, directionality_percent=percent)
            fixed = self.resolved(model, lower_z_nm=195, upper_z_nm=295,
                                  directionality_percent=percent)
            self.assertEqual((opening.reference_z_nm, opening.z_indices), (395, tuple(range(20, 30))))
            if percent == 100:
                for resolved in (opening, fixed):
                    with self.assertRaisesRegex(ValueError, 'no effective deletion'):
                        self.candidate(model, resolved)
                continue
            a = self.assert_oracle(model, opening)
            b = self.candidate(model, fixed)
            np.testing.assert_array_equal(a, b)
            np.testing.assert_array_equal(a[:, :, :20], before[:, :, :20])
            np.testing.assert_array_equal(a[:, :, 30:], before[:, :, 30:])
            results.append(a)
        self.assertFalse(np.array_equal(*results))
        np.testing.assert_array_equal(model.grid, before)

    def test_large_domain_budget_rejects_without_reading_or_allocating_grid(self):
        model = self.model()
        parsed = self.api.parse_window_params(dict(etch_mode='Depth window', material='Silicon'))
        model.grid = SimpleNamespace(shape=(512, 512, 512), dtype=np.dtype(np.uint16))
        with mock.patch.object(self.api.np, 'asarray', side_effect=AssertionError('read volume')), \
                mock.patch.object(self.api.np, 'zeros', side_effect=AssertionError('allocated volume')):
            with self.assertRaisesRegex(ValueError, 'memory budget'):
                self.api.resolve_window(model, parsed)

    def test_band_upper_face_excluded_and_original_faces_do_not_move(self):
        model = self.model((7, 7, 9))
        model.grid[:, :, :5] = self.si
        model.open_mask[3, 3] = True
        # Surface plane z=45 is exactly the excluded upper bound.
        with self.assertRaisesRegex(ValueError, 'surface'):
            self.candidate(model, self.resolved(model, lower_z_nm=15, upper_z_nm=45))
        # Include the original plane. r=13 consumes one center (5nm), not the
        # next (15nm); newly exposed faces never receive another distance budget.
        resolved = self.resolved(model, lower_z_nm=15, upper_z_nm=45.1,
                                 etch_distance_nm=13, directionality_percent=100)
        actual = self.assert_oracle(model, resolved)
        self.assertEqual(actual[3, 3, 4], 0)
        self.assertEqual(actual[3, 3, 3], self.si)

    def test_seed_projection_round_corners_and_reachability_match_random_voxels(self):
        rng = np.random.default_rng(710)
        for case in range(8):
            model = self.model((5, 6, 7), voxel=7)
            model.grid[:] = rng.choice([0, self.si, self.cu], size=model.grid.shape,
                                       p=[.30, .50, .20])
            model.open_mask[:] = rng.random(model.open_mask.shape) > .6
            model.open_mask[2, 3] = True
            model.grid[2, 3, 2:] = 0
            model.grid[2, 3, 1] = self.si
            resolved = self.resolved(model, lower_z_nm=2.2, upper_z_nm=33.1,
                                     etch_distance_nm=11.3+case*.4, directionality_percent=case*13)
            with self.subTest(case=case):
                self.assert_oracle(model, resolved)

    def test_analytic_downward_radius_and_upward_directionality_limits(self):
        floor = self.model((7, 7, 12))
        floor.grid.fill(self.cu)
        floor.grid[3, 3, :6] = self.si
        floor.grid[3, 3, 6:] = 0
        floor.open_mask[3, 3] = True
        # A floor face at 55nm has max downward displacement r for every a.
        for percent in (0, 50, 100):
            resolved = self.resolved(floor, lower_z_nm=-5, upper_z_nm=60,
                                     directionality_percent=percent)
            actual = self.assert_oracle(floor, resolved)
            np.testing.assert_array_equal(actual[3, 3, 3:6], 0)  # 5/15/25nm.
            self.assertEqual(actual[3, 3, 2], self.si)  # 35nm.

        ceiling = self.model((7, 7, 12))
        ceiling.grid.fill(self.cu)
        ceiling.grid[1, 3, 3:] = 0
        ceiling.grid[1:4, 3, 3:5] = 0
        ceiling.grid[3, 3, 5:10] = self.si
        ceiling.open_mask[1, 3] = True
        # Only the lower horizontal face of the ceiling is accessible (z=45).
        for percent, count in ((0, 3), (50, 2), (100, 0)):
            resolved = self.resolved(ceiling, lower_z_nm=0, upper_z_nm=105,
                                     directionality_percent=percent)
            actual = self.assert_oracle(ceiling, resolved)
            np.testing.assert_array_equal(actual[3, 3, 5:5+count], 0)
            np.testing.assert_array_equal(actual[3, 3, 5+count:10], self.si)

    def test_long_thin_domain_z_visits_are_bounded_before_distance_filtering(self):
        model = self.model((2, 1, 300), voxel=1)
        model.grid[0, 0, :] = self.si
        model.open_mask[1, 0] = True
        resolved = self.resolved(model, lower_z_nm=-.5, upper_z_nm=299.5,
                                 etch_distance_nm=.75)
        visits = 0

        def counted_max(*args, **kwargs):
            nonlocal visits
            if len(args) == 3:
                visits += 1  # Every scalar dz evaluation, before the radius test.
            return max(*args, **kwargs)

        with mock.patch.object(self.api, 'max', counted_max, create=True):
            actual = self.candidate(model, resolved)
        self.assertFalse(actual.any())
        # One vertical patch per source layer can reach at most three centers.
        self.assertLessEqual(visits, 3*300)

    def test_noninteger_sweep_z_endpoints_match_full_face_oracle(self):
        model = self.model((2, 1, 40), voxel=1)
        model.grid[0, 0, :] = self.si
        model.open_mask[1, 0] = True
        for distance, percent in ((.5000000000000001, 0), (.75, 17), (1.37, 50), (1.9, 73)):
            resolved = self.resolved(model, lower_z_nm=7.125, upper_z_nm=31.875,
                                     etch_distance_nm=distance, directionality_percent=percent)
            self.assert_oracle(model, resolved)
        floor = self.model((3, 3, 12), voxel=1)
        floor.grid.fill(self.cu)
        floor.grid[1, 1, :6] = self.si
        floor.grid[1, 1, 6:] = 0
        floor.open_mask[1, 1] = True
        # R=0 still uses the original squared-distance roundoff tolerance:
        # a center at 5 is at the lower endpoint of the 5.5 face swept by .5.
        for distance in (np.nextafter(.5, 0), .5, np.nextafter(.5, 1), 1.3):
            resolved = self.resolved(floor, lower_z_nm=2.125, upper_z_nm=6.875,
                                     etch_distance_nm=distance, directionality_percent=100)
            self.assert_oracle(floor, resolved)


class DepthWindowEtchTests(unittest.TestCase):
    def setUp(self):
        try:
            self.api = importlib.import_module('structure_cad.depth_window_etch')
        except ModuleNotFoundError:
            self.fail('Depth window parameter contract is not implemented')
        self.db = tcad.MaterialDatabase()
        self.model = tcad.ProcessModel(self.db, grid_shape=(3, 3, 10), voxel_size_nm=10, max_workers=1)
        self.addCleanup(self.model.parallel.shutdown)
        self.model.grid.fill(0)
        self.model.grid[0, 0, :6] = self.db.id_for('Silicon')
        self.model.grid[1, 0, :4] = self.db.id_for('Copper')
        self.model.grid[0, 1, :6] = self.db.id_for('Silicon')
        self.model.grid[1, 1, :4] = self.db.id_for('Copper')
        self.model.grid[2, 0, :5] = self.db.id_for('Silicon')
        self.model.grid[2, 2, :9] = self.db.id_for('Silicon')
        self.model.open_mask.fill(False)
        self.model.open_mask[:2, 0] = True

    def parse(self, **params):
        return self.api.parse_window_params({'etch_mode': 'Depth window', **params})

    def test_geometric_resolution_rejections_have_fixed_codes_and_parameter_paths(self):
        cases = [
            ('depth_window_no_effective_opening', 'params.etch_mode', 'closed', {}),
            ('depth_window_no_nonempty_rim', 'params.depth_reference', 'empty', {'start_depth_nm': 0, 'end_depth_nm': 10}),
            ('depth_window_band_outside_domain', 'params.depth_reference', None, {'depth_reference': 'Fixed Z', 'lower_z_nm': -6, 'upper_z_nm': 10}),
            ('depth_window_no_voxel_center', 'params.depth_reference', None, {'depth_reference': 'Fixed Z', 'lower_z_nm': 21, 'upper_z_nm': 29}),
            ('depth_window_budget_exceeded', 'params.etch_distance_nm', None, {'etch_distance_nm': 1e300}),
        ]
        for code, parameter, setup, params in cases:
            grid, opened = self.model.grid.copy(), self.model.open_mask.copy()
            try:
                if setup == 'closed':
                    self.model.open_mask.fill(False)
                if setup == 'empty':
                    self.model.grid.fill(0)
                with self.subTest(code=code), self.assertRaises(ValueError) as raised:
                    self.api.resolve_window(self.model, self.parse(**params))
                self.assertEqual(getattr(raised.exception, 'code', None), code)
                self.assertEqual(getattr(raised.exception, 'parameter', None), parameter)
            finally:
                self.model.grid[:] = grid
                self.model.open_mask[:] = opened

    def test_unknown_geometry_exceptions_are_not_classified_from_their_message(self):
        step = tcad.StructureEtchStep(self.db)
        with mock.patch('structure_cad.operations.construct', side_effect=ValueError('no effective deletion /private/secret-token')):
            rejected = tcad._run_model_transaction(self.model, lambda: step.execute(self.model))
        self.assertTrue(rejected['rolled_back'])
        self.assertEqual(rejected['error_type'], 'ValueError')
        self.assertNotIn('code', rejected)
        self.assertNotIn('parameter_path', rejected)

    def test_standard_default_ignores_inactive_window_drafts(self):
        parsed = self.api.parse_window_params({'start_depth_nm': True, 'depth_reference': 'draft', 'directionality_percent': float('nan')})
        self.assertEqual(parsed.etch_mode, 'Standard')
        with self.assertRaises(FrozenInstanceError):
            parsed.etch_mode = 'Depth window'
        self.assertIsNone(self.api.resolve_window(self.model, parsed))

    def test_window_defaults_and_directionality(self):
        parsed = self.parse()
        self.assertEqual((parsed.start_depth_nm, parsed.end_depth_nm, parsed.etch_distance_nm), (100, 200, 30))
        self.assertEqual(parsed.depth_reference, 'Opening plane')
        for value, expected in ((0, 0), (50, .5), (100, 1)):
            self.assertEqual(self.parse(directionality_percent=value).directionality, expected)

    def test_invalid_directionality_and_active_lengths(self):
        for value in (True, np.bool_(True), -1, 101, float('nan'), float('inf')):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'directionality_percent'):
                self.parse(directionality_percent=value)
        for key in ('start_depth_nm', 'end_depth_nm', 'etch_distance_nm'):
            for value in (True, np.bool_(False), float('nan'), float('inf')):
                with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, key):
                    self.parse(**{key: value})
        for params in ({'start_depth_nm': -1}, {'start_depth_nm': 200, 'end_depth_nm': 100}, {'start_depth_nm': 100, 'end_depth_nm': 100}, {'etch_distance_nm': 0}, {'etch_distance_nm': -1}):
            with self.subTest(params=params), self.assertRaises(ValueError):
                self.parse(**params)

    def test_fixed_z_signed_values_and_invalid_intervals(self):
        self.assertEqual(self.parse(depth_reference='Fixed Z', lower_z_nm=-5, upper_z_nm=5).lower_z_nm, -5)
        for params in ({'lower_z_nm': 10, 'upper_z_nm': 10}, {'lower_z_nm': 20, 'upper_z_nm': 10}, {'lower_z_nm': True}, {'upper_z_nm': float('nan')}, {'lower_z_nm': float('inf')}):
            with self.subTest(params=params), self.assertRaises(ValueError):
                self.parse(depth_reference='Fixed Z', **params)

    def test_inactive_fields_do_not_participate_in_validation(self):
        opening = dict(etch_mode='Depth window', start_depth_nm=10, end_depth_nm=30, lower_z_nm=True, upper_z_nm=float('nan'), depth_nm=True, sidewall_angle_deg='draft')
        fixed = dict(etch_mode='Depth window', depth_reference='Fixed Z', lower_z_nm=25, upper_z_nm=45, start_depth_nm=True, end_depth_nm=float('nan'), depth_nm='draft', sidewall_angle_deg=True)
        for params in (opening, fixed):
            with self.subTest(params=params):
                self.assertEqual(parameter_errors('Structure Etch', params, material_db=self.db), [])
                self.api.parse_window_params(params)
                step = tcad.StructureEtchStep(self.db)
                preflight_candidate(step, self.model, params)
                for key, value in params.items():
                    self.assertIs(step.params[key], value)
        self.assertEqual(parameter_errors('Structure Etch', {'start_depth_nm': True}, material_db=self.db), [])

    def test_unknown_keys_and_enum_values_rejected(self):
        for params in ({'mystery': 1}, {'etch_mode': 'Other'}, {'etch_mode': 'Depth window', 'depth_reference': 'Other'}):
            with self.subTest(params=params):
                self.assertTrue(parameter_errors('Structure Etch', params, material_db=self.db))
                with self.assertRaises(ValueError):
                    self.api.parse_window_params(params)

    def test_two_references_select_identical_voxel_centers(self):
        a = self.api.resolve_window(self.model, self.parse(start_depth_nm=10, end_depth_nm=30))
        b = self.api.resolve_window(self.model, self.parse(depth_reference='Fixed Z', lower_z_nm=25, upper_z_nm=45))
        self.assertEqual((a.lower_z_nm, a.upper_z_nm, a.reference_z_nm), (25, 45, 55))
        self.assertEqual(a.z_indices, (3, 4))
        self.assertEqual(a.z_indices, b.z_indices)
        self.assertIsNone(b.reference_z_nm)
        with self.assertRaises(FrozenInstanceError):
            a.lower_z_nm = 0

    def test_reference_is_one_frozen_plane_for_nonflat_opening(self):
        before = self.model.grid.copy()
        resolved = self.api.resolve_window(self.model, self.parse(start_depth_nm=0, end_depth_nm=20))
        self.assertEqual((resolved.reference_z_nm, resolved.z_indices), (55, (4, 5)))
        np.testing.assert_array_equal(self.model.grid, before)
        self.model.grid[0, 1, 5] = 0
        self.assertEqual(resolved.reference_z_nm, 55)
        self.assertEqual(self.api.resolve_window(self.model, self.parse(start_depth_nm=0, end_depth_nm=20)).reference_z_nm, 45)

    def test_domain_boundaries_and_half_open_band(self):
        resolved = self.api.resolve_window(self.model, self.parse(depth_reference='Fixed Z', lower_z_nm=-5, upper_z_nm=95))
        self.assertEqual(resolved.z_indices, tuple(range(10)))
        resolved = self.api.resolve_window(self.model, self.parse(depth_reference='Fixed Z', lower_z_nm=20, upper_z_nm=40))
        self.assertEqual(resolved.z_indices, (2, 3))
        for lower, upper in ((-5.01, 10), (10, 95.01), (21, 29)):
            with self.subTest(lower=lower, upper=upper), self.assertRaisesRegex(ValueError, 'domain|voxel center'):
                self.api.resolve_window(self.model, self.parse(depth_reference='Fixed Z', lower_z_nm=lower, upper_z_nm=upper))
        with self.assertRaisesRegex(ValueError, 'domain'):
            self.api.resolve_window(self.model, self.parse(start_depth_nm=0, end_depth_nm=100))

    def test_empty_opening_rejected_for_both_references(self):
        for reference in ('Opening plane', 'Fixed Z'):
            self.model.open_mask.fill(False)
            params = self.parse(depth_reference=reference, start_depth_nm=0, end_depth_nm=10, lower_z_nm=0, upper_z_nm=10)
            with self.assertRaisesRegex(ValueError, 'opening'):
                self.api.resolve_window(self.model, params)

    def test_empty_rim_rejected_with_fixed_z_guidance(self):
        self.model.grid.fill(0)
        self.model.grid[0, 0, :6] = self.db.id_for('Silicon')
        with self.assertRaisesRegex(ValueError, 'Fixed Z'):
            self.api.resolve_window(self.model, self.parse(start_depth_nm=0, end_depth_nm=10))
        resolved = self.api.resolve_window(self.model, self.parse(depth_reference='Fixed Z', lower_z_nm=0, upper_z_nm=10))
        self.assertEqual(resolved.z_indices, (0,))

    def test_opened_columns_may_be_entirely_empty_if_rim_exists(self):
        self.model.grid[self.model.open_mask] = 0
        resolved = self.api.resolve_window(self.model, self.parse(start_depth_nm=10, end_depth_nm=30))
        self.assertEqual((resolved.reference_z_nm, resolved.z_indices), (55, (3, 4)))

    def test_real_deep_hole_uses_rim_not_bottom_or_remote_high_column(self):
        model = tcad.ProcessModel(self.db, grid_shape=(7, 7, 50), voxel_size_nm=10, max_workers=1)
        self.addCleanup(model.parallel.shutdown)
        model.grid.fill(0)
        model.grid[:, :, :40] = self.db.id_for('Silicon')
        model.grid[3, 3, 10:] = 0
        model.grid[0, 0, :49] = self.db.id_for('Copper')
        model.open_mask.fill(False)
        model.open_mask[3, 3] = True
        before = model.grid.copy()
        resolved = self.api.resolve_window(model, self.parse())
        self.assertEqual((resolved.reference_z_nm, resolved.lower_z_nm, resolved.upper_z_nm), (395, 195, 295))
        self.assertEqual(resolved.z_indices, tuple(range(20, 30)))
        np.testing.assert_array_equal(model.grid, before)

    def test_rim_has_four_neighbors_excluding_diagonals_and_domain_wrap(self):
        self.model.grid.fill(0)
        self.model.open_mask.fill(False)
        self.model.open_mask[0, 0] = True
        self.model.grid[0, 1, :3] = self.db.id_for('Silicon')
        self.model.grid[1, 0, :4] = self.db.id_for('Silicon')
        # A diagonal and the opposite boundaries must not become rim columns.
        self.model.grid[1, 1, :9] = self.db.id_for('Copper')
        self.model.grid[2, 0, :9] = self.db.id_for('Copper')
        self.model.grid[0, 2, :9] = self.db.id_for('Copper')
        resolved = self.api.resolve_window(self.model, self.parse(start_depth_nm=0, end_depth_nm=10))
        self.assertEqual((resolved.reference_z_nm, resolved.z_indices), (35, (3,)))

    def test_multiple_openings_share_highest_rim_plane(self):
        model = tcad.ProcessModel(self.db, grid_shape=(7, 7, 10), voxel_size_nm=10, max_workers=1)
        self.addCleanup(model.parallel.shutdown)
        model.grid.fill(0)
        model.open_mask.fill(False)
        model.open_mask[1, 1] = model.open_mask[5, 5] = True
        model.grid[1, 2, :4] = self.db.id_for('Silicon')
        model.grid[5, 4, :7] = self.db.id_for('Copper')
        resolved = self.api.resolve_window(model, self.parse(start_depth_nm=0, end_depth_nm=20))
        self.assertEqual((resolved.reference_z_nm, resolved.z_indices), (65, (5, 6)))

    def test_fully_open_mask_uses_global_top_and_rejects_all_empty_domain(self):
        self.model.open_mask.fill(True)
        resolved = self.api.resolve_window(self.model, self.parse(start_depth_nm=0, end_depth_nm=20))
        self.assertEqual((resolved.reference_z_nm, resolved.z_indices), (85, (7, 8)))
        self.model.grid.fill(0)
        with self.assertRaisesRegex(ValueError, 'Fixed Z'):
            self.api.resolve_window(self.model, self.parse(start_depth_nm=0, end_depth_nm=20))

    def test_preflight_does_not_resolve_final_geometry_and_execute_rejects_empty_rim(self):
        step = tcad.StructureEtchStep(self.db)
        self.model.grid.fill(0)
        with mock.patch.object(self.api, 'resolve_window', side_effect=AssertionError('final geometry')):
            preflight_candidate(step, self.model, {'etch_mode': 'Depth window'})
        before = self.model.grid.copy()
        with self.assertRaisesRegex(ValueError, 'nonempty opening rim'):
            step.execute(self.model)
        np.testing.assert_array_equal(before, self.model.grid)
        step.params['etch_distance_nm'] = True
        with self.assertRaisesRegex(ValueError, 'etch_distance_nm'):
            step.execute(self.model)

    def test_factory_schema_and_serialized_conditional_metadata_share_contract(self):
        step = tcad.StructureEtchStep(self.db)
        specs = {s.key: s for s in step.parameter_specs()}
        schema = step_schema(self.db)['Structure Etch']
        self.assertEqual(set(schema), set(specs))
        self.assertEqual(step.params['etch_mode'], 'Standard')
        for key in ('depth_nm', 'sidewall_angle_deg'):
            self.assertEqual(specs[key].active_when, {'etch_mode': 'Standard'})
        expected = {'etch_mode': 'Depth window', 'depth_reference': 'Opening plane'}
        self.assertEqual(specs['start_depth_nm'].active_when, expected)
        self.assertEqual(schema['start_depth_nm']['active_when'], expected)
        self.assertEqual(tcad._webui_serialize_parameter_spec(specs['start_depth_nm'])['active_when'], expected)
        from process_api.schemas import ParameterSpecView
        self.assertEqual(ParameterSpecView(key='start_depth_nm', label='Start', type='float', active_when=expected).to_json()['activeWhen'], expected)

    def test_m4_real_view_and_edits_use_active_configuration_atomically(self):
        from process_api import ProcessCadFacade, ProcessCadError
        facade = ProcessCadFacade(grid=32)
        facade.load_recipe_blob({'steps': [{'name': 'Structure Etch', 'params': {}}]})
        self.addCleanup(facade._model.parallel.shutdown)
        expected = {'etch_mode': 'Depth window', 'depth_reference': 'Opening plane'}
        view = facade.recipe()[0].to_json()
        start = next(spec for spec in view['parameterSpecs'] if spec['key'] == 'start_depth_nm')
        self.assertEqual(start['activeWhen'], expected)
        # Selecting Standard must retain arbitrary inactive reference drafts.
        facade.set_step(0, {'depth_reference': 'draft', 'start_depth_nm': True})
        facade.set_step(0, {'etch_mode': 'Depth window', 'depth_reference': 'Fixed Z',
                            'lower_z_nm': 10, 'upper_z_nm': 30, 'end_depth_nm': 'draft',
                            'depth_nm': 'draft', 'sidewall_angle_deg': True})
        before = facade.recipe()[0].to_json()
        for params in ({'lower_z_nm': 40}, {'etch_distance_nm': True}, {'unknown_draft': 1}):
            with self.subTest(params=params), self.assertRaises(ProcessCadError):
                facade.set_step(0, params)
            self.assertEqual(facade.recipe()[0].to_json(), before)

    def test_material_booleans_rejected_by_shared_contract_and_m4_atomically(self):
        from process_api import ProcessCadFacade, ProcessCadError
        for mode in ('Standard', 'Depth window'):
            facade = ProcessCadFacade(grid=32)
            facade.load_recipe_blob({'steps': [{'name': 'Structure Etch', 'params': {'etch_mode': mode}}]})
            self.addCleanup(facade._model.parallel.shutdown)
            facade._statuses[0] = 'done'
            before = facade.recipe()[0].to_json()
            grid = facade._model.grid.copy()
            statuses = dict(facade._statuses)
            for value in (True, False, np.bool_(True), np.bool_(False)):
                params = {'etch_mode': mode, 'material': value}
                with self.subTest(mode=mode, value=value):
                    with self.assertRaisesRegex(ValueError, 'material'):
                        self.api.parse_window_params(params)
                    self.assertTrue(parameter_errors('Structure Etch', params, material_db=self.db))
                    with self.assertRaises(ProcessCadError):
                        facade.set_step(0, {'material': value}, enabled=False, group='must not publish')
                    self.assertEqual(facade.recipe()[0].to_json(), before)
                    self.assertEqual(facade._statuses, statuses)
                    np.testing.assert_array_equal(facade._model.grid, grid)
            mid = self.db.id_for('Silicon')
            self.assertEqual(parameter_errors('Structure Etch', {'etch_mode': mode, 'material': mid}, material_db=self.db), [])
            facade.set_step(0, {'material': mid})
            self.assertEqual(facade.recipe()[0].params['material'], mid)

    def test_huge_active_numbers_rejected_without_overflow_and_drafts_ignored(self):
        from process_api import ProcessCadFacade, ProcessCadError
        huge = 10**400
        cases = [('Opening plane', key) for key in ('start_depth_nm', 'end_depth_nm', 'etch_distance_nm', 'directionality_percent')]
        cases += [('Fixed Z', key) for key in ('lower_z_nm', 'upper_z_nm')]
        for reference, key in cases:
            params = {'etch_mode': 'Depth window', 'depth_reference': reference, key: huge}
            with self.subTest(reference=reference, key=key):
                with self.assertRaisesRegex(ValueError, key):
                    self.api.parse_window_params(params)
                self.assertTrue(parameter_errors('Structure Etch', params, material_db=self.db))
        facade = ProcessCadFacade(grid=32)
        facade.load_recipe_blob({'steps': [{'name': 'Structure Etch', 'params': {}}]})
        self.addCleanup(facade._model.parallel.shutdown)
        facade.set_step(0, {'start_depth_nm': huge})
        self.assertEqual(facade.recipe()[0].params['start_depth_nm'], huge)
        before = facade.recipe()[0].to_json()
        statuses = dict(facade._statuses)
        for params in ({'depth_nm': huge}, {'etch_mode': 'Depth window'}):
            with self.subTest(params=params), self.assertRaises(ProcessCadError):
                facade.set_step(0, params)
            self.assertEqual(facade.recipe()[0].to_json(), before)
            self.assertEqual(facade._statuses, statuses)
        for params in ({'start_depth_nm': huge}, {'etch_mode': 'Depth window', 'depth_reference': 'Fixed Z', 'start_depth_nm': huge, 'end_depth_nm': huge}):
            self.assertEqual(parameter_errors('Structure Etch', params, material_db=self.db), [])


class DepthWindowMetadataHTTPTests(unittest.TestCase):
    # Exercise the production HTTP route using the established isolated server fixture.
    from tests.test_structure_editor_http import StructureEditorHTTPTests as _Fixture
    setUp = _Fixture.setUp
    _request = _Fixture._request
    request = _Fixture.request

    def test_m2_material_booleans_rejected_atomically_in_both_modes(self):
        for mode in ('Standard', 'Depth window'):
            recipe = self.request('POST', '/api/recipe/add', {'name': 'Structure Etch', 'params': {'etch_mode': mode}})['result']
            before = self.request('GET', '/api/init')['result']['recipe']
            timeline = self.request('POST', '/api/timeline/get', {})['result']
            for value in (True, False):
                with self.subTest(mode=mode, value=value):
                    self.request('POST', '/api/step/set', {'index': len(recipe)-1, 'params': {'material': value}}, ok=False)
                    self.assertEqual(self.request('GET', '/api/init')['result']['recipe'], before)
                    self.assertEqual(self.request('POST', '/api/timeline/get', {})['result'], timeline)

    def test_m2_factory_and_configured_step_publish_conditions_and_preserve_drafts(self):
        init = self.request('GET', '/api/init')['result']
        template = next(step for step in init['factory_templates'] if step['name'] == 'Structure Etch')
        expected = {'etch_mode': 'Depth window', 'depth_reference': 'Opening plane'}
        start = next(spec for spec in template['parameter_specs'] if spec['key'] == 'start_depth_nm')
        self.assertEqual(start['active_when'], expected)
        params = {'etch_mode': 'Depth window', 'depth_reference': 'Fixed Z', 'lower_z_nm': 10,
                  'upper_z_nm': 20, 'start_depth_nm': True, 'depth_nm': 'draft'}
        recipe = self.request('POST', '/api/recipe/add', {'name': 'Structure Etch', 'params': params})['result']
        step = recipe[-1]
        for key, value in params.items():
            self.assertEqual(step['params'][key], value)
        lower = next(spec for spec in step['parameter_specs'] if spec['key'] == 'lower_z_nm')
        self.assertEqual(lower['active_when'], {'etch_mode': 'Depth window', 'depth_reference': 'Fixed Z'})


if __name__ == '__main__':
    unittest.main()
