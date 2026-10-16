import {act, render, screen} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {TcadApiError} from '../api/client';
import {parseStepListEnvelope} from '../api/schemas';
import type {StepView, TcadApi} from '../api/types';
import templates from '../test/structureFactoryTemplates.json';
import {I18nProvider} from '../i18n/I18nContext';
import {ParameterPanel} from '../components/ParameterPanel';
import {AppStateProvider, useAppState, type AppStateContextValue} from './AppStateContext';

const network = new TcadApiError('unknown mutation outcome', {status: 0, code: 'network_error'});
function steps(): StepView[] {
  const window = parseStepListEnvelope({ok: true, result: templates}).find(step => step.name === 'Structure Etch')!;
  return [{...window, index: 0, name: 'Structure Pattern', instanceName: 'Opening', params: {mask_mode: 'Custom'},
    parameterSpecs: [{key: 'critical_dimension', label: 'CD', type: 'float', minimum: 0}], runtimeStatus: 'done'},
    {...window, index: 1, params: {...window.params, etch_mode: 'Depth window'}, runtimeStatus: 'done', executionResult: {referenceZNm: 395}}];
}
async function setup() {
  const recipe = steps();
  const timeline = {items: recipe.map(step => ({index: step.index, state: 'done', runtimeStatus: 'done', snapshotValid: true})), current: 1};
  const api = {
    init: vi.fn(async () => ({recipe, factories: [], materials: [], model: {gridShape: [8,8,8], voxelSizeNm: 10}, uiState: {}})),
    getTimeline: vi.fn(async () => timeline), undo: vi.fn(async () => ({applied: true, log: []})), redo: vi.fn(async () => ({applied: true, log: []})),
    restoreTimeline: vi.fn(async () => {throw network;}),
    importRecipe: vi.fn(async () => {throw network;}), newRecipe: vi.fn(async () => {throw network;}),
    addStep: vi.fn(async () => {throw network;}), removeStep: vi.fn(async () => {throw network;}),
    duplicateStep: vi.fn(async () => {throw network;}), moveStep: vi.fn(async () => {throw network;}),
    setStep: vi.fn(async () => {throw network;}), uploadMask: vi.fn(async () => {throw network;}),
    saveRecipe: vi.fn(async () => {throw network;}), exportRecipe: vi.fn(async () => {throw network;}), renameStep: vi.fn(async () => {throw network;}),
    runTo: vi.fn(async () => ({index: 1, recipe: [recipe[0], {...recipe[1], executionResult: {referenceZNm: 405}}]})),
  } as unknown as TcadApi;
  let context!: AppStateContextValue;
  function Harness() {context = useAppState(); return <ParameterPanel step={context.state.recipe[1] ?? null} collapsed={false} />;}
  render(<I18nProvider><AppStateProvider api={api}><Harness /></AppStateProvider></I18nProvider>);
  expect(await screen.findByText('395 nm')).toBeVisible();
  return {api, get context() {return context;}};
}

it.each(['undo', 'redo'] as const)('%s success cannot restore an old reference from a done Timeline', async operation => {
  const mounted = await setup();
  await act(async () => {await mounted.context.actions[operation]();});
  expect(mounted.api.getTimeline).toHaveBeenCalled();
  expect(mounted.context.state.recipe[1]).not.toHaveProperty('executionResult');
  expect(screen.getByText('未解析（需以当前输入成功构建）')).toBeVisible();
});
it.each(['undo', 'redo'] as const)('%s unknown failure keeps the old reference invalidated', async operation => {
  const mounted = await setup();
  mounted.api[operation] = vi.fn(async () => {throw network;});
  await act(async () => {await mounted.context.actions[operation]();});
  expect(mounted.context.state.recipe[1]).not.toHaveProperty('executionResult');
  expect(screen.getByText('未解析（需以当前输入成功构建）')).toBeVisible();
});
it('unknown Timeline restore failure keeps the old reference invalidated', async () => {
  const mounted = await setup();
  await act(async () => {await mounted.context.actions.loadTimeline();});
  expect(screen.getByText('395 nm')).toBeVisible();
  await act(async () => {await mounted.context.actions.restoreTimeline(1);});
  expect(mounted.api.restoreTimeline).toHaveBeenCalledTimes(1);
  expect(mounted.context.state.recipe[1]).not.toHaveProperty('executionResult');
  expect(screen.getByText('未解析（需以当前输入成功构建）')).toBeVisible();
});
it.each(['import', 'new', 'add', 'remove', 'duplicate', 'move', 'replace', 'parameter', 'mask'] as const)('%s input write invalidates old results before an unknown response', async operation => {
  const mounted = await setup();
  await act(async () => {
    const actions = mounted.context.actions;
    switch (operation) {
      case 'import': await actions.importRecipe({recipe: {}}); break;
      case 'new': await actions.newRecipe('New'); break;
      case 'add': await actions.addStep('Structure Strip'); break;
      case 'remove': await actions.removeStep(); break;
      case 'duplicate': await actions.duplicateStep(); break;
      case 'move': await actions.moveStep('down'); break;
      case 'replace': await actions.replaceStep(0, 'Structure Strip', {params: {}}); break;
      case 'parameter': actions.updateDraft(0, 'critical_dimension', 120); await actions.saveParameter(0, 'critical_dimension'); break;
      case 'mask': await actions.uploadMask(new File(['mask'], 'opening.json')); break;
    }
  });
  expect(mounted.context.state.recipe[1]).not.toHaveProperty('executionResult');
  expect(screen.queryByText('395 nm')).not.toBeInTheDocument();
  if (operation === 'import') {
    await act(async () => {await mounted.context.actions.runTo(1);});
    expect(screen.getByText('405 nm')).toBeVisible();
  }
});
it('conditional parameter batch invalidates its own result on unknown write failure', async () => {
  const mounted = await setup();
  await act(async () => {mounted.context.actions.updateDraft(1, 'etch_distance_nm', 35); await mounted.context.actions.saveParameter(1, 'etch_distance_nm');});
  expect(mounted.api.setStep).toHaveBeenCalledWith({index: 1, params: {etch_distance_nm: 35}}, expect.any(AbortSignal));
  expect(mounted.context.state.recipe[1]).not.toHaveProperty('executionResult');
});
it.each(['save', 'export', 'rename'] as const)('pure %s failure preserves a valid reference', async operation => {
  const mounted = await setup();
  await act(async () => {
    if (operation === 'save') await mounted.context.actions.saveRecipe('Saved');
    if (operation === 'export') await mounted.context.actions.exportRecipe();
    if (operation === 'rename') await mounted.context.actions.renameStep('Renamed');
  });
  expect(mounted.context.state.recipe[1].executionResult).toEqual({referenceZNm: 395});
  expect(screen.getByText('395 nm')).toBeVisible();
});
