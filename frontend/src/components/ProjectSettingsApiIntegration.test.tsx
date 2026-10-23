import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {createTcadApi} from '../api/client';
import {AppStateProvider} from '../state/AppStateContext';
import {ProjectSettings} from './ProjectSettings';

afterEach(() => vi.unstubAllGlobals());

it.each([
  {label: 'legacy material names', materials: {material: 'Silicon', box_material: 'Silicon Dioxide', device_material: 'Silicon'}, valid: true},
  {label: 'persisted material IDs', materials: {material: 1, box_material: 2, device_material: 1}, valid: true},
  {label: 'legacy string IDs', materials: {material: '1', box_material: '2', device_material: '1'}, valid: true},
  {label: 'unknown material ID', materials: {material: 999, box_material: 2, device_material: 1}, valid: false},
  {label: 'material missing from declared choices', materials: {material: 28, box_material: 2, device_material: 1}, valid: false},
  {label: 'already matching numeric choices', materials: {material: 1, box_material: 2, device_material: 1}, valid: true, numericChoices: true},
])('reads real Initialize Wafer response shapes with $label and preserves project data on submit', async ({materials, valid, numericChoices}) => {
  const names = {material: 'Silicon', box_material: 'Silicon Dioxide', device_material: 'Silicon'};
  const choices = numericChoices ? [[1, 'Silicon'], [2, 'Silicon Dioxide']] : [['Silicon', 'Silicon'], ['Silicon Dioxide', 'Silicon Dioxide']];
  const initializer = {
    name: 'Initialize Wafer', instance_name: 'Substrate', enabled: true,
    params: {...materials, thickness_nm: 200, wafer_type: 'SOI', box_thickness_nm: 20,
      device_thickness_nm: 10, orientation: '100', initial_temperature: 25, retained_field: {draft: 'keep'}},
    parameter_specs: [
      {key: 'wafer_type', label: 'Wafer type', type: 'enum', default: 'Bulk', choices: [['Bulk', 'Bulk'], ['SOI', 'SOI (handle + BOX + device layer)']]},
      {key: 'material', label: 'Substrate / handle material', type: 'enum', default: 'Silicon', choices},
      {key: 'thickness_nm', label: 'Total thickness', type: 'float', default: 200, minimum: 0, maximum: 10000, units: 'nm'},
      {key: 'orientation', label: 'Orientation', type: 'enum', default: '100', choices: [['100', '(100)'], ['111', '(111)']]},
      {key: 'box_material', label: 'BOX material (SOI)', type: 'enum', default: 'Silicon Dioxide', choices},
      {key: 'box_thickness_nm', label: 'BOX thickness (SOI)', type: 'float', default: 0, minimum: 0, maximum: 20000, units: 'nm'},
      {key: 'device_material', label: 'Device layer material (SOI)', type: 'enum', default: 'Silicon', choices},
      {key: 'device_thickness_nm', label: 'Device layer thickness (SOI)', type: 'float', default: 0, minimum: 0, maximum: 20000, units: 'nm'},
      {key: 'initial_temperature', label: 'Initial temperature', type: 'float', default: 25, minimum: -100, maximum: 1200, units: '°C'},
    ],
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
    steps_full: [{...initializer, params: {...initializer.params, ...names}, params_raw: {...initializer.params}}, legacy],
  };
  const json = (payload: unknown) => new Response(JSON.stringify(payload), {
    status: 200, headers: {'Content-Type': 'application/json; charset=utf-8'},
  });
  const fetcher = vi.fn()
    .mockResolvedValueOnce(json({ok: true, result: {recipe, model, recipe_factories: [], materials: [
      {id: 1, name: 'Silicon', color: [0.5, 0.5, 0.5], enabled: true},
      {id: 2, name: 'Silicon Dioxide', color: [0.8, 0.8, 0.8], enabled: true},
      {id: 28, name: 'Germanium', color: [0.6, 0.6, 0.6], enabled: true},
    ], ui_state: {}}}))
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
  if (!valid) {
    expect(screen.getByRole('button', {name: '确认项目设置'})).toBeDisabled();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    return;
  }
  expect(screen.getByLabelText('材料')).toHaveDisplayValue('Silicon');
  expect(screen.getByLabelText('BOX material (SOI)')).toHaveDisplayValue('Silicon Dioxide');
  expect(screen.getByLabelText('Device layer material (SOI)')).toHaveDisplayValue('Silicon');
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
    name: 'Initialize Wafer', params: {...initializer.params, ...(numericChoices ? materials : names), thickness_nm: 300},
    params_raw: {...initializer.params, ...(numericChoices ? materials : names), thickness_nm: 300},
  });
  expect(imported.recipe.steps_full[1]).toEqual(legacy);
  expect(exported.steps_full[0]).toMatchObject({params_raw: initializer.params});
});
