"""Saved recipe compatibility HTTP restores actual geometry and immutable mask identity."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import tcad_simulator as tcad
from tests import test_structure_editor_http as editor_tests


class SavedRecipesHTTPTests(unittest.TestCase):
    _request = editor_tests.StructureEditorHTTPTests._request
    request = editor_tests.StructureEditorHTTPTests.request

    def setUp(self):
        with patch.object(tcad, '_tcad_can_spawn_webui_worker', return_value=False), \
             patch.object(tcad, '_tcad_can_fork_webui_worker', return_value=False):
            editor_tests.StructureEditorHTTPTests.setUp(self)

    def worker(self):
        process = next(iter(self.manager.sessions.values())).process
        frame = sys._current_frames()[process._thread.ident]
        while frame:
            if frame.f_code.co_name == '_webui_worker_main':
                return frame.f_locals
            frame = frame.f_back
        self.fail('Isolated worker unavailable')

    def snapshot(self):
        worker = self.worker()
        model = worker['model']
        return {
            'grid': model.grid.copy(),
            'owners': model.display_provenance.owners.copy(),
            'step_ids': dict(model.display_provenance.step_ids),
            'open_mask': None if model.open_mask is None else model.open_mask.copy(),
            'domain': (tuple(model.grid.shape), float(model.voxel_size_nm)),
            'recipe': self.request('GET', '/api/init')['result']['recipe'],
        }

    def assert_snapshot(self, expected, actual):
        np.testing.assert_array_equal(expected['grid'], actual['grid'])
        np.testing.assert_array_equal(expected['owners'], actual['owners'])
        if expected['open_mask'] is None:
            self.assertIsNone(actual['open_mask'])
        else:
            np.testing.assert_array_equal(expected['open_mask'], actual['open_mask'])
        self.assertEqual(expected['step_ids'], actual['step_ids'])
        self.assertEqual(expected['domain'], actual['domain'])
        def material_params(step):
            # Deserialization may add the empty legacy mask_file default.
            return {key: value for key, value in step['params'].items()
                    if not (key == 'mask_file' and value == '')}
        self.assertEqual([(step['step_id'], step['name'], material_params(step)) for step in expected['recipe']],
                         [(step['step_id'], step['name'], material_params(step)) for step in actual['recipe']])

    def test_named_save_switch_autosave_and_load_restore_geometry_without_execute(self):
        self.request('POST', '/api/recipe/import', {'recipe': {'name': 'Same', 'steps_full': [
            {'name': 'Structure Wafer', 'params': {'material': 'Silicon', 'thickness_nm': 40}},
            {'name': 'Structure Deposit', 'params': {'material': 'Silicon Dioxide', 'thickness_nm': 10}},
            {'name': 'Structure Pattern', 'params': {'mask_mode': 'Procedural', 'pattern': 'Open'}},
        ]}})
        asset = {
            'version': 1, 'id': 'saved-mask', 'name': 'Saved mask', 'coordinate_unit': 'nm',
            'bounds_nm': [0, 0, 60, 60],
            'layers': [{'id': '1/0', 'layer': 1, 'datatype': 0, 'name': 'Opening', 'visible': True}],
            'shapes': [{'id': 'left', 'type': 'rectangle', 'layer_id': '1/0', 'x_nm': 0,
                        'y_nm': 0, 'width_nm': 30, 'height_nm': 60, 'rotation_deg': 0}],
            'source': {'kind': 'editor'},
        }
        published = self.request('POST', '/api/mask/asset/save', {'asset': asset, 'step_index': 2})['result']['asset']
        self.assertEqual(published['revision'], 1)
        self.request('POST', '/api/run/all', {})
        initial_a = self.snapshot()
        self.assertGreater(np.count_nonzero(initial_a['grid']), 0)
        oxide_id = tcad.MaterialDatabase().id_for('Silicon Dioxide')
        copper_id = tcad.MaterialDatabase().id_for('Copper')
        self.assertGreater(np.count_nonzero(initial_a['grid'] == oxide_id), 0)
        saved_a = self.request('POST', '/api/recipe/save', {'name': 'Same'})['result']
        id_a = saved_a['id']
        self.assertTrue(saved_a['saved'])
        self.assertEqual(saved_a['current_recipe'], {'id': id_a, 'name': 'Same'})
        self.assertFalse(next(row for row in self.request('GET', '/api/history')['result'] if row['id'] == id_a)['autosave'])

        self.request('POST', '/api/step/set', {'index': 1, 'params': {'thickness_nm': 15}})
        self.request('POST', '/api/run/all', {})
        latest_a = self.snapshot()
        self.assertFalse(np.array_equal(initial_a['grid'], latest_a['grid']))
        self.request('POST', '/api/recipe/import', {'recipe': {'name': 'Same', 'steps_full': [
            {'name': 'Structure Wafer', 'params': {'material': 'Silicon', 'thickness_nm': 20}},
            {'name': 'Structure Deposit', 'params': {'material': 'Copper', 'thickness_nm': 15}},
        ]}})
        self.request('POST', '/api/run/all', {})
        saved_b = self.request('POST', '/api/recipe/save', {'name': 'Same'})['result']
        id_b = saved_b['id']
        self.assertNotEqual(id_a, id_b)
        before_invalid = self.snapshot()
        self.assertGreater(np.count_nonzero(before_invalid['grid'] == copper_id), 0)
        self.assertEqual(np.count_nonzero(before_invalid['grid'] == oxide_id), 0)
        history = self.request('GET', '/api/history')['result']
        self.assertEqual({row['id'] for row in history if row['name'] == 'Same'}, {id_a, id_b})
        self.assertTrue(next(row for row in history if row['id'] == id_a)['autosave'])
        self.request('POST', '/api/recipe/load', {'id': 'missing-id'}, ok=False)
        self.assert_snapshot(before_invalid, self.snapshot())

        with patch.object(tcad.StructureWaferStep, 'execute', side_effect=AssertionError('load executed wafer')), \
             patch.object(tcad.StructureDepositStep, 'execute', side_effect=AssertionError('load executed deposit')), \
             patch.object(tcad.StructurePatternStep, 'execute', side_effect=AssertionError('load executed pattern')):
            loaded = self.request('POST', '/api/recipe/load', {'id': id_a})['result']
        self.assertTrue(loaded['loaded'])
        self.assertEqual(loaded['current_recipe'], {'id': id_a, 'name': 'Same'})
        self.assert_snapshot(latest_a, self.snapshot())
        self.assertEqual(loaded['recipe'][2]['params']['mask_asset_id'], 'saved-mask')
        self.assertEqual(loaded['recipe'][2]['params']['mask_asset_revision'], 1)
        revision = self.request('GET', '/api/mask/asset?id=saved-mask&revision=1')['result']
        self.assertEqual(revision['revision'], 1)
        self.assertTrue(all(step['runtime_status'] == 'ready' for step in loaded['recipe']))
        timeline = self.request('POST', '/api/timeline/get', {})['result']
        self.assertFalse(any(item['snapshot_valid'] for item in timeline['items']))
        self.assertEqual(self.worker()['step_cache_step_states'], {})
        self.assertEqual(self.worker()['undo_stack'], [])
        self.assertEqual(self.worker()['redo_stack'], [])

    def test_saved_recipe_survives_server_restart_and_remains_ready_without_snapshots(self):
        self.request('POST', '/api/recipe/import', {'recipe': {'name': 'Persistent', 'steps_full': [
            {'name': 'Structure Wafer', 'params': {'material': 'Silicon', 'thickness_nm': 35}},
            {'name': 'Structure Deposit', 'params': {'material': 'Copper', 'thickness_nm': 10}},
        ]}})
        self.request('POST', '/api/run/all', {})
        entry_id = self.request('POST', '/api/recipe/save', {'name': 'Persistent'})['result']['id']
        expected = self.snapshot()
        session = next(iter(self.manager.sessions.values()))
        session_id, secret = session.session_id, session.secret
        self.manager.stop()
        self.manager = tcad.WebUIServerManager(
            host='127.0.0.1', port=0, max_users=1, storage_root=Path(self.directory.name),
            enable_ai_agent=False,
            default_domain={'grid_shape': [12, 12, 32], 'voxel_size_nm': 5, 'threads': 1},
        )
        self.manager.start()
        self.addCleanup(self.manager.stop)
        with patch.object(tcad, '_tcad_can_spawn_webui_worker', return_value=False), \
             patch.object(tcad, '_tcad_can_fork_webui_worker', return_value=False):
            resumed, self.cookie = self.manager.create_session(session_id=session_id, secret=secret)
        self.assertIsNotNone(resumed)
        self.assertIn(entry_id, {row['id'] for row in self.request('GET', '/api/history')['result']})
        loaded = self.request('POST', '/api/recipe/load', {'id': entry_id})['result']
        self.assertEqual(loaded['current_recipe']['id'], entry_id)
        self.assert_snapshot(expected, self.snapshot())
        self.assertTrue(all(step['runtime_status'] == 'ready' for step in loaded['recipe']))
        self.assertFalse(any(item['snapshot_valid'] for item in self.request('POST', '/api/timeline/get', {})['result']['items']))
