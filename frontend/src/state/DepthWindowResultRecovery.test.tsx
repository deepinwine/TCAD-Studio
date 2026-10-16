import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {TcadApiError} from '../api/client';
import {parseStepListEnvelope} from '../api/schemas';
import type {RuntimeStatus, StepView, TcadApi} from '../api/types';
import templates from '../test/structureFactoryTemplates.json';
import {I18nProvider} from '../i18n/I18nContext';
import {ParameterPanel} from '../components/ParameterPanel';
import {AppStateProvider, useAppState} from './AppStateContext';
import {appReducer, initialAppState} from './appReducer';

const error = new TcadApiError('Prefix failed', {status: 400, rolledBack: true, details: {stepIndex: 0}});
function windowStep(index: number, runtimeStatus: RuntimeStatus = 'done'): StepView {
  const step = parseStepListEnvelope({ok: true, result: templates}).find(step => step.name === 'Structure Etch')!;
  return {...step, index, params: {...step.params, etch_mode: 'Depth window'}, runtimeStatus, executionResult: {referenceZNm: 395}};
}
const prefix: StepView = {...windowStep(0), name: 'Structure Deposit', instanceName: 'Prefix',
  params: {thickness_nm: 100}, parameterSpecs: [{key: 'thickness_nm', label: 'Thickness', type: 'float', minimum: 0}], executionResult: undefined};

it('run/to clears only authoritative done prefix errors and retains unproven prefixes and suffixes', () => {
  const recipe = ['done', 'dirty', 'error', 'done', 'done'].map((status, index) => windowStep(index, status as RuntimeStatus));
  const started = appReducer({...initialAppState, phase: 'ready', recipe, stepErrors: {0: error, 1: error, 2: error, 3: error, 4: error}}, {type: 'run/started', operation: 'to'});
  const succeeded = appReducer(started, {type: 'run/succeeded', index: 3, payload: {recipe}});
  expect(Object.keys(succeeded.stepErrors)).toEqual(['1', '2', '4']);
});
it.each(['to', 'step'] as const)('legacy %s without an authoritative recipe clears only its target error', operation => {
  const recipe = [windowStep(0), windowStep(1), windowStep(2)];
  const started = appReducer({...initialAppState, recipe, stepErrors: {0: error, 1: error, 2: error}}, {type: 'run/started', operation});
  const succeeded = appReducer(started, {type: 'run/succeeded', index: 1, payload: {runtimeStatus: 'done'}});
  expect(Object.keys(succeeded.stepErrors)).toEqual(['0', '2']);
});
it('single-step success does not clear neighboring errors even with a done authoritative recipe', () => {
  const recipe = [windowStep(0), windowStep(1), windowStep(2)];
  const started = appReducer({...initialAppState, recipe, stepErrors: {0: error, 1: error, 2: error}}, {type: 'run/started', operation: 'step'});
  expect(Object.keys(appReducer(started, {type: 'run/succeeded', index: 1, payload: {recipe}}).stepErrors)).toEqual(['0', '2']);
});
it('repair and Apply restores a fresh reference after a prefix failure', async () => {
  const pending = {...windowStep(1, 'ready'), executionResult: undefined};
  const initial = {recipe: [prefix, pending], factories: [], materials: [], model: {gridShape: [8, 8, 8], voxelSizeNm: 10}, uiState: {}};
  const api = {
    init: vi.fn().mockResolvedValueOnce(initial).mockResolvedValue({...initial, recipe: [{...prefix, runtimeStatus: 'error'}, pending]}),
    getTimeline: vi.fn(async () => ({items: [], current: -1})),
    runStep: vi.fn(async () => {throw error;}),
    setStep: vi.fn(async () => ({step: {...prefix, params: {thickness_nm: 120}, runtimeStatus: 'dirty'}, statuses: ['dirty', 'dirty'], warnings: []})),
    runTo: vi.fn(async () => ({index: 1, recipe: [{...prefix, params: {thickness_nm: 120}}, windowStep(1)]})),
  } as unknown as TcadApi;
  function Harness() {
    const {state, actions} = useAppState();
    return <><button onClick={() => void actions.runStep(0)}>Fail prefix</button><button onClick={() => {actions.updateDraft(0, 'thickness_nm', 120); void actions.applyAndRunTo(1);}}>Repair and Apply</button><output data-testid="errors">{Object.keys(state.stepErrors).join(',')}</output><ParameterPanel step={state.recipe[1] ?? null} collapsed={false} /></>;
  }
  render(<I18nProvider><AppStateProvider api={api}><Harness /></AppStateProvider></I18nProvider>);
  await screen.findByLabelText('刻蚀距离'); fireEvent.click(screen.getByText('Fail prefix'));
  await waitFor(() => expect(screen.getByTestId('errors')).toHaveTextContent('0'));
  await waitFor(() => expect(api.init).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByText('Repair and Apply'));
  expect(await screen.findByText('395 nm')).toBeVisible();
  expect(screen.getByTestId('errors')).toBeEmptyDOMElement();
  expect(api.setStep).toHaveBeenCalledTimes(1); expect(api.runTo).toHaveBeenCalledTimes(1);
});

