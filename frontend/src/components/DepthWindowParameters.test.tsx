import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import templates from '../test/structureFactoryTemplates.json';
import {parseStepListEnvelope} from '../api/schemas';
import type {StepView, TcadApi} from '../api/types';
import {AppStateProvider, useAppState} from '../state/AppStateContext';
import {I18nProvider, useI18n} from '../i18n/I18nContext';
import {ParameterPanel} from './ParameterPanel';
import {AddStepDialog} from './AddStepDialog';
import {presentStep} from './stepPresentation';
import {parameterIsActive, parameterValues} from './parameterActivity';

function etch(params: Record<string, unknown> = {}): StepView {
  const step = parseStepListEnvelope({ok: true, result: templates}).find(step => step.name === 'Structure Etch')!;
  const merged = {...step.params, ...params}; Object.entries(params).forEach(([key, value]) => {if (value === undefined) delete merged[key];});
  return {...step, index: 0, params: merged};
}
function Harness() {
  const {state, actions} = useAppState(); const {setLocale} = useI18n();
  return <><button onClick={() => setLocale('en')}>English</button><button onClick={() => void actions.applyAndRunTo(0)}>Apply</button><button onClick={() => void actions.runStep(0)}>Run step</button><button onClick={() => void actions.runAll()}>Run all</button><button onClick={() => actions.updateDraft(0, 'unknown', 1)}>Unknown draft</button><button onClick={() => actions.updateDraft(99, 'depth_nm', 1)}>Unknown index</button><button onClick={() => actions.updateDraft(0, 'depth_nm', 'bad', {status: 'invalid'})}>Prefix draft</button><output data-testid="drafts">{JSON.stringify(state.drafts)}</output><output role="alert">{state.globalError?.code}</output><ParameterPanel step={state.recipe[state.selectedStepIndex ?? 0] ?? null} collapsed={false} /></>;
}
async function mount(params: Record<string, unknown> = {}, extraSteps: StepView[] = []) {
  let current = etch(params);
  const api = {init: vi.fn(async () => ({recipe: [current, ...extraSteps], factories: ['Structure Etch'], factoryTemplates: [etch()], model: {gridShape: [8, 8, 8], voxelSizeNm: 10}, materials: [{id: 1, name: 'Silicon', color: [1,1,1], enabled: true}], uiState: {}})),
    setStep: vi.fn(async request => {current = {...current, params: {...current.params, ...request.params}, runtimeStatus: 'dirty'}; return {step: current, statuses: ['dirty'], warnings: []};}),
    getTimeline: vi.fn(async () => ({items: [], current: -1})), runTo: vi.fn(async () => ({})),
  } as unknown as TcadApi;
  render(<I18nProvider><AppStateProvider api={api}><Harness /></AppStateProvider></I18nProvider>);
  await screen.findByLabelText('材料'); return api;
}
afterEach(() => {vi.useRealTimers(); localStorage.clear();});

