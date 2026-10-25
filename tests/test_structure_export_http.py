"""Current-model export reuses the compatibility endpoints without executing steps."""
import csv
import io
import json
import pickle
import sys
import unittest
import zipfile
from unittest.mock import patch

import numpy as np
import tcad_simulator as tcad
from tests import test_structure_editor_http as editor_tests


class StructureExportHTTPTests(unittest.TestCase):
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

    def build(self):
        self.request('POST', '/api/recipe/import', {'recipe': {'steps_full': [
            {'name': 'Structure Wafer', 'params': {'material': 'Silicon', 'thickness_nm': 40}},
            {'name': 'Structure Deposit', 'params': {'material': 'Silicon Dioxide', 'thickness_nm': 10}},
        ]}})
        self.request('POST', '/api/run/all', {})
        self.request('POST', '/api/ui_state', {'ui_state': {'agent': {'conversation': [
            {'role': 'user', 'content': 'isolated-export-marker'}]}}})

    def export(self, **options):
        payload = dict(sti=True, cross=False, metrics=False, merge_same_materials=True)
        payload.update(options)
        result = self.request('POST', '/api/export', payload)['result']
        status, headers, raw = self._request(self.manager.url, self.cookie, 'GET',
                                            '/api/export/download?file=' + result['zip_file'], None)
        self.assertEqual(status, 200)
        self.assertIn('attachment', headers['content-disposition'])
        return result, zipfile.ZipFile(io.BytesIO(raw))

    def state(self):
        worker = self.worker()
        model = worker['model']
        return dict(
            init={key: value for key, value in self.request('GET', '/api/init')['result'].items() if key != 'exports'},
            grid=model.grid.copy(), owners=model.display_provenance.owners.copy(),
            source_ids=dict(model.display_provenance.step_ids),
            slice=self.request('GET', '/api/slice?axis=Z&index=2&kind=material')['result'],
            manifest=self.request('GET', '/api/preview/manifest')['result'],
            timeline=self.request('POST', '/api/timeline/get', {})['result'],
            history=self.request('GET', '/api/history')['result'],
            stacks=pickle.dumps(tuple(worker[key] for key in (
                'undo_stack', 'redo_stack', 'step_cache_step_states',
                'step_cache_step_sigs', 'step_cache_step_sources'))),
            revision=worker['model_revision'],
        )

    def test_complete_material_zip_excludes_agent_report_and_preserves_current_model(self):
        self.build()
        before = self.state()
        with patch.object(tcad.StructureWaferStep, 'execute', side_effect=AssertionError('export executed wafer')), \
             patch.object(tcad.StructureDepositStep, 'execute', side_effect=AssertionError('export executed deposit')):
            result, package = self.export(include_agent_report=False)
        with package:
            names = package.namelist()
            self.assertNotIn('agent_report.md', names)
            combined = [name for name in names if name.endswith('.stl') and '/' not in name]
            split = [name for name in names if name.endswith('.stl') and '/' in name]
            self.assertEqual(len(combined), 1)
            self.assertEqual(len(split), 2)
            manifest = next(name for name in names if '/manifest_' in name)
            rows = list(csv.DictReader(io.StringIO(package.read(manifest).decode())))
            self.assertEqual({row['solid_name'] for row in rows}, {'Silicon', 'Silicon Dioxide'})
            self.assertEqual({row['part_file'] for row in rows}, {name.rsplit('/', 1)[1] for name in split})
            for name in combined + split:
                vertices = np.array([[float(v) for v in line.split()[1:]]
                                     for line in package.read(name).decode().splitlines()
                                     if line.strip().startswith('vertex ')])
                self.assertGreater(len(vertices), 0)
                self.assertTrue(np.isfinite(vertices).all())
                span = np.ptp(vertices, axis=0)
                # 12 * 5 nm lateral domain, 40 + 10 nm material stack; STL is µm.
                self.assertTrue(np.all(span > 0))
                self.assertTrue(np.all(span <= np.array([.061, .061, .051])))
                self.assertGreater(span[0], .04)
                self.assertGreater(span[1], .04)
            self.assertTrue(any(name.endswith('.xyz') for name in names))
            self.assertTrue(any('surface_height_' in name for name in names))
            self.assertTrue(any(name.endswith('.stl') for name in result['files']))
        after = self.state()
        for key in ('grid', 'owners'):
            np.testing.assert_array_equal(before.pop(key), after.pop(key))
        self.assertEqual(before, after)

    def test_omitted_report_option_preserves_legacy_agent_report(self):
        self.build()
        _, package = self.export()
        with package:
            self.assertIn(b'isolated-export-marker', package.read('agent_report.md'))

    def test_empty_geometry_does_not_claim_stl_and_missing_download_is_json_error(self):
        self.request('POST', '/api/recipe/import', {'recipe': {'steps_full': [
            {'name': 'Structure Wafer', 'params': {'material': 'Photoresist', 'thickness_nm': 20}},
            {'name': 'Structure Strip'},
        ]}}
        )
        self.request('POST', '/api/run/all', {})
        _, package = self.export(include_agent_report=False)
        with package:
            self.assertFalse(any(name.endswith('.stl') for name in package.namelist()))
        status, headers, raw = self._request(self.manager.url, self.cookie, 'GET',
                                            '/api/export/download?file=missing.zip', None)
        self.assertEqual(status, 404)
        self.assertIn('json', headers['content-type'])
        self.assertFalse(json.loads(raw)['ok'])

    def test_non_boolean_report_option_is_rejected_before_writing_exports(self):
        self.build()
        session = next(iter(self.manager.sessions.values()))
        exports = tcad._webui_session_paths(session.storage_dir)['exports_dir']
        before = self.state()
        existing = set(exports.rglob('*'))
        for value in (None, 'false', 0, 1, [], {}):
            with self.subTest(value=value):
                self.request('POST', '/api/export', {'include_agent_report': value}, ok=False)
                self.assertEqual(existing, set(exports.rglob('*')))
        after = self.state()
        for key in ('grid', 'owners'):
            np.testing.assert_array_equal(before.pop(key), after.pop(key))
        self.assertEqual(before, after)
