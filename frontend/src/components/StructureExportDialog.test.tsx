import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {InitView, RuntimeStatus, StepView, TcadApi, TimelineView} from '../api/types';
import {AppStateProvider, useAppState, type AppStateContextValue} from '../state/AppStateContext';
import {I18nProvider} from '../i18n/I18nContext';
import {Toolbar} from './Toolbar';
function step(index: number, overrides: Partial<StepView> = {}): StepView {
  return {
    index,
    name: `step-${index}`,
    instanceName: `Step ${index}`,
    group: '',
    loop: '',
    enabled: true,
    params: {dose: 100 + index},
    parameterSpecs: [],
    runtimeStatus: 'ready',
    ...overrides,
  };
}

const initView: InitView = {
  recipe: [step(0), step(1)],
  model: {gridShape: [8, 8, 8], voxelSizeNm: 10},
  factories: ['deposit'],
  materials: [],
  uiState: {},
};

const timeline: TimelineView = {
  items: [
    {index: 0, state: 'done', runtimeStatus: 'done', snapshotValid: true},
    {index: 1, state: 'current', runtimeStatus: 'ready', snapshotValid: false},
  ],
  current: 1,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

function apiStub(overrides: Partial<TcadApi> = {}): TcadApi {
  return {
    init: vi.fn(async () => initView),
    setStep: vi.fn(async request => ({
      step: step(request.index),
      statuses: ['ready', 'ready'] as RuntimeStatus[],
      warnings: [],
    })),
    runStep: vi.fn(async () => ({})),
    runTo: vi.fn(async () => ({})),
    runAll: vi.fn(async () => ({})),
    undo: vi.fn(async () => ({applied: false, log: []})),
    redo: vi.fn(async () => ({applied: false, log: []})),
    importRecipe: vi.fn(async () => ({
      model: initView.model,
      recipe: initView.recipe,
      currentRecipe: {name: 'Imported', id: ''},
      log: [],
    })),
    newRecipe: vi.fn(async () => ({
      model: initView.model,
      recipe: initView.recipe,
      currentRecipe: {name: 'New', id: ''},
      log: [],
    })),
    saveRecipe: vi.fn(async () => ({saved: true})),
    addStep: vi.fn(async () => initView.recipe),
    removeStep: vi.fn(async () => initView.recipe),
    duplicateStep: vi.fn(async () => initView.recipe),
    moveStep: vi.fn(async () => initView.recipe),
    renameStep: vi.fn(async index => step(Math.trunc(Number(index)))),
    uploadMask: vi.fn(async () => ({
      step: step(0),
      statuses: ['ready', 'ready'] as RuntimeStatus[],
      warnings: [],
    })),
    listMaskAssets: vi.fn(async () => []),
    getMaskAsset: vi.fn(async () => { throw new Error('unused'); }),
    saveAndApplyMaskAsset: vi.fn(async () => { throw new Error('unused'); }),
    importAndApplyMaskAsset: vi.fn(async () => { throw new Error('unused'); }),
    deleteMaskAsset: vi.fn(async () => {}),
    exportMaskAsset: vi.fn(async () => new Blob()),
    exportRecipe: vi.fn(async () => new Blob(['{}'], {type: 'application/json'})),
    loadRecipe: vi.fn(async () => ({
      model: initView.model,
      recipe: initView.recipe,
      currentRecipe: {name: 'Loaded', id: 'h1'},
      log: [],
    })),
    getTimeline: vi.fn(async () => timeline),
    restoreTimeline: vi.fn(async index => ({
      timeline: {...timeline, current: index},
      model: initView.model,
      recipe: initView.recipe,
      log: [],
    })),
    getPreviewManifest: vi.fn(async () => ({revision: 1, meshes: []})),
    getMaterialStl: vi.fn(async () => new ArrayBuffer(0)),
    ...overrides,
  };
}



let captured: AppStateContextValue;
function Capture() {captured = useAppState(); return null;}
const packed = {zipFile: 'current.zip', files: ['/private/staging/do-not-display/Si.stl']};
function exporting(overrides: Partial<TcadApi> = {}) {return apiStub({prepareStructureExport: vi.fn(async () => packed), downloadStructureExport: vi.fn(async () => new Blob(['PK\x03\x04valid'])), ...overrides});}
async function mount(api = exporting()) {
  const view = render(<I18nProvider><AppStateProvider api={api}><Capture /><Toolbar api={api} parametersCollapsed={false} onToggleParameters={() => {}} /></AppStateProvider></I18nProvider>);
  await waitFor(() => expect(captured.state.phase).toBe('ready'));
  const entry = screen.getByRole('button', {name: '导出结构'}); entry.focus(); fireEvent.click(entry);
  const dialog = screen.getByRole('dialog', {name: '导出结构'});
  return {view, api, entry, dialog};
}
beforeEach(() => {localStorage.setItem('tcad.locale.v1', 'zh-CN'); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});});
afterEach(() => {vi.restoreAllMocks();});

