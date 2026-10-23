"""M12：桌面启动器冒烟测试。"""
import os
import base64
import inspect
import json
import multiprocessing
from contextlib import contextmanager
import socketserver
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

os.environ.setdefault("TCAD_SKIP_QT", "1")
os.environ.setdefault("MPLBACKEND", "Agg")


class LauncherTests(unittest.TestCase):
    def test_import_and_find_port(self):
        from tcad_studio import find_free_port
        port = find_free_port(18765)
        self.assertTrue(18765 <= port < 18865)

    def test_py_compile(self):
        import py_compile
        py_compile.compile("tcad_studio.py", doraise=True)
        py_compile.compile("tcad_studio.spec", doraise=True,
                           cfile="/tmp/_spec.pyc")  # spec 不是 .py，但语法兼容


class LauncherLifecycleTests(unittest.TestCase):
    def setUp(self):
        import tcad_studio
        self.studio = tcad_studio
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.manager = Mock(port=18767)
        self.timer = Mock()
        self.factory = self._patch("tcad_simulator.WebUIServerManager", return_value=self.manager)
        self._patch("tcad_studio.Path.home", return_value=Path(self.temp_dir.name))
        self.port = self._patch("tcad_studio.find_free_port", return_value=18765)
        self._patch("sys.argv", ["tcad_studio.py", "--no-browser"])
        self.sleep = self._patch("tcad_studio.time.sleep", side_effect=KeyboardInterrupt)
        self.timer_factory = self._patch("tcad_studio.threading.Timer", return_value=self.timer)
        self.browser = self._patch("tcad_studio.webbrowser.open")

    def _patch(self, target, *args, **kwargs):
        patcher = patch(target, *args, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def test_ctrl_c_stops_manager_once_and_returns_zero_without_browser(self):
        self.assertEqual(self.studio.main(), 0)
        self.manager.start.assert_called_once_with()
        self.manager.stop.assert_called_once_with()
        self.factory.assert_called_once_with(
            storage_root=str(Path(self.temp_dir.name) / ".tcad-studio"),
            host="127.0.0.1", port=18765,
            startup_recipe_mode="structure",
        )
        self.timer_factory.assert_not_called()
        self.browser.assert_not_called()

    def test_runtime_error_stops_manager_and_propagates_same_exception(self):
        error = RuntimeError("runtime failed")
        self.sleep.side_effect = error
        with self.assertRaises(RuntimeError) as caught:
            self.studio.main()
        self.assertIs(caught.exception, error)
        self.manager.stop.assert_called_once_with()

    def test_startup_error_stops_partially_started_manager(self):
        error = RuntimeError("startup failed")
        self.manager.start.side_effect = error
        with self.assertRaises(RuntimeError) as caught:
            self.studio.main()
        self.assertIs(caught.exception, error)
        self.manager.stop.assert_called_once_with()
        self.sleep.assert_not_called()

    def test_ctrl_c_during_startup_stops_manager_and_returns_zero(self):
        self.manager.start.side_effect = KeyboardInterrupt
        try:
            result = self.studio.main()
        except KeyboardInterrupt:
            self.fail("startup Ctrl+C escaped without managed cleanup")
        self.assertEqual(result, 0)
        self.manager.stop.assert_called_once_with()

    def test_browser_timer_uses_one_second_and_bound_studio_url(self):
        with patch("sys.argv", ["tcad_studio.py"]):
            self.assertEqual(self.studio.main(), 0)
        delay, callback = self.timer_factory.call_args.args
        self.assertEqual(delay, 1.0)
        self.timer.start.assert_called_once_with()
        self.timer.cancel.assert_called_once_with()
        self.manager.stop.assert_called_once_with()
        self.browser.assert_not_called()
        callback()
        self.browser.assert_called_once_with("http://127.0.0.1:18767/studio/")

    def test_timer_construction_error_stops_manager_and_propagates(self):
        error = RuntimeError("timer construction failed")
        self.timer_factory.side_effect = error
        with patch("sys.argv", ["tcad_studio.py"]), self.assertRaises(RuntimeError) as caught:
            self.studio.main()
        self.assertIs(caught.exception, error)
        self.manager.stop.assert_called_once_with()

    def test_timer_start_error_cancels_timer_and_stops_manager(self):
        error = RuntimeError("timer start failed")
        self.timer.start.side_effect = error
        with patch("sys.argv", ["tcad_studio.py"]), self.assertRaises(RuntimeError) as caught:
            self.studio.main()
        self.assertIs(caught.exception, error)
        self.timer.cancel.assert_called_once_with()
        self.manager.stop.assert_called_once_with()

    def test_timer_cancel_error_still_stops_manager(self):
        error = RuntimeError("timer cancel failed")
        self.timer.cancel.side_effect = error
        with patch("sys.argv", ["tcad_studio.py"]), self.assertRaises(RuntimeError) as caught:
            self.studio.main()
        self.assertIs(caught.exception, error)
        self.manager.stop.assert_called_once_with()

    def test_constructor_error_does_not_stop_unconstructed_manager(self):
        error = RuntimeError("constructor failed")
        self.factory.side_effect = error
        with self.assertRaises(RuntimeError) as caught:
            self.studio.main()
        self.assertIs(caught.exception, error)
        self.manager.stop.assert_not_called()

    def test_port_error_does_not_construct_manager(self):
        error = RuntimeError("no port")
        self.port.side_effect = error
        with self.assertRaises(RuntimeError) as caught:
            self.studio.main()
        self.assertIs(caught.exception, error)
        self.factory.assert_not_called()
        self.manager.stop.assert_not_called()


class StudioStartupRecipeTests(unittest.TestCase):
    domain = {"grid_shape": [12, 12, 16], "voxel_size_nm": 5.0, "threads": 1}

    @contextmanager
    def _storage(self):
        with tempfile.TemporaryDirectory() as root:
            self.managers = []
            try:
                yield root
            finally:
                for manager in self.managers:
                    manager.stop()

    def _manager(self, root, mode="structure", backend="inprocess"):
        import tcad_simulator as tcad
        options = {} if mode is None else {"startup_recipe_mode": mode}
        manager = tcad.WebUIServerManager(
            host="127.0.0.1", port=0, storage_root=Path(root),
            default_domain=self.domain, enable_ai_agent=False, **options,
        )
        manager._force_inprocess_worker = backend == "inprocess"
        self.managers.append(manager)
        return manager

    def _rpc(self, session, command, payload=None):
        response = session.rpc(command, payload or {}, timeout_s=30.0)
        self.assertTrue(response["ok"], response)
        return response["result"]

    def _session(self, manager, previous=None):
        options = {} if previous is None else {
            "session_id": previous.session_id, "secret": previous.secret,
        }
        session, _cookie = manager.create_session(**options)
        self.assertIsNotNone(session)
        return session

    def _geometry(self, session):
        manifest = self._rpc(session, "structure_display_manifest")
        slices = [self._rpc(session, "structure_display_slice", {
            "revision": manifest["revision"], "axis": "Z", "index": index,
        }) for index in range(self.domain["grid_shape"][2])]
        return manifest["owner_step_ids"], [(item["material"], item["owner"]) for item in slices]

    def _assert_single_wafer(self, session):
        import tcad_simulator as tcad
        current = self._rpc(session, "init")
        self.assertEqual([step["name"] for step in current["recipe"]], ["Initialize Wafer"])
        step = current["recipe"][0]
        self.assertEqual(step["params"]["thickness_nm"], 40.0)
        material = tcad.MaterialDatabase().id_for("Silicon")
        self.assertEqual(step["params"]["material"], material)
        self.assertEqual(current["model"]["substrate_material"], "Silicon")
        self.assertEqual(current["model"]["substrate_thickness_nm"], step["params"]["thickness_nm"])
        self.assertFalse(any(item["snapshot_valid"] for item in self._rpc(session, "timeline_get")["items"]))
        _owners, slices = self._geometry(session)
        for index, (slc, _owner) in enumerate(slices):
            values = memoryview(base64.b64decode(slc["data_b64"])).cast("H")
            self.assertEqual(set(values), {material if index < 8 else 0})
        return current

    def test_new_structure_session_has_matching_wafer_and_air_then_builds_with_factory(self):
        with self._storage() as root:
            session = self._session(self._manager(root))
            current = self._assert_single_wafer(session)
            self.assertIn("Structure Deposit", current["recipe_factories"])
            self._rpc(session, "recipe_add", {
                "name": "Structure Deposit", "params": {"material": "Germanium", "thickness_nm": 10},
            })
            self._rpc(session, "run_step", {"index": 1})
            owners, _slices = self._geometry(session)
            self.assertTrue(owners)
            self.assertEqual(len(self._rpc(session, "init")["recipe"]), 2)

    def test_tall_structure_domain_keeps_factory_thickness_instead_of_half_height(self):
        self.domain = {"grid_shape": [12, 12, 100], "voxel_size_nm": 5.0, "threads": 1}
        with self._storage() as root:
            session = self._session(self._manager(root))
            current = self._rpc(session, "init")
            self.assertEqual(current["recipe"][0]["params"]["thickness_nm"], 200.0)
            self.assertEqual(current["model"]["substrate_thickness_nm"], 200.0)
            for index, material in ((39, 1), (40, 0), (99, 0)):
                slc = self._rpc(session, "slice", {"axis": "Z", "index": index})
                self.assertEqual(set(memoryview(base64.b64decode(slc["data_b64"])).cast("H")), {material})

    def test_structure_mode_keeps_legacy_reset_when_deleting_the_only_project(self):
        with self._storage() as root:
            session = self._session(self._manager(root))
            initial = self._assert_single_wafer(session)
            self._rpc(session, "recipe_delete", {"id": initial["current_recipe"]["id"]})
            current = self._rpc(session, "init")
            self.assertEqual(len(current["recipe"]), 10)
            self.assertEqual(current["current_recipe"]["name"], "Untitled")
            self.assertNotEqual(current["recipe"][0]["step_id"], initial["recipe"][0]["step_id"])

    def test_default_manager_and_old_five_argument_worker_keep_ten_steps(self):
        import tcad_simulator as tcad
        with self._storage() as root:
            self.assertEqual(len(self._rpc(self._session(self._manager(root, mode=None)), "init")["recipe"]), 10)
        with tempfile.TemporaryDirectory() as root:
            class Connection:
                commands = iter([{"cmd": "init", "rid": 1}, {"cmd": "shutdown", "rid": 2}])
                responses = []
                def recv(self):
                    return next(self.commands)
                def send(self, response):
                    self.responses.append(response)
            connection = Connection()
            tcad._webui_worker_main(connection, root, True, "high", self.domain)
            self.assertEqual(len(connection.responses[0]["result"]["recipe"]), 10)

    def test_invalid_mode_is_rejected_before_storage_or_thread_side_effects(self):
        import tcad_simulator as tcad
        parameter = inspect.signature(tcad.WebUIServerManager).parameters["startup_recipe_mode"]
        self.assertEqual(parameter.kind, inspect.Parameter.KEYWORD_ONLY)
        self.assertEqual(parameter.default, "legacy")
        with tempfile.TemporaryDirectory() as root:
            for mode in ("invalid", "STRUCTURE", "", None, []):
                with self.subTest(mode=mode), patch("tcad_simulator._tcad_ensure_writable_dir") as storage, \
                        patch("tcad_simulator.threading.Thread") as thread:
                    with self.assertRaises(ValueError):
                        tcad.WebUIServerManager(storage_root=Path(root) / "new", startup_recipe_mode=mode)
                    storage.assert_not_called()
                    thread.assert_not_called()
                    self.assertFalse((Path(root) / "new").exists())

    def test_spawn_creates_real_structure_session(self):
        import tcad_simulator as tcad
        if "spawn" not in multiprocessing.get_all_start_methods() or not tcad._tcad_can_spawn_webui_worker():
            self.skipTest("spawn is unavailable in this runtime")
        with self._storage() as root:
            manager = self._manager(root, backend="spawn")
            session = self._session(manager)
            self.assertIsInstance(session.process, multiprocessing.process.BaseProcess)
            self.assertEqual(session.process._start_method, "spawn")
            self._assert_single_wafer(session)

    def test_failed_process_creation_falls_back_to_real_inprocess_structure_worker(self):
        import tcad_simulator as tcad
        with self._storage() as root:
            manager = self._manager(root, backend="spawn")
            with patch("tcad_simulator._tcad_can_spawn_webui_worker", return_value=True), \
                    patch("tcad_simulator._tcad_can_fork_webui_worker", return_value=False), \
                    patch.object(multiprocessing.get_context("spawn"), "Process", side_effect=OSError("cannot create process")):
                session = self._session(manager)
            self.assertTrue(manager._force_inprocess_worker)
            self.assertIsInstance(session.process, tcad._ThreadWorkerProcess)
            self._assert_single_wafer(session)

    def test_new_structure_session_applies_admin_wafer_configuration_to_real_layers(self):
        import tcad_simulator as tcad
        with self._storage() as root:
            manager = self._manager(root)
            tcad._library_save_admin_config(Path(root), {"process_steps": {"Initialize Wafer": {"roles": {
                "material": {"default_material": "Germanium"},
            }}}})
            session = self._session(manager)
            current = self._rpc(session, "init")
            self.assertEqual(len(current["recipe"]), 1)
            params = current["recipe"][0]["params"]
            self.assertEqual(params["thickness_nm"], 40.0)
            material_db = tcad.MaterialDatabase()
            self.assertEqual(params["material"], material_db.id_for("Germanium"))
            _owners, slices = self._geometry(session)
            expected = [material_db.id_for("Germanium")] * 8 + [0] * 8
            for (slc, _owner), material in zip(slices, expected):
                values = memoryview(base64.b64decode(slc["data_b64"])).cast("H")
                self.assertEqual(set(values), {material})

    def _restart_preserving(self, root, manager, session, conflicting_autosave=False):
        import tcad_simulator as tcad
        before = self._rpc(session, "init")
        geometry = self._geometry(session)
        manager.stop()
        autosave_path = session.storage_dir / "autosave.pkl.gz"
        if conflicting_autosave:
            decoy = tcad._webui_pickle_load(autosave_path)
            decoy["recipe_name"] = "Must not replace the active project"
            tcad._webui_pickle_dump(autosave_path, decoy)
        if before["recipe"] == []:
            # An explicit empty full list must outrank a stale legacy list at bootstrap.
            recipe_id = before["current_recipe"]["id"]
            for path in (autosave_path, session.storage_dir / "history" / (recipe_id + ".pkl.gz"),
                         session.storage_dir / "history" / (recipe_id + ".autosave.pkl.gz")):
                if path.exists():
                    blob = tcad._webui_pickle_load(path)
                    self.assertEqual(blob["steps_full"], [])
                    blob["steps"] = [{"name": "Structure Deposit", "params": {"thickness_nm": 10}}]
                    tcad._webui_pickle_dump(path, blob)
        resumed = self._session(self._manager(root), previous=session)
        after = self._rpc(resumed, "init")
        for key in ("current_recipe", "model", "ui_state"):
            self.assertEqual(after[key], before[key])
        fields = ("name", "params", "instance_name", "enabled", "step_id")
        # Existing restore canonicalizes material names to IDs; compare their meaning.
        material_db = tcad.MaterialDatabase()
        for step in before["recipe"]:
            for key, value in step["params"].items():
                if (key == "material" or key.endswith("_material")) and isinstance(value, str) and value in material_db.names():
                    step["params"][key] = material_db.id_for(value)
        self.assertEqual([{key: step[key] for key in fields} for step in after["recipe"]],
                         [{key: step[key] for key in fields} for step in before["recipe"]])
        self.assertEqual(self._geometry(resumed), geometry)
        return resumed

    def test_structure_startup_resumes_physical_project_without_migration_or_execution(self):
        with self._storage() as root:
            manager = self._manager(root, mode=None)
            session = self._session(manager)
            self._rpc(session, "set_step", {
                "index": 0, "params": {"material": "Germanium", "thickness_nm": 20},
                "instance_name": "旧晶圆",
            })
            self._rpc(session, "set_step", {"index": 1, "enabled": False, "instance_name": "保留物理步骤"})
            self._rpc(session, "run_step", {"index": 0})
            current = self._rpc(session, "init")
            self._rpc(session, "ui_state", {"recipe_id": current["current_recipe"]["id"],
                                           "ui_state": {"selectedStepIndex": 1, "camera": {"zoom": 2}}})
            resumed = self._restart_preserving(root, manager, session, conflicting_autosave=True)
            self.assertEqual(len(self._rpc(resumed, "init")["recipe"]), 10)

    def test_structure_and_authoritative_empty_projects_resume_geometry_source_and_drafts(self):
        import tcad_simulator as tcad
        for empty in (False, True):
            with self.subTest(empty=empty), self._storage() as root:
                manager = self._manager(root, mode=None)
                session = self._session(manager)
                self._rpc(session, "recipe_new", {"name": "结构项目"})
                self._rpc(session, "recipe_add", {
                    "name": "Structure Deposit", "params": {"material": "Germanium", "thickness_nm": 10},
                })
                self._rpc(session, "run_step", {"index": 1})
                self._rpc(session, "recipe_add", {
                    "name": "Structure Etch", "params": {"lower_z_nm": "未活动草稿"},
                })
                if empty:
                    for index in (2, 1, 0):
                        self._rpc(session, "recipe_remove", {"index": index})
                else:
                    self.assertTrue(self._geometry(session)[0])
                self._rpc(session, "recipe_save")
                resumed = self._restart_preserving(root, manager, session)
                if empty:
                    self.assertEqual(self._rpc(resumed, "init")["recipe"], [])
                    blob = tcad._webui_pickle_load(resumed.storage_dir / "autosave.pkl.gz")
                    self.assertEqual(blob["steps_full"], [])
                else:
                    self.assertEqual(self._rpc(resumed, "init")["recipe"][2]["params"]["lower_z_nm"], "未活动草稿")

    def test_structure_startup_falls_back_to_autosave_then_recent_history(self):
        for fallback in ("autosave", "history"):
            with self.subTest(fallback=fallback), self._storage() as root:
                manager = self._manager(root, mode=None)
                session = self._session(manager)
                self._rpc(session, "set_step", {"index": 0, "params": {"material": "Germanium", "thickness_nm": 20}})
                self._rpc(session, "run_step", {"index": 0})
                self._rpc(session, "recipe_save", {"name": "恢复回退"})
                before = self._rpc(session, "init")
                geometry = self._geometry(session)
                manager.stop()
                pointer = session.storage_dir / "session_state.json"
                pointer.write_text(json.dumps({"last_active_recipe_id": "missing"}), encoding="utf-8")
                if fallback == "history":
                    (session.storage_dir / "autosave.pkl.gz").unlink()
                resumed = self._session(self._manager(root), previous=session)
                current = self._rpc(resumed, "init")
                self.assertEqual(current["current_recipe"], before["current_recipe"])
                self.assertEqual([step["name"] for step in current["recipe"]],
                                 [step["name"] for step in before["recipe"]])
                self.assertEqual(current["model"], before["model"])
                self.assertEqual(self._geometry(resumed), geometry)


class LauncherShutdownPersistenceTests(unittest.TestCase):
    def test_ctrl_c_flushes_latest_edit_before_same_session_restart(self):
        import tcad_simulator as tcad
        import tcad_studio as studio
        from structure_cad.display_provenance import validate_source_bound_identities
        from tests.test_webui_cad_shell import CadShellWorkerHistoryTests

        fixture = CadShellWorkerHistoryTests()
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = fixture._start_manager(Path(temp_dir) / ".tcad-studio")
            resumed_manager = None
            captured = {}

            def rpc(session, command, payload=None):
                response = session.rpc(command, payload or {}, timeout_s=30.0)
                self.assertTrue(response["ok"], response)
                return response["result"]

            def edit_then_interrupt(_seconds):
                session, _cookie = manager.create_session()
                self.assertIsNotNone(session)
                rpc(session, "recipe_new", {"name": "Launcher shutdown"})
                rpc(session, "run_step", {"index": 0})
                rpc(session, "recipe_add", {
                    "name": "Structure Deposit",
                    "params": {"material": "Germanium", "thickness_nm": 20},
                })
                rpc(session, "run_step", {"index": 1})
                captured["before"] = rpc(session, "init")
                captured["manifest"] = rpc(session, "structure_display_manifest")
                captured["session_id"] = session.session_id
                captured["secret"] = session.secret
                captured["storage"] = session.storage_dir
                # Skip the edit autosave deliberately: shutdown must flush it without waiting.
                edited = rpc(session, "set_step", {
                    "index": 1, "params": {"thickness_nm": 35}, "no_autosave": True,
                })
                captured["edited"] = edited["params"]
                raise KeyboardInterrupt

            try:
                with patch("sys.argv", ["tcad_studio.py", "--no-browser"]), \
                        patch("tcad_studio.Path.home", return_value=Path(temp_dir)), \
                        patch("tcad_studio.find_free_port", return_value=manager.port), \
                        patch("tcad_simulator.WebUIServerManager", return_value=manager), \
                        patch.object(studio, "time", SimpleNamespace(sleep=edit_then_interrupt)), \
                        patch.object(manager._httpd, "shutdown", wraps=manager._httpd.shutdown) as shutdown, \
                        patch.object(manager._httpd, "server_close", wraps=manager._httpd.server_close) as close, \
                        patch("tcad_studio.webbrowser.open") as browser:
                    self.assertEqual(studio.main(), 0)
                    shutdown.assert_called_once_with()
                    close.assert_called_once_with()
                    browser.assert_not_called()
                self.assertFalse(manager.running)
                self.assertEqual(manager.sessions, {})
                self.assertIsNone(manager._httpd)
                self.assertIsNone(manager._thread)
                blob = tcad._webui_pickle_load(captured["storage"] / "autosave.pkl.gz")
                # Stored material names are normalized to IDs in the client response.
                self.assertEqual(blob["steps_full"][1]["params"]["thickness_nm"], 35)
                self.assertEqual(blob["steps_full"][1]["params"]["material"], "Germanium")
                self.assertIsNotNone(blob["model_state"]["display_owners"])
                validate_source_bound_identities(blob["steps_full"], blob["model_state"])

                resumed_manager = fixture._start_manager(Path(temp_dir) / ".tcad-studio")
                resumed, _cookie = resumed_manager.create_session(
                    session_id=captured["session_id"], secret=captured["secret"],
                )
                self.assertIsNotNone(resumed)
                current = rpc(resumed, "init")
                self.assertEqual(current["recipe"][1]["params"], captured["edited"])
                self.assertEqual(current["model"], captured["before"]["model"])
                manifest = rpc(resumed, "structure_display_manifest")
                self.assertTrue(manifest["owner_step_ids"])
                self.assertEqual(manifest["owner_step_ids"], captured["manifest"]["owner_step_ids"])
                self.assertTrue(set(manifest["owner_step_ids"].values()).issubset(
                    step["step_id"] for step in current["recipe"]))
            finally:
                manager.stop()
                if resumed_manager is not None:
                    resumed_manager.stop()


class LauncherPartialStartupTests(unittest.TestCase):
    def _assert_thread_start_failure_cleans_up(self, error):
        import tcad_simulator as tcad
        import tcad_studio as studio

        with tempfile.TemporaryDirectory() as temp_dir:
            manager = tcad.WebUIServerManager(
                host="127.0.0.1", port=0, storage_root=Path(temp_dir) / ".tcad-studio",
                enable_ai_agent=False,
                default_domain={"grid_shape": [12, 12, 16], "voxel_size_nm": 5.0, "threads": 1},
            )
            # Real stdlib shutdown blocks forever if serve_forever never ran.
            server = socketserver.BaseServer(("127.0.0.1", 0), None)
            server.shutdown = Mock(wraps=server.shutdown)
            server.server_close = Mock(wraps=server.server_close)
            session = Mock()
            manager.sessions["existing"] = session
            stop = Mock(wraps=manager.stop)
            sleep = Mock(side_effect=AssertionError("failed startup reached runtime loop"))
            done = threading.Event()
            outcome = {}

            def launch():
                try:
                    with patch("sys.argv", ["tcad_studio.py", "--no-browser"]), \
                            patch("tcad_studio.Path.home", return_value=Path(temp_dir)), \
                            patch("tcad_studio.find_free_port", return_value=0), \
                            patch("tcad_simulator.WebUIServerManager", return_value=manager), \
                            patch("tcad_simulator._WebUIHTTPServer", return_value=server), \
                            patch.object(manager, "ensure_static_assets"), \
                            patch.object(manager, "stop", stop), \
                            patch.object(studio, "time", SimpleNamespace(sleep=sleep)), \
                            patch.object(threading.Thread, "start", side_effect=error):
                        outcome["result"] = studio.main()
                except BaseException as caught:
                    outcome["error"] = caught
                finally:
                    done.set()

            runner = threading.Thread(target=launch, daemon=True)
            runner.start()
            try:
                completed = done.wait(timeout=1.0)
            finally:
                # Release the original bug's shutdown wait before reporting RED.
                server._BaseServer__is_shut_down.set()
                runner.join(timeout=2.0)
            self.assertFalse(runner.is_alive(), "partial-start cleanup test leaked its runner")
            self.assertTrue(completed, "stop blocked on a server whose service thread never started")
            stop.assert_called_once_with()
            server.shutdown.assert_not_called()
            server.server_close.assert_called_once_with()
            session.rpc.assert_called_once_with("shutdown", {}, timeout_s=5.0)
            session.conn.close.assert_called_once_with()
            session.process.terminate.assert_called_once_with()
            self.assertEqual(manager.sessions, {})
            self.assertIsNone(manager._httpd)
            self.assertIsNone(manager._thread)
            sleep.assert_not_called()
            if isinstance(error, KeyboardInterrupt):
                self.assertEqual(outcome, {"result": 0})
            else:
                self.assertIs(outcome.get("error"), error)

    def test_service_thread_start_error_closes_server_and_propagates(self):
        self._assert_thread_start_failure_cleans_up(RuntimeError("thread start failed"))

    def test_service_thread_start_ctrl_c_closes_server_and_returns_zero(self):
        self._assert_thread_start_failure_cleans_up(KeyboardInterrupt())


if __name__ == "__main__":
    unittest.main()