it.each(['all', 'to'] as const)('%s invalidates old results through an unknown failure and failed recovery', operation => {
  const recipe = [prefix, windowStep(1)];
  const started = appReducer({...initialAppState, phase: 'ready', recipe}, {type: 'run/started', operation});
  expect(started.recipe[1]).not.toHaveProperty('executionResult');
  const network = new TcadApiError('unknown execution outcome', {status: 0, code: 'network_error'});
  const failed = appReducer(started, {type: 'run/failed', error: network});
  const recovered = appReducer(failed, {type: 'run/recovered', error: network});
  const finished = appReducer(recovered, {type: 'mutation/finished'});
  expect(finished.recipe[1]).not.toHaveProperty('executionResult');
  expect(finished.stepErrors).toEqual({});
  expect(appReducer({...finished, activeMutation: operation}, {type: 'run/succeeded', payload: {}}).recipe[1]).not.toHaveProperty('executionResult');
});
it('a known single-step run invalidates only that step and its input-dependent suffix', () => {
  const recipe = [windowStep(0), windowStep(1), windowStep(2)];
  const started = appReducer({...initialAppState, recipe}, {type: 'run/started', operation: 'step', index: 1});
  expect(started.recipe[0].executionResult).toEqual({referenceZNm: 395});
  expect(started.recipe[1]).not.toHaveProperty('executionResult');
  expect(started.recipe[2]).not.toHaveProperty('executionResult');
  const unknown = appReducer({...initialAppState, recipe}, {type: 'run/started', operation: 'step'});
  expect(unknown.recipe.every(step => step.executionResult === undefined)).toBe(true);
});
it.each(['all', 'to'] as const)('%s unknown network failure hides the old reference and a new authoritative run restores it', async operation => {
  const initial = {recipe: [prefix, windowStep(1)], factories: [], materials: [], model: {gridShape: [8, 8, 8], voxelSizeNm: 10}, uiState: {}};
  const network = new TcadApiError('unknown execution outcome', {status: 0, code: 'network_error'});
  const api = {init: vi.fn().mockResolvedValueOnce(initial).mockRejectedValue(network),
    getTimeline: vi.fn(async () => {throw network;}),
    runAll: vi.fn(async () => {throw network;}), runTo: vi.fn(async () => {throw network;}),
  } as unknown as TcadApi;
  function Harness() {
    const {state, actions} = useAppState();
    return <><button onClick={() => void (operation === 'all' ? actions.runAll() : actions.runTo(1))}>Run</button><output data-testid="phase">{state.phase}</output><ParameterPanel step={state.recipe[1] ?? null} collapsed={false} /></>;
  }
  render(<I18nProvider><AppStateProvider api={api}><Harness /></AppStateProvider></I18nProvider>);
  expect(await screen.findByText('395 nm')).toBeVisible(); fireEvent.click(screen.getByText('Run'));
  await waitFor(() => expect(api.init).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
  expect(screen.queryByText('395 nm')).not.toBeInTheDocument();
  expect(screen.getByText('未解析（需以当前输入成功构建）')).toBeVisible();
  const fresh = {...windowStep(1), executionResult: {referenceZNm: 405}};
  api.runAll = vi.fn(async () => ({recipe: [prefix, fresh]}));
  api.runTo = vi.fn(async () => ({index: 1, recipe: [prefix, fresh]}));
  api.getTimeline = vi.fn(async () => ({items: [], current: -1}));
  fireEvent.click(screen.getByText('Run')); expect(await screen.findByText('405 nm')).toBeVisible();
});
