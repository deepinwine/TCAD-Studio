import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {createTcadApi} from '../api/client';
import {AppStateProvider} from '../state/AppStateContext';
import {ProjectSettings} from './ProjectSettings';

afterEach(() => vi.unstubAllGlobals());

it('reads a new recipe Initialize Wafer through the real client and preserves legacy steps on project submit', async () => {
  const initializer = {
    name: 'Initialize Wafer', instance_name: 'Substrate', enabled: true,
    params: {material: 'Silicon', thickness_nm: 200, wafer_type: 'SOI', box_thickness_nm: 20},
    parameter_specs: [{key: 'thickness_nm', label: 'Thickness', type: 'float', minimum: 0, units: 'nm'}],
    runtime_status: 'ready',
  };
  const legacy = {
    name: 'Etch', instance_name: 'Legacy etch', enabled: false, group: 'old', loop: '2',
    params: {time: 30}, parameter_specs: [], runtime_status: 'ready',
  };
  const model = {grid_shape: [32, 32, 64], voxel_size_nm: 5, threads: 4, metrics: []};
  const recipe = [initializer, legacy];
  const exported = {
    version: 1, name: 'New Recipe', exported_at: '2026-10-22T00:00:00Z', ui_state: {},
    domain: {grid_shape: model.grid_shape, voxel_size_nm: 5, threads: 4},
    steps_full: [initializer, legacy],
  };
  const json = (payload: unknown) => new Response(JSON.stringify(payload), {
    status: 200, headers: {'Content-Type': 'application/json; charset=utf-8'},
  });
  const fetcher = vi.fn()
    .mockResolvedValueOnce(json({ok: true, result: {recipe, model, recipe_factories: [], materials: [], ui_state: {}}}))
    .mockResolvedValueOnce(json(exported))
    .mockResolvedValueOnce(json({ok: true, result: {recipe, model, current_recipe: {name: 'New Recipe', id: ''}}}))
    .mockResolvedValueOnce(json({ok: true, result: {items: [], current: -1}}));
  vi.stubGlobal('fetch', fetcher);
  const api = createTcadApi();
  const close = vi.fn();
  render(<AppStateProvider api={api}><ProjectSettings api={api} onClose={close} /></AppStateProvider>);

  expect(await screen.findByLabelText('网格 X')).toHaveValue(32);
  expect(screen.getByLabelText('体素尺寸（nm）')).toHaveValue(5);
  expect(screen.getByLabelText('厚度（nm）')).toHaveValue(200);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: '确认项目设置'})).toBeEnabled();
  fireEvent.change(screen.getByLabelText('厚度（nm）'), {target: {value: '300'}});
  fireEvent.click(screen.getByRole('button', {name: '确认项目设置'}));

  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([
    '/api/init', '/api/recipe/export?scope=current', '/api/recipe/import', '/api/timeline/get',
  ]);
  const imported = JSON.parse(fetcher.mock.calls[2][1].body as string);
  expect(imported.autosave_current).toBe(true);
  expect(imported.recipe.domain).toEqual(exported.domain);
  expect(imported.recipe.steps_full[0]).toMatchObject({
    name: 'Initialize Wafer', params: {...initializer.params, thickness_nm: 300},
    params_raw: {...initializer.params, thickness_nm: 300},
  });
  expect(imported.recipe.steps_full[1]).toEqual(legacy);
});
