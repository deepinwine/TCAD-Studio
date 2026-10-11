"""Structure Etch configuration and frozen, center-sampled height bands."""
import importlib
import unittest
from dataclasses import FrozenInstanceError
from unittest import mock

import numpy as np
import tcad_simulator as tcad
from recipe_planner.schema import parameter_errors, step_schema
from structure_cad.operations import preflight_candidate


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

    def test_preflight_does_not_resolve_final_geometry_and_execute_is_guarded(self):
        step = tcad.StructureEtchStep(self.db)
        self.model.grid.fill(0)
        with mock.patch.object(self.api, 'resolve_window', side_effect=AssertionError('final geometry')):
            preflight_candidate(step, self.model, {'etch_mode': 'Depth window'})
        before = self.model.grid.copy()
        with self.assertRaisesRegex(ValueError, 'not available until geometry implementation'):
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


class DepthWindowMetadataHTTPTests(unittest.TestCase):
    # Exercise the production HTTP route using the established isolated server fixture.
    from tests.test_structure_editor_http import StructureEditorHTTPTests as _Fixture
    setUp = _Fixture.setUp
    _request = _Fixture._request
    request = _Fixture.request

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
