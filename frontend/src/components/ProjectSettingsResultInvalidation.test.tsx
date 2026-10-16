import {act, fireEvent, render, screen} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import type {StepView, TcadApi} from '../api/types';
import {AppStateProvider, useAppState} from '../state/AppStateContext';
import {ProjectSettings} from './ProjectSettings';

it.each(['input', 'order'] as const)('ignores readonly execution-result invalidation but still rejects changed project %s', async operation => {
  const wafer: StepView = {index: 0, name: 'Structure Wafer', instanceName: 'Wafer', group: '', loop: '', enabled: true,
    params: {thickness_nm: 50}, parameterSpecs: [{key: 'thickness_nm', label: 'Thickness', type: 'float', minimum: 0}], runtimeStatus: 'done'};
  const window: StepView = {...wafer, index: 1, name: 'Structure Etch', instanceName: 'Window', executionResult: {referenceZNm: 395}};
  const tail: StepView = {...window, index: 2, name: 'Structure Strip', instanceName: 'Tail', params: {}, parameterSpecs: [], executionResult: undefined};
  const recipe = [wafer, window, tail];
  const api = {
    init: vi.fn(async () => ({recipe, factories: [], materials: [], model: {gridShape: [64,32,64], voxelSizeNm: 5}, uiState: {}})),
    exportRecipe: vi.fn(async () => new Blob([JSON.stringify({domain: {grid_shape: [64,32,64], voxel_size_nm: 5}, steps_full: recipe.map(step => ({name: step.name, params: step.params}))})])),
    setStep: vi.fn(async () => ({step: {...wafer, params: {thickness_nm: 80}}, statuses: ['dirty', 'dirty', 'dirty'], warnings: []})),
    moveStep: vi.fn(async () => [wafer, {...tail, index: 1}, {...window, index: 2}]),
    getTimeline: vi.fn(async () => ({items: [], current: -1})),
  } as unknown as TcadApi;
  function Harness() {
    const {actions} = useAppState();
    return <><button onClick={() => actions.invalidateExecutionResults()}>Invalidate results</button><button onClick={() => {if (operation === 'input') {actions.updateDraft(0, 'thickness_nm', 80); void actions.saveParameter(0, 'thickness_nm');} else void actions.moveStep('down');}}>Change input</button><ProjectSettings api={api} onClose={() => {}} /></>;
  }
  render(<AppStateProvider api={api}><Harness /></AppStateProvider>);
  const confirm = await screen.findByRole('button', {name: '确认项目设置'});
  expect(confirm).toBeEnabled();
  fireEvent.click(screen.getByText('Invalidate results'));
  expect(confirm).toBeEnabled(); expect(screen.queryByText('配方已改变，请取消并重新打开项目设置。')).not.toBeInTheDocument();
  await act(async () => {fireEvent.click(screen.getByText('Change input'));});
  expect(confirm).toBeDisabled(); expect(screen.getByText('配方已改变，请取消并重新打开项目设置。')).toBeVisible();
});