it('explains complete materials, µm and mesh quality; open/cancel make no requests and restore focus', async () => {
  const {api, entry, dialog} = await mount();
  expect(within(dialog).getByText(/全部材料按材料拆分 STL/)).toHaveTextContent('µm');
  expect(within(dialog).getByText(/BRep/)).toBeInTheDocument();
  expect(dialog).toHaveAttribute('open');
  expect(api.prepareStructureExport).not.toHaveBeenCalled(); expect(api.runAll).not.toHaveBeenCalled(); expect(api.saveRecipe).not.toHaveBeenCalled();
  fireEvent(dialog, new Event('cancel', {cancelable: true}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(entry).toHaveFocus();
});

it.each(['ready', 'dirty', 'error', 'running'] as const)('requires confirmation for enabled %s steps, including forced submit', async runtimeStatus => {
  const api = exporting({init: vi.fn(async () => ({...initView, recipe: [step(0, {runtimeStatus})]}))});
  const {dialog} = await mount(api);
  const submit = within(dialog).getByRole('button', {name: '导出当前结构'});
  expect(submit).toBeDisabled(); fireEvent.submit(dialog.querySelector('form')!);
  await act(async () => {await Promise.resolve();}); expect(api.prepareStructureExport).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('checkbox'));
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  expect(await within(dialog).findByText('ZIP 下载已触发。')).toBeInTheDocument();
});

it('warns for a built wafer alone, while disabled unbuilt steps do not force confirmation', async () => {
  const api = exporting({init: vi.fn(async () => ({...initView, recipe: [step(0, {name: 'Structure Wafer', runtimeStatus: 'done'})]}))});
  const {view, dialog} = await mount(api);
  expect(within(dialog).getByRole('checkbox')).toBeInTheDocument(); view.unmount();
  const complete = exporting({init: vi.fn(async () => ({...initView, recipe: [step(0, {runtimeStatus: 'done'}), step(1, {enabled: false})]}))});
  const result = await mount(complete);
  expect(within(result.dialog).queryByRole('checkbox')).not.toBeInTheDocument();
  expect(within(result.dialog).getByRole('button', {name: '导出当前结构'})).toBeEnabled();
});

it('keeps ACK on locale and display changes but invalidates it when recipe changes', async () => {
  const {api, dialog} = await mount(exporting({renameStep: vi.fn(async index => step(index, {instanceName: 'Changed'}))}));
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', {name: 'EN'}));
  expect(within(dialog).getByRole('checkbox')).toBeChecked();
  expect(screen.getByRole('dialog', {name: 'Export structure'})).toBe(dialog);
  act(() => {captured.actions.setDisplayReady(null, false);});
  expect(within(dialog).getByRole('checkbox')).toBeChecked();
  await act(async () => {await captured.actions.renameStep('Changed');});
  expect(within(dialog).getByRole('checkbox')).not.toBeChecked();
  fireEvent.submit(dialog.querySelector('form')!);
  expect(api.prepareStructureExport).not.toHaveBeenCalled();
});

it('shows history snapshot identity and exports without moving it', async () => {
  const api = exporting({getTimeline: vi.fn(async () => timeline)});
  const {dialog} = await mount(api);
  await act(async () => {await captured.actions.loadTimeline();});
  await act(async () => {await captured.actions.restoreTimeline(0);});
  expect(within(dialog).getByText(/当前查看历史快照：步骤 1/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', {name: '导出当前结构'}));
  await within(dialog).findByText('ZIP 下载已触发。');
  expect(captured.state.historicalStepIndex).toBe(0);
});

it('double clicks pack once, reports each stage and blocks close/Escape until download finishes', async () => {
  const packaging = deferred<typeof packed>(); const downloading = deferred<Blob>();
  const api = exporting({prepareStructureExport: vi.fn(() => packaging.promise), downloadStructureExport: vi.fn(() => downloading.promise)});
  const {dialog} = await mount(api); fireEvent.click(within(dialog).getByRole('checkbox'));
  const submit = within(dialog).getByRole('button', {name: '导出当前结构'});
  fireEvent.click(submit); fireEvent.click(submit); fireEvent.submit(dialog.querySelector('form')!);
  expect(api.prepareStructureExport).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByText('正在打包…')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', {name: '关闭'})).toBeDisabled(); fireEvent(dialog, new Event('cancel', {cancelable: true})); expect(dialog).toBeInTheDocument();
  await act(async () => {packaging.resolve(packed); await packaging.promise;});
  expect(within(dialog).getByText('正在下载…')).toBeInTheDocument(); expect(api.downloadStructureExport).toHaveBeenCalledTimes(1);
  await act(async () => {downloading.resolve(new Blob(['PKzip'])); await downloading.promise;});
  expect(within(dialog).getByText('ZIP 下载已触发。')).toBeInTheDocument(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export');
  expect(dialog).not.toHaveTextContent('/private/staging');
});

it.each(['pack', 'download'] as const)('%s failure stays local, holds dialog open and retries only when clicked', async phase => {
  const failure = new Error('private/staging/secret');
  const api = exporting(phase === 'pack' ? {prepareStructureExport: vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(packed)} : {downloadStructureExport: vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(new Blob(['PKzip']))});
  const {dialog} = await mount(api); fireEvent.click(within(dialog).getByRole('checkbox')); fireEvent.click(within(dialog).getByRole('button', {name: '导出当前结构'}));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('结构导出失败');
  expect(within(dialog).queryByText('ZIP 下载已触发。')).not.toBeInTheDocument();
  expect(captured.state.globalError).toBeNull(); expect(api.prepareStructureExport).toHaveBeenCalledTimes(1);
  expect(dialog).not.toHaveTextContent('private/staging');
  fireEvent.click(within(dialog).getByRole('button', {name: '重新导出'}));
  expect(await within(dialog).findByText('ZIP 下载已触发。')).toBeInTheDocument(); expect(api.prepareStructureExport).toHaveBeenCalledTimes(2);
});

it('unmounts during download without a download click or temporary URL', async () => {
  const downloading = deferred<Blob>(); const api = exporting({downloadStructureExport: vi.fn(() => downloading.promise)});
  const {view, dialog} = await mount(api); fireEvent.click(within(dialog).getByRole('checkbox')); fireEvent.click(within(dialog).getByRole('button', {name: '导出当前结构'}));
  await within(dialog).findByText('正在下载…'); const signal = vi.mocked(api.downloadStructureExport!).mock.calls[0][1]!;
  view.unmount(); await act(async () => {await Promise.resolve();}); expect(signal.aborted).toBe(true);
  await act(async () => {downloading.resolve(new Blob(['PKzip'])); await downloading.promise;});
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