it('renders only Standard fields and uses factory controller defaults', async () => {
  await mount({etch_mode: undefined});
  expect(screen.getByLabelText('刻蚀深度')).toBeVisible();
  expect(screen.queryByLabelText('Start depth')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('深度参考')).not.toBeInTheDocument();
});
it('renders Opening plane and Fixed Z fields using all activity conditions', async () => {
  const api = await mount({etch_mode: 'Depth window'});
  expect(screen.queryByLabelText('刻蚀深度')).not.toBeInTheDocument();
  expect(screen.getByLabelText('起始深度（孔口向下）')).toBeVisible();
  expect(screen.queryByLabelText('下界 Z')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('深度参考'), {target: {value: '1'}});
  expect(screen.getByLabelText('下界 Z')).toBeVisible();
  expect(screen.queryByLabelText('起始深度（孔口向下）')).not.toBeInTheDocument();
  fireEvent.blur(screen.getByLabelText('深度参考'));
  await waitFor(() => expect(api.setStep).toHaveBeenCalled());
  expect(api.runTo).not.toHaveBeenCalled();
});
it('retains hidden invalid drafts while saving and applying active fields', async () => {
  const api = await mount({etch_mode: 'Depth window'});
  fireEvent.change(screen.getByLabelText('起始深度（孔口向下）'), {target: {value: 'bad'}});
  fireEvent.change(screen.getByLabelText('刻蚀模式'), {target: {value: '0'}});
  fireEvent.blur(screen.getByLabelText('刻蚀模式'));
  await waitFor(() => expect(api.setStep).toHaveBeenCalled());
  expect(vi.mocked(api.setStep).mock.calls[0][0].params).toEqual({etch_mode: 'Standard', start_depth_nm: 'bad'});
  fireEvent.click(screen.getByText('Apply'));
  await waitFor(() => expect(api.runTo).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('刻蚀模式'), {target: {value: '1'}});
  fireEvent.blur(screen.getByLabelText('刻蚀模式'));
  expect(screen.getByLabelText('起始深度（孔口向下）')).toHaveValue('bad');
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('invalid_draft'));
  expect(api.setStep).toHaveBeenCalledTimes(1);
});
it('atomically saves both interval drafts and suppresses obsolete inactive timers', async () => {
  const api = await mount({etch_mode: 'Depth window'});
  fireEvent.change(screen.getByLabelText('起始深度（孔口向下）'), {target: {value: '250'}});
  fireEvent.change(screen.getByLabelText('终止深度（孔口向下）'), {target: {value: '350'}});
  fireEvent.blur(screen.getByLabelText('终止深度（孔口向下）'));
  await waitFor(() => expect(api.setStep).toHaveBeenCalledTimes(1));
  expect(vi.mocked(api.setStep).mock.calls[0][0].params).toEqual({start_depth_nm: 250, end_depth_nm: 350});
  fireEvent.change(screen.getByLabelText('起始深度（孔口向下）'), {target: {value: '260'}});
  fireEvent.change(screen.getByLabelText('深度参考'), {target: {value: '1'}});
  fireEvent.blur(screen.getByLabelText('深度参考'));
  await waitFor(() => expect(api.setStep).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.setStep).mock.calls[1][0].params).toEqual({depth_reference: 'Fixed Z', start_depth_nm: 260});
  await act(async () => {await new Promise(resolve => setTimeout(resolve, 400));});
  expect(api.setStep).toHaveBeenCalledTimes(2);
});
it('synchronizes fractional directionality slider and number across language changes', async () => {
  const api = await mount({etch_mode: 'Depth window'});
  fireEvent.change(screen.getByRole('slider', {name: '方向性'}), {target: {value: '37.5'}});
  expect(screen.getByLabelText('方向性', {selector: 'input[type=text]'})).toHaveValue('37.5');
  fireEvent.click(screen.getByText('English'));
  expect(screen.getByRole('slider', {name: 'Directionality'})).toHaveValue('37.5');
  fireEvent.keyDown(screen.getByRole('slider'), {key: 'Enter'});
  await waitFor(() => expect(api.setStep).toHaveBeenCalledWith(expect.objectContaining({params: {directionality_percent: 37.5}}), expect.any(AbortSignal)));
  expect(screen.getByText('0% isotropic · 100% downward')).toBeVisible();
});
it('candidate add/type forms validate only active fields and preserve hidden drafts', () => {
  const confirm = vi.fn();
  render(<I18nProvider><AddStepDialog template={etch({start_depth_nm: 'bad'})} busy={false} inline onConfirm={confirm} onCancel={() => {}} /></I18nProvider>);
  expect(screen.queryByLabelText(/起始深度/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: '确认替换'})).toBeEnabled();
  fireEvent.change(screen.getByLabelText('刻蚀模式'), {target: {value: '1'}});
  expect(screen.getByLabelText(/起始深度/, {selector: 'input'})).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', {name: '确认替换'})).toBeDisabled();
});
it('presents window interval/distance without inactive Standard depth', () => {
  const view = presentStep(etch({etch_mode: 'Depth window', depth_nm: 98765}), [], 'en');
  expect(view.title).toContain('100–200'); expect(view.title).not.toContain('98765');
  expect(view.description).toContain('existing');
});
it('shows trusted Python reference and hides it on any input-prefix draft', async () => {
  const result = etch({etch_mode: 'Depth window'});
  const api = {init: vi.fn(async () => ({recipe: [{...result, executionResult: {referenceZNm: 395}, runtimeStatus: 'done'}], factories: [], model: {gridShape: [8,8,8], voxelSizeNm: 10}, materials: [], uiState: {}})), getTimeline: vi.fn(async () => ({items: [], current: -1}))} as unknown as TcadApi;
  render(<I18nProvider><AppStateProvider api={api}><Harness /></AppStateProvider></I18nProvider>);
  expect(await screen.findByText('395 nm')).toBeVisible();
  fireEvent.change(screen.getByLabelText('刻蚀距离'), {target: {value: 'bad'}});
  expect(screen.queryByText('395 nm')).not.toBeInTheDocument();
  expect(screen.getByText('未解析（需以当前输入成功构建）')).toBeVisible();
});
it('keeps independent length units and canonical drafts through mode and language changes', async () => {
  const api = await mount({etch_mode: 'Depth window'});
  fireEvent.change(screen.getByLabelText('Start depth 单位'), {target: {value: 'µm'}});
  fireEvent.change(screen.getByLabelText('起始深度（孔口向下）'), {target: {value: '0.15'}});
  fireEvent.change(screen.getByLabelText('刻蚀模式'), {target: {value: '0'}});
  fireEvent.change(screen.getByLabelText('刻蚀模式'), {target: {value: '1'}});
  expect(screen.getByLabelText('起始深度（孔口向下）')).toHaveValue('0.15');
  expect(screen.getByLabelText('End depth 单位')).toHaveValue('nm');
  fireEvent.click(screen.getByText('English'));
  expect(screen.getByLabelText('Start depth (below opening)')).toHaveValue('0.15');
  fireEvent.blur(screen.getByLabelText('Start depth (below opening)'));
  await waitFor(() => expect(api.setStep).toHaveBeenCalledWith(expect.objectContaining({params: {start_depth_nm: 150, etch_mode: 'Depth window'}}), expect.any(AbortSignal)));
});
it('edits a real canonical numeric material ID without rejecting known registry values', async () => {
  const api = await mount({etch_mode: 'Depth window', material: 1});
  fireEvent.change(screen.getByLabelText('刻蚀距离'), {target: {value: '35'}});
  fireEvent.blur(screen.getByLabelText('刻蚀距离'));
  await waitFor(() => expect(api.setStep).toHaveBeenCalledWith({index: 0, params: {etch_distance_nm: 35}}, expect.any(AbortSignal)));
});
it('preserves explicit null values while only missing controllers use factory defaults', () => {
  const step = etch({etch_mode: null, start_depth_nm: null});
  const values = parameterValues(step);
  expect(values.etch_mode).toBeNull(); expect(values.start_depth_nm).toBeNull();
  expect(parameterIsActive(step.parameterSpecs.find(spec => spec.key === 'depth_nm')!, step.parameterSpecs, values)).toBe(false);
});
it.each(['Unknown draft', 'Unknown index'])('keeps %s blocked when applying', async label => {
  const api = await mount(); fireEvent.click(screen.getByText(label)); fireEvent.click(screen.getByText('Apply'));
  expect(screen.getByRole('alert')).toHaveTextContent('invalid_draft'); expect(api.setStep).not.toHaveBeenCalled(); expect(api.runTo).not.toHaveBeenCalled();
});
it('candidate forms read independent saved units and submit canonical lengths', () => {
  localStorage.setItem('tcad.unit.v1:Structure Etch:start_depth_nm', 'µm');
  const confirm = vi.fn();
  render(<I18nProvider><AddStepDialog template={etch({etch_mode: 'Depth window'})} busy={false} inline onConfirm={confirm} onCancel={() => {}} /></I18nProvider>);
  expect(screen.getByLabelText('起始深度（孔口向下）（µm）')).toHaveValue('0.1');
  expect(screen.getByLabelText('终止深度（孔口向下）单位')).toHaveValue('nm');
  fireEvent.click(screen.getByRole('button', {name: '确认替换'}));
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({params: expect.objectContaining({start_depth_nm: 100, end_depth_nm: 200})}));
});
it('candidate forms show the exact hidden bad text when reactivated', () => {
  render(<I18nProvider><AddStepDialog template={etch({start_depth_nm: 'bad'})} busy={false} inline onConfirm={async () => {}} onCancel={() => {}} /></I18nProvider>);
  fireEvent.change(screen.getByLabelText('刻蚀模式'), {target: {value: '1'}});
  expect(screen.getByLabelText(/起始深度/, {selector: 'input'})).toHaveValue('bad');
});
it('hides a completed downstream reference after an upstream invalid draft', async () => {
  const upstream = etch(); const downstream = {...etch({etch_mode: 'Depth window'}), index: 1, executionResult: {referenceZNm: 395}, runtimeStatus: 'done'};
  function DownstreamHarness() {const {state, actions} = useAppState(); return <><button onClick={() => actions.updateDraft(0, 'depth_nm', 'bad', {status: 'invalid'})}>Edit prefix</button><ParameterPanel step={state.recipe[1] ?? null} collapsed={false} /></>;}
  const api = {init: vi.fn(async () => ({recipe: [upstream, downstream], factories: [], model: {gridShape: [8,8,8], voxelSizeNm: 10}, materials: [], uiState: {}})), getTimeline: vi.fn(async () => ({items: [], current: -1}))} as unknown as TcadApi;
  render(<I18nProvider><AppStateProvider api={api}><DownstreamHarness /></AppStateProvider></I18nProvider>);
  expect(await screen.findByText('395 nm')).toBeVisible(); fireEvent.click(screen.getByText('Edit prefix'));
  expect(screen.queryByText('395 nm')).not.toBeInTheDocument();
});
it.each([['Apply', 'runTo'], ['Run step', 'runStep'], ['Run all', 'runAll']] as const)('%s consumes the authoritative successful recipe result', async (button, method) => {
  const api = await mount({etch_mode: 'Depth window'});
  api[method] = vi.fn(async () => ({recipe: [{...etch({etch_mode: 'Depth window'}), runtimeStatus: 'done' as const, executionResult: {referenceZNm: 395}}]}));
  fireEvent.click(screen.getByText(button));
  expect(await screen.findByText('395 nm')).toBeVisible();
});
it('preserves canonical inactive candidate lengths while persisting invalid raw text', () => {
  const confirm = vi.fn();
  render(<I18nProvider><AddStepDialog template={etch({etch_mode: 'Depth window'})} busy={false} inline onConfirm={confirm} onCancel={() => {}} /></I18nProvider>);
  fireEvent.change(screen.getByLabelText('起始深度（孔口向下）单位'), {target: {value: 'µm'}});
  fireEvent.change(screen.getByLabelText('起始深度（孔口向下）（µm）'), {target: {value: '0.15'}});
  fireEvent.change(screen.getByLabelText('终止深度（孔口向下）（nm）'), {target: {value: 'bad'}});
  fireEvent.change(screen.getByLabelText('深度参考'), {target: {value: '1'}});
  fireEvent.click(screen.getByRole('button', {name: '确认替换'}));
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({params: expect.objectContaining({depth_reference: 'Fixed Z', start_depth_nm: 150, end_depth_nm: 'bad'})}));
});
it('preserves inactive boolean/null drafts and rejects their numeric activation', () => {
  const confirm = vi.fn();
  render(<I18nProvider><AddStepDialog template={etch({etch_mode: 'Depth window', depth_reference: 'Fixed Z', start_depth_nm: true, end_depth_nm: null})} busy={false} inline onConfirm={confirm} onCancel={() => {}} /></I18nProvider>);
  fireEvent.click(screen.getByRole('button', {name: '确认替换'}));
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({params: expect.objectContaining({start_depth_nm: true, end_depth_nm: null})}));
});
it('rejects active boolean/null numeric candidate values without coercion', () => {
  render(<I18nProvider><AddStepDialog template={etch({etch_mode: 'Depth window', start_depth_nm: true, end_depth_nm: null})} busy={false} inline onConfirm={async () => {}} onCancel={() => {}} /></I18nProvider>);
  expect(screen.getByRole('button', {name: '确认替换'})).toBeDisabled();
  expect(screen.getByLabelText(/起始深度/, {selector: 'input'})).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText(/终止深度/, {selector: 'input'})).toHaveAttribute('aria-invalid', 'true');
});
it('localizes window controller choices without changing canonical values', async () => {
  await mount({etch_mode: 'Depth window'});
  expect(screen.getByRole('option', {name: '深度区间（Depth window）'})).toHaveValue('1');
  expect(screen.getByRole('option', {name: '孔口平面（Opening plane）'})).toHaveValue('0');
  fireEvent.click(screen.getByText('English'));
  expect(screen.getByRole('option', {name: 'Depth window'})).toHaveValue('1');
});
it('serializes a controller switch behind an in-flight batch without losing newer interval drafts', async () => {
  const api = await mount({etch_mode: 'Depth window'});
  let finish!: (value: import('../api/types').SetStepView) => void;
  const first = new Promise<import('../api/types').SetStepView>(resolve => {finish = resolve;});
  let current = etch({etch_mode: 'Depth window'});
  vi.mocked(api.setStep).mockImplementationOnce(() => first).mockImplementation(async request => {
    current = {...current, params: {...current.params, ...request.params}, runtimeStatus: 'dirty'};
    return {step: current, statuses: ['dirty'], warnings: []};
  });
  fireEvent.change(screen.getByLabelText('刻蚀距离'), {target: {value: '35'}});
  fireEvent.blur(screen.getByLabelText('刻蚀距离'));
  await waitFor(() => expect(api.setStep).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('起始深度（孔口向下）'), {target: {value: 'bad'}});
  fireEvent.change(screen.getByLabelText('深度参考'), {target: {value: '1'}});
  fireEvent.change(screen.getByLabelText('下界 Z'), {target: {value: '250'}});
  fireEvent.change(screen.getByLabelText('上界 Z'), {target: {value: '350'}});
  fireEvent.blur(screen.getByLabelText('上界 Z'));
  fireEvent.click(screen.getByText('Apply'));
  await act(async () => {current = {...current, params: {...current.params, etch_distance_nm: 35}, runtimeStatus: 'dirty'}; finish({step: current, statuses: ['dirty'], warnings: []});});
  await waitFor(() => expect(api.runTo).toHaveBeenCalledTimes(1));
  expect(api.setStep).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.setStep).mock.calls[1][0].params).toEqual({start_depth_nm: 'bad', depth_reference: 'Fixed Z', lower_z_nm: 250, upper_z_nm: 350});
  expect(screen.getByTestId('drafts')).toHaveTextContent('{}');
});
it('rejects directionality outside 0..100 without clamping the numeric draft', async () => {
  const api = await mount({etch_mode: 'Depth window'});
  const input = screen.getByLabelText('方向性', {selector: 'input[type=text]'});
  fireEvent.change(input, {target: {value: '100.1'}}); fireEvent.blur(input);
  expect(input).toHaveValue('100.1'); expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(api.setStep).not.toHaveBeenCalled();
  fireEvent.change(input, {target: {value: '100'}}); fireEvent.keyDown(input, {key: 'Enter'});
  await waitFor(() => expect(api.setStep).toHaveBeenCalledWith({index: 0, params: {directionality_percent: 100}}, expect.any(AbortSignal)));
  fireEvent.change(input, {target: {value: '0'}}); fireEvent.blur(input);
  await waitFor(() => expect(api.setStep).toHaveBeenCalledWith({index: 0, params: {directionality_percent: 0}}, expect.any(AbortSignal)));
});
it('hides downstream results after a failed input-prefix step', async () => {
  const upstream = {...etch(), runtimeStatus: 'error'};
  const downstream = {...etch({etch_mode: 'Depth window'}), index: 1, executionResult: {referenceZNm: 395}, runtimeStatus: 'done'};
  function Downstream() {const {state} = useAppState(); return <ParameterPanel step={state.recipe[1] ?? null} collapsed={false} />;}
  const api = {init: vi.fn(async () => ({recipe: [upstream, downstream], factories: [], model: {gridShape: [8,8,8], voxelSizeNm: 10}, materials: [], uiState: {}})), getTimeline: vi.fn(async () => ({items: [], current: -1}))} as unknown as TcadApi;
  render(<I18nProvider><AppStateProvider api={api}><Downstream /></AppStateProvider></I18nProvider>);
  expect(await screen.findByText('未解析（需以当前输入成功构建）')).toBeVisible();
  expect(screen.queryByText('395 nm')).not.toBeInTheDocument();
});
