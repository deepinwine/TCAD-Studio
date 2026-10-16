"""Depth window uses the existing HTTP recipe, execution and session protocol."""
import copy
import json
import pickle
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

import tcad_simulator as tcad
from structure_cad import depth_window_etch
from tests.test_depth_window_etch import face_oracle
from tests import test_structure_display_http as display_tests


class DepthWindowEtchHTTPTests(unittest.TestCase):
    setUp = display_tests.StructureDisplayHTTPTests.setUp
    _request = display_tests.StructureDisplayHTTPTests._request
    request = display_tests.StructureDisplayHTTPTests.request

    def worker(self):
        process = next(iter(self.manager.sessions.values())).process
        frame = sys._current_frames()[process._thread.ident]
        while frame:
            if frame.f_code.co_name == '_webui_worker_main':
                return frame.f_locals
            frame = frame.f_back
        self.fail('Isolated worker frame unavailable')

    def recipe(self):
        return self.request('GET', '/api/init')['result']['recipe']

    def window(self):
        return dict(etch_mode='Depth window', material='Silicon',
                    depth_reference='Opening plane', start_depth_nm=100,
                    end_depth_nm=200, etch_distance_nm=30,
                    directionality_percent=0)

    def hole_recipe(self, *, layered=False):
        mask = np.zeros((12, 12), dtype=bool)
        mask[5:8, 5:8] = True
        if layered:
            steps = [
                {'name': 'Structure Wafer', 'params': {'thickness_nm': 220}},
                {'name': 'Structure Deposit', 'params': {'material': 'Silicon Dioxide', 'thickness_nm': 20}},
                {'name': 'Structure Deposit', 'params': {'material': 'Silicon', 'thickness_nm': 160}},
            ]
        else:
            steps = [{'name': 'Structure Wafer', 'params': {'thickness_nm': 400}}]
        steps.append({'name': 'Structure Pattern', 'custom_mask': mask.tolist(),
                      'params': {'mask_mode': 'Custom'}})
        depths = [('Silicon', 160), ('Silicon Dioxide', 20), ('Silicon', 120)] if layered else [('Silicon', 300)]
        steps.extend({'name': 'Structure Etch', 'params': {'material': material, 'depth_nm': depth}}
                     for material, depth in depths)
        return {'name': '300 nm 孔区间刻蚀',
                'domain': {'grid_shape': [12, 12, 48], 'voxel_size_nm': 10, 'threads': 1},
                'steps_full': steps}

    def build_hole(self, *, layered=False):
        self.request('POST', '/api/recipe/import', {'recipe': self.hole_recipe(layered=layered)})
        self.request('POST', '/api/run/all', {})
        return self.worker()['model']

    def add_window(self, params=None):
        steps = self.request('POST', '/api/recipe/add', {
            'name': 'Structure Etch', 'params': params or self.window(),
            'instance_name': '孔中段区间',
        })['result']
        return len(steps) - 1

    def test_execution_reference_result_is_real_optional_and_never_stale(self):
        self.build_hole()
        index = self.add_window()
        self.assertNotIn('execution_result', self.recipe()[index])

        with patch.object(depth_window_etch, 'resolve_window', wraps=depth_window_etch.resolve_window) as resolve:
            run = self.request('POST', '/api/run/step', {'index': index})['result']
        self.assertEqual(resolve.call_count, 1)
        self.assertEqual(run.get('recipe', [{}] * (index + 1))[index].get('execution_result'), {'reference_z_nm': 395.0})
        self.assertEqual(self.recipe()[index]['execution_result'], {'reference_z_nm': 395.0})
        status, _, raw = self._request(self.manager.url, self.cookie, 'GET', '/api/recipe/export?scope=current', None)
        self.assertEqual(status, 200)
        exported = json.loads(raw)
        self.assertNotIn('execution_result', exported['steps_full'][index])
        self.request('POST', '/api/recipe/import', {'recipe': exported})
        self.assertNotIn('execution_result', self.recipe()[index])
        result = self.request('POST', '/api/run/to', {'index': index})['result']
        self.assertEqual(result['recipe'][index]['execution_result'], {'reference_z_nm': 395.0})
        self.request('POST', '/api/run/to', {'index': index})
        # A cache checkpoint may retain an exact in-memory result or discard it,
        # but must never invent a different reference from the final model.
        self.assertIn(self.recipe()[index].get('execution_result'), (None, {'reference_z_nm': 395.0}))
        copied = self.request('POST', '/api/recipe/duplicate', {'index': index})['result']
        self.assertNotIn('execution_result', copied[index + 1])
        self.request('POST', '/api/recipe/remove', {'index': index + 1})
        self.request('POST', '/api/step/set', {'index': 0, 'params': {'thickness_nm': 390}})
        self.assertNotIn('execution_result', self.recipe()[index])
        self.request('POST', '/api/undo', {})
        self.assertNotIn('execution_result', self.recipe()[index])
        self.request('POST', '/api/redo', {})
        self.assertNotIn('execution_result', self.recipe()[index])

    def test_run_all_and_to_deliver_reference_in_authoritative_recipe(self):
        for path in ('/api/run/all', '/api/run/to'):
            with self.subTest(path=path):
                recipe = self.hole_recipe()
                recipe['steps_full'].append({'name': 'Structure Etch', 'params': self.window()})
                self.request('POST', '/api/recipe/import', {'recipe': recipe})
                index = len(recipe['steps_full']) - 1
                result = self.request('POST', path, {'index': index})['result']
                self.assertEqual(result.get('recipe', [{}] * (index + 1))[index].get('execution_result'), {'reference_z_nm': 395.0})
                cached = self.request('POST', path, {'index': index})['result']
                self.assertIn('recipe', cached)
                self.assertNotIn('execution_result', cached['recipe'][index])

    def test_reference_result_clears_for_timeline_failure_fixed_z_and_reload(self):
        self.build_hole()
        index = self.add_window()
        self.request('POST', '/api/run/step', {'index': index})
        self.assertEqual(self.recipe()[index].get('execution_result'), {'reference_z_nm': 395.0})
        self.request('POST', '/api/timeline/restore', {'index': index})
        self.assertNotIn('execution_result', self.recipe()[index])
        self.request('POST', '/api/step/set', {'index': index, 'params': {'directionality_percent': 100}})
        failure = self.request('POST', '/api/run/step', {'index': index}, ok=False)
        self.assertFalse(failure['ok'])
        self.assertNotIn('execution_result', self.recipe()[index])
        self.request('POST', '/api/step/set', {'index': index, 'params': {'directionality_percent': 0, 'depth_reference': 'Fixed Z', 'lower_z_nm': 195, 'upper_z_nm': 295}})
        self.request('POST', '/api/run/step', {'index': index})
        self.assertNotIn('execution_result', self.recipe()[index])
        status, _, raw = self._request(self.manager.url, self.cookie, 'GET', '/api/recipe/export?scope=current', None)
        self.assertEqual(status, 200)
        saved = json.loads(raw)
        self.request('POST', '/api/recipe/import', {'recipe': saved})
        self.assertNotIn('execution_result', self.recipe()[index])

    def expected(self, grid, opened, percent=0):
        # Expected band and reference are fixed by this fixture, not resolved by
        # the implementation under test: top of z=39 is 395 nm, not the floor.
        model = SimpleNamespace(grid=grid, open_mask=opened, voxel_size_nm=10)
        resolved = SimpleNamespace(lower_z_nm=195, upper_z_nm=295,
                                   z_indices=tuple(range(20, 30)),
                                   target_id=tcad.MaterialDatabase().id_for('Silicon'),
                                   etch_distance_nm=30, directionality=percent / 100)
        result, faces = face_oracle(model, resolved)
        self.assertTrue(faces)
        self.assertTrue(np.any(result != grid))
        return result

    def assert_geometry(self, before, owners, opened, expected):
        model = self.worker()['model']
        actual = model.grid
        deleted = expected != before
        np.testing.assert_array_equal(actual, expected)
        np.testing.assert_array_equal(actual[:, :, :20], before[:, :, :20])
        np.testing.assert_array_equal(actual[:, :, 30:], before[:, :, 30:])
        si = model.material_db.id_for('Silicon')
        np.testing.assert_array_equal(actual[before != si], before[before != si])
        self.assertFalse(model.display_provenance.owners[deleted].any())
        np.testing.assert_array_equal(model.display_provenance.owners[~deleted], owners[~deleted])
        np.testing.assert_array_equal(model.open_mask, opened)
        self.assertEqual(model.current_time_s, 0)

    def state(self):
        init = self.request('GET', '/api/init')['result']
        worker = self.worker()
        model = worker['model']
        return {
            'init': {key: init[key] for key in ('recipe', 'model', 'current_recipe', 'ui_state', 'log')},
            'grid': model.grid.copy(), 'owners': model.display_provenance.owners.copy(),
            'source_ids': dict(model.display_provenance.step_ids),
            'mask': model.open_mask.copy(), 'height': model.height_map.copy(),
            'revision': worker['model_revision'],
            'timeline': self.request('POST', '/api/timeline/get', {})['result'],
            'snapshots': pickle.dumps(tuple(worker[key] for key in (
                'undo_stack', 'redo_stack', 'step_cache_step_states',
                'step_cache_step_sigs', 'step_cache_step_sources'))),
            'binding': (dict(self.manager._client_session_map),
                        tuple((session.session_id, session.secret) for session in self.manager.sessions.values())),
        }

    def assert_state(self, before, *, execution_failure=False, index=None):
        after = self.state()
        for key in ('grid', 'owners', 'mask', 'height'):
            np.testing.assert_array_equal(after.pop(key), before[key], err_msg=key)
        expected = copy.deepcopy({key: value for key, value in before.items()
                                  if key not in ('grid', 'owners', 'mask', 'height')})
        if execution_failure:
            old_recipe = expected['init'].pop('recipe')
            new_recipe = after['init'].pop('recipe')
            self.assertEqual(len(new_recipe), len(old_recipe))
            self.assertIn(index, range(len(new_recipe)))
            for i, (old, new) in enumerate(zip(old_recipe, new_recipe)):
                if i == index:
                    self.assertEqual(new['runtime_status'], 'error')
                    self.assertNotEqual(new['runtime_status'], 'done')
                    for key in ('runtime_status', 'runtime_error'):
                        old.pop(key, None)
                        new.pop(key, None)
                self.assertEqual(old, new)
            expected['init'].pop('log')
            after['init'].pop('log')
            for timeline in (expected['timeline'], after['timeline']):
                for item in timeline['items']:
                    if item['index'] == index:
                        item.pop('state')
                        item.pop('runtime_status')
        self.assertEqual(after, expected)

    def test_add_set_and_both_references_execute_real_geometry_for_zero_and_half_directionality(self):
        for percent in (0, 50):
            results = []
            for reference in ('Opening plane', 'Fixed Z'):
                with self.subTest(percent=percent, reference=reference):
                    model = self.build_hole()
                    before = model.grid.copy()
                    opened = model.open_mask.copy()
                    owners = model.display_provenance.owners.copy()
                    index = self.add_window()
                    self.request('POST', '/api/step/set', {'index': index, 'params': {
                        'depth_reference': reference, 'lower_z_nm': 195, 'upper_z_nm': 295,
                        'directionality_percent': percent,
                    }})
                    self.request('POST', '/api/run/step', {'index': index})
                    expected = self.expected(before, opened, percent)
                    self.assert_geometry(before, owners, opened, expected)
                    results.append(self.worker()['model'].grid.copy())
            np.testing.assert_array_equal(*results)

    def test_other_material_and_distinct_target_owners_are_preserved(self):
        model = self.build_hole(layered=True)
        before, opened = model.grid.copy(), model.open_mask.copy()
        owners = model.display_provenance.owners.copy()
        source_ids = dict(model.display_provenance.step_ids)
        self.assertEqual(len(np.unique(owners[before != 0])), 3)
        oxide = model.material_db.id_for('Silicon Dioxide')
        self.assertTrue((before[:, :, 20:30] == oxide).any())
        index = self.add_window()
        self.request('POST', '/api/run/step', {'index': index})
        self.assert_geometry(before, owners, opened, self.expected(before, opened))
        self.assertEqual(self.worker()['model'].display_provenance.step_ids, source_ids)

    def test_import_and_edit_do_not_resolve_final_or_future_geometry(self):
        recipe = self.hole_recipe()
        index = len(recipe['steps_full'])
        recipe['steps_full'] += [
            {'name': 'Structure Etch', 'params': self.window()},
            {'name': 'Structure Fill', 'params': {'material': 'Copper', 'height_nm': 450}},
            {'name': 'Structure Planarize', 'params': {'height_nm': 400}},
        ]
        with patch.object(depth_window_etch, 'resolve_window', side_effect=AssertionError('Geometry during preflight')), \
             patch.object(tcad.StructureEtchStep, 'execute', side_effect=AssertionError('Execute during preflight')):
            self.request('POST', '/api/recipe/import', {'recipe': recipe})
            self.request('POST', '/api/step/set', {'index': index, 'params': {'end_depth_nm': 200}})
            # Current initialized geometry is irrelevant to the future step input.
            self.assertTrue((self.worker()['model'].grid[5:8, 5:8, :20] != 0).all())
        observed = {}
        execute = tcad.StructureEtchStep.execute

        def observe(step, model):
            if step.params.get('etch_mode') == 'Depth window':
                observed['before'] = model.grid.copy()
                observed['mask'] = model.open_mask.copy()
                result = execute(step, model)
                observed['after'] = model.grid.copy()
                return result
            return execute(step, model)

        with patch.object(tcad.StructureEtchStep, 'execute', new=observe):
            self.request('POST', '/api/run/all', {})
        si = tcad.MaterialDatabase().id_for('Silicon')
        ideal = np.zeros((12, 12, 48), dtype=np.uint16)
        ideal[:, :, :40] = si
        ideal[5:8, 5:8, 10:] = 0
        np.testing.assert_array_equal(observed['before'], ideal)
        np.testing.assert_array_equal(observed['after'], self.expected(ideal, observed['mask']))
        # Filled/CMP final geometry no longer contains the channel used above.
        self.assertTrue((self.worker()['model'].grid[:, :, :40] != 0).all())
        with patch.object(depth_window_etch, 'resolve_window', side_effect=AssertionError('Final geometry during edit')):
            self.request('POST', '/api/step/set', {'index': index, 'params': {'end_depth_nm': 200}})

    def test_inactive_drafts_roundtrip_named_autosave_and_restart(self):
        self.build_hole()
        params = self.window()
        params.update(depth_reference='Fixed Z', lower_z_nm=195, upper_z_nm=295,
                      start_depth_nm=True, end_depth_nm='draft', depth_nm='draft', sidewall_angle_deg=False)
        index = self.add_window(params)
        self.request('POST', '/api/run/step', {'index': index})
        before_grid = self.worker()['model'].grid.copy()
        before_owners = self.worker()['model'].display_provenance.owners.copy()
        source_ids = dict(self.worker()['model'].display_provenance.step_ids)
        canonical = copy.deepcopy(self.recipe())
        canonical_params = [step['params'] for step in canonical]
        canonical_types = [{key: type(value) for key, value in params.items()}
                           for params in canonical_params]
        step_ids = [step['step_id'] for step in canonical]

        def assert_restored(stage, binding):
            current = self.request('GET', '/api/init')['result']
            actual_params = [step['params'] for step in current['recipe']]
            self.assertEqual([step['step_id'] for step in current['recipe']], step_ids, stage)
            self.assertEqual(actual_params, canonical_params, stage)
            self.assertEqual([{key: type(value) for key, value in params.items()}
                              for params in actual_params], canonical_types, stage)
            model = self.worker()['model']
            np.testing.assert_array_equal(model.grid, before_grid, err_msg=stage)
            np.testing.assert_array_equal(model.display_provenance.owners, before_owners, err_msg=stage)
            self.assertEqual(model.display_provenance.step_ids, source_ids, stage)
            self.assertEqual(current['current_recipe'], binding, stage)

        status, _, raw = self._request(self.manager.url, self.cookie, 'GET', '/api/recipe/export?scope=current', None)
        self.assertEqual(status, 200)
        exported = json.loads(raw)
        identity = self.recipe()[index]['step_id']
        imported = self.request('POST', '/api/recipe/import', {'recipe': exported})['result']
        self.assertEqual(self.recipe()[index]['step_id'], identity)
        self.request('POST', '/api/run/all', {})
        assert_restored('import run', imported['current_recipe'])
        saved = self.request('POST', '/api/recipe/save', {'name': '区间草稿保存'})['result']
        named_binding = {'name': '区间草稿保存', 'id': saved['id']}
        self.request('POST', '/api/save', {})
        session = next(iter(self.manager.sessions.values()))
        session_id, secret = session.session_id, session.secret
        autosave = tcad._webui_pickle_load(session.storage_dir / 'autosave.pkl.gz')
        self.request('POST', '/api/recipe/new', {'name': '临时切换'})
        self.request('POST', '/api/recipe/load', {'id': saved['id']})
        assert_restored('named load', named_binding)
        self.assertEqual(self.recipe()[index]['step_id'], identity)
        self.assertEqual(self.request('GET', '/api/init')['result']['current_recipe'],
                         {'name': '区间草稿保存', 'id': saved['id']})
        self.request('POST', '/api/step/set', {'index': index, 'params': {'etch_distance_nm': 20}})
        tcad._webui_pickle_dump(session.storage_dir / 'autosave.pkl.gz', autosave)
        self.request('POST', '/api/load_autosave', {})
        assert_restored('autosave load', named_binding)
        self.assertEqual(self.recipe()[index]['params']['etch_distance_nm'], 30)
        self.manager.stop()
        self.manager = tcad.WebUIServerManager(
            host='127.0.0.1', port=0, max_users=1, storage_root=Path(self.directory.name),
            enable_ai_agent=False, default_domain={'grid_shape': [12, 12, 32], 'voxel_size_nm': 5, 'threads': 1})
        self.manager._force_inprocess_worker = True
        self.manager.start()
        self.addCleanup(self.manager.stop)
        _, self.cookie = self.manager.create_session(session_id=session_id, secret=secret)
        assert_restored('restart', named_binding)
        restored = self.recipe()[index]
        self.assertEqual(restored['step_id'], identity)
        for key, value in params.items():
            if key != 'material':
                self.assertEqual(restored['params'][key], value, key)
        np.testing.assert_array_equal(self.worker()['model'].grid, before_grid)
        np.testing.assert_array_equal(self.worker()['model'].display_provenance.owners, before_owners)
        self.assertEqual(self.worker()['model'].display_provenance.step_ids, source_ids)
        self.assertEqual(self.request('GET', '/api/init')['result']['current_recipe'],
                         {'name': '区间草稿保存', 'id': saved['id']})

    def test_standard_mode_ignores_and_roundtrips_inactive_window_drafts(self):
        self.build_hole()
        before = self.worker()['model'].grid.copy()
        drafts = {'depth_reference': 'draft', 'start_depth_nm': True,
                  'end_depth_nm': 'draft', 'lower_z_nm': False, 'upper_z_nm': 'draft',
                  'etch_distance_nm': -1, 'directionality_percent': 101}
        steps = self.request('POST', '/api/recipe/add', {
            'name': 'Structure Etch', 'params': {'material': 'Silicon', 'depth_nm': 10, **drafts},
        })['result']
        index = len(steps) - 1
        self.request('POST', '/api/run/step', {'index': index})
        expected = before.copy()
        expected[5:8, 5:8, 9] = 0
        np.testing.assert_array_equal(self.worker()['model'].grid, expected)
        status, _, raw = self._request(self.manager.url, self.cookie, 'GET', '/api/recipe/export?scope=current', None)
        self.assertEqual(status, 200)
        self.request('POST', '/api/recipe/import', {'recipe': json.loads(raw)})
        for key, value in drafts.items():
            self.assertEqual(self.recipe()[index]['params'][key], value, key)

    def test_old_standard_and_physical_etch_without_window_fields_still_execute(self):
        self.build_hole()
        expected = np.zeros((12, 12, 48), dtype=np.uint16)
        expected[:, :, :40] = tcad.MaterialDatabase().id_for('Silicon')
        expected[5:8, 5:8, 10:] = 0
        np.testing.assert_array_equal(self.worker()['model'].grid, expected)
        # A legacy physical Etch remains its own existing factory/executor.
        index = len(self.request('POST', '/api/recipe/add', {
            'name': 'Etch', 'params': {'material': 'Silicon', 'time': 1},
        })['result']) - 1
        self.request('POST', '/api/run/step', {'index': index})
        self.assertNotIn('etch_mode', self.recipe()[index]['params'])
        self.assertEqual(self.worker()['steps'][index].last_metrics['time_s'], 1)
        self.assertEqual(self.worker()['steps'][index].last_metrics['duration_mode'], 'time')

    def test_every_factory_type_replacement_retains_identity_and_duplicate_gets_new_identity(self):
        self.build_hole()
        index = self.add_window()
        identity = self.recipe()[index]['step_id']
        for name in self.request('GET', '/api/init')['result']['recipe_factories']:
            with self.subTest(name=name):
                changed = self.request('POST', '/api/step/set', {'index': index, 'name': name})['result']
                self.assertEqual(changed['step_id'], identity)
        self.request('POST', '/api/step/set', {'index': index, 'name': 'Structure Etch', 'params': self.window()})
        steps = self.request('POST', '/api/recipe/duplicate', {'index': index})['result']
        self.assertEqual(steps[index]['step_id'], identity)
        self.assertNotEqual(steps[index + 1]['step_id'], identity)
        self.assertEqual(steps[index]['params'], steps[index + 1]['params'])

    def test_invalid_add_edit_and_import_are_wholly_atomic_and_preserve_saved_files(self):
        self.build_hole()
        index = self.add_window()
        self.request('POST', '/api/recipe/save', {'name': '有效区间配置'})
        self.request('POST', '/api/save', {})
        session = next(iter(self.manager.sessions.values()))
        files = {path: path.read_bytes() for path in session.storage_dir.rglob('*') if path.is_file()}
        invalid = ({'etch_mode': 'Unknown'}, {'start_depth_nm': 200, 'end_depth_nm': 100},
                   {'depth_reference': 'Unknown'}, {'depth_reference': 'Fixed Z', 'lower_z_nm': 200, 'upper_z_nm': 100},
                   {'directionality_percent': 101}, {'etch_distance_nm': 0})
        for params in invalid:
            for endpoint in ('/api/recipe/add', '/api/step/set', '/api/recipe/import'):
                with self.subTest(endpoint=endpoint, params=params):
                    before = self.state()
                    merged = {**self.window(), **params}
                    payload = ({'name': 'Structure Etch', 'params': merged} if endpoint.endswith('add') else
                               {'index': index, 'enabled': False, 'group': '必须回滚', 'params': params})
                    if endpoint.endswith('import'):
                        recipe = self.hole_recipe()
                        recipe['steps_full'].append({'name': 'Structure Etch', 'params': merged})
                        payload = {'recipe': recipe, 'current_name': '不能发布'}
                    self.request('POST', endpoint, payload, ok=False)
                    self.assert_state(before)
                    self.assertEqual(files, {path: path.read_bytes() for path in session.storage_dir.rglob('*') if path.is_file()})

    def test_no_channel_directional_no_deletion_and_budgets_abort_the_real_worker_transaction(self):
        for failure in ('no channel', 'directional wall', 'memory', 'visits'):
            with self.subTest(failure=failure):
                self.build_hole()
                if failure == 'no channel':
                    # Restore solid geometry using the existing timeline endpoint.
                    self.request('POST', '/api/timeline/restore', {'index': 1})
                index = self.add_window()
                if failure == 'directional wall':
                    self.request('POST', '/api/step/set', {'index': index, 'params': {'directionality_percent': 100}})
                saved = self.request('POST', '/api/recipe/save', {'name': '执行前有效保存'})['result']
                self.request('POST', '/api/save', {})
                session = next(iter(self.manager.sessions.values()))
                entry = next(entry for entry in saved['recipes'] if entry['id'] == saved['id'])
                saved_path = session.storage_dir / 'history' / entry['file']
                saved_bytes = saved_path.read_bytes()
                before = self.state()
                limit = ('MAX_WORK_BYTES' if failure == 'memory' else 'MAX_WORK_VISITS')
                with patch.object(depth_window_etch, limit, 1 if failure in ('memory', 'visits') else getattr(depth_window_etch, limit)):
                    rejected = self.request('POST', '/api/run/step', {'index': index}, ok=False)
                self.assertTrue(rejected['rolled_back'], rejected)
                self.assertEqual(rejected['step_index'], index)
                self.assertRegex(rejected['error'], 'surface|deletion|memory budget|work budget')
                self.assert_state(before, execution_failure=True, index=index)
                self.assertEqual(saved_path.read_bytes(), saved_bytes)


if __name__ == '__main__':
    unittest.main()
