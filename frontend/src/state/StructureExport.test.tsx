import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TcadApiError} from '../api/client';
import type {InitView, RuntimeStatus, StepView, TcadApi, TimelineView} from '../api/types';
import {AppStateProvider, useAppState, type AppStateContextValue} from './AppStateContext';
import type {AppState} from './appReducer';
import {MaskWorkbench} from '../mask/MaskWorkbench';
import type {MaskAsset} from '../api/types';
import {ParameterPanel} from '../components/ParameterPanel';
import {parseStepListEnvelope} from '../api/schemas';
import templates from '../test/structureFactoryTemplates.json';
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
async function mount(api: TcadApi) {
  const view = render(<AppStateProvider api={api}><Capture /></AppStateProvider>);
  await waitFor(() => expect(captured.state.phase).toBe('ready'));
  return view;
}
function source(state: AppState) {return {recipe: state.recipe, model: state.model, historicalStepIndex: state.historicalStepIndex, previewGeneration: state.previewGeneration, lastModelRevision: state.lastModelRevision};}
function exportAction(acknowledged = true, snapshot = source(captured.state), progress = vi.fn()) {
  const action = (captured.actions as typeof captured.actions & {exportStructure?: (confirmation: {source: ReturnType<typeof source>; acknowledged: boolean}, progress: (phase: 'packing' | 'downloading') => void) => Promise<{ok: boolean; error?: TcadApiError}>}).exportStructure;
  expect(action, 'provider must offer a guarded export action').toBeTypeOf('function');
  return action!({source: snapshot, acknowledged}, progress);
}
const packageResult = {zipFile: 'current.zip', files: ['/private/staging/Si.stl']};
const blob = () => new Blob(['PK\x03\x04archive'], {type: 'application/zip'});
function exportApi(overrides: Partial<TcadApi> = {}) {return apiStub({prepareStructureExport: vi.fn(async () => packageResult), downloadStructureExport: vi.fn(async () => blob()), ...overrides});}
const click = vi.fn();
beforeEach(() => {click.mockClear(); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click); vi.stubGlobal('URL', class extends URL {static createObjectURL = vi.fn(() => 'blob:structure'); static revokeObjectURL = vi.fn();});});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

describe('current structure export provider', () => {
  it('holds the existing mutation gate through package and download, preserves references and emits one ZIP', async () => {
    const packing = deferred<typeof packageResult>(); const downloading = deferred<Blob>();
    const recipe = [step(0, {params: {mode: 'Standard', dose: 100}, parameterSpecs: [
      {key: 'mode', label: 'Mode', type: 'choice', choices: [['Standard', 'Standard'], ['Window', 'Window']]},
      {key: 'dose', label: 'Dose', type: 'float', activeWhen: {mode: 'Window'}},
    ]}), step(1)];
    const api = exportApi({init: vi.fn(async () => ({...initView, recipe})), prepareStructureExport: vi.fn(() => packing.promise), downloadStructureExport: vi.fn(() => downloading.promise)});
    await mount(api);
    act(() => {captured.actions.updateDraft(0, 'dose', 200);});
    await act(async () => {await captured.actions.loadTimeline();});
    vi.mocked(api.getTimeline).mockClear();
    const before = captured.state; const progress = vi.fn(); let operation!: ReturnType<typeof exportAction>;
    act(() => {operation = exportAction(true, source(before), progress);});
    expect(captured.state.activeMutation).toBe('export');
    await act(async () => {
      await captured.actions.runAll(); await captured.actions.runStep(); await captured.actions.runTo(); await captured.actions.applyAndRunTo();
      await captured.actions.addStep('Structure Deposit'); await captured.actions.removeStep(); await captured.actions.duplicateStep(); await captured.actions.moveStep('up'); await captured.actions.renameStep('blocked');
      await captured.actions.saveRecipe('blocked'); await captured.actions.saveParameter(0, 'dose');
      await captured.actions.uploadMask(new File(['x'], 'mask.json'));
      await captured.actions.importRecipe({recipe: {}}); await captured.actions.undo(); await captured.actions.redo();
      await captured.actions.restoreTimeline(0); await captured.actions.loadTimeline();
      expect(captured.actions.updateDraft(0, 'dose', 200)).toBe(0);
      await exportAction();
    });
    for (const request of [api.runAll, api.runStep, api.runTo, api.setStep, api.saveRecipe, api.uploadMask, api.importRecipe, api.undo, api.redo, api.restoreTimeline, api.getTimeline, api.addStep, api.removeStep, api.duplicateStep, api.moveStep, api.renameStep]) expect(request).not.toHaveBeenCalled();
    expect(api.prepareStructureExport).toHaveBeenCalledTimes(1);
    expect(api.downloadStructureExport).not.toHaveBeenCalled();
    await act(async () => {packing.resolve(packageResult); await packing.promise;});
    expect(progress.mock.calls.map(args => args[0])).toEqual(['packing', 'downloading']);
    expect(captured.state.activeMutation).toBe('export');
    await act(async () => {downloading.resolve(blob()); await operation;});
    expect(captured.state.phase).toBe('ready');
    for (const key of ['recipe', 'model', 'timeline', 'globalError', 'stepErrors', 'previewGeneration', 'lastModelRevision', 'historicalStepIndex', 'lastRunResult'] as const) expect(captured.state[key]).toBe(before[key]);
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:structure');
  });

  it('does not clear prior errors or execution results on package failure or retry', async () => {
    const prior = new TcadApiError('old', {status: 400, code: 'step_failed'});
    const api = exportApi({runAll: vi.fn(async () => {throw prior;}), prepareStructureExport: vi.fn().mockRejectedValueOnce(new Error('pack')).mockResolvedValue(packageResult)});
    await mount(api); await act(async () => {await captured.actions.runAll();});
    const before = captured.state;
    await act(async () => {expect((await exportAction()).ok).toBe(false);});
    expect(captured.state.globalError).toBe(prior);
    expect(captured.state.recipe).toBe(before.recipe); expect(captured.state.stepErrors).toBe(before.stepErrors);
    expect(captured.state.previewGeneration).toBe(before.previewGeneration);
    await act(async () => {expect(await exportAction()).toEqual({ok: true});});
    expect(captured.state.globalError).toBe(prior);
    expect(api.getTimeline).toHaveBeenCalledTimes(1); // failed run reconciliation only
  });

  it('requires ACK for unbuilt and wafer-only models and rejects stale source even with ACK', async () => {
    const api = exportApi(); await mount(api);
    await act(async () => {expect((await exportAction(false)).ok).toBe(false);});
    const old = source(captured.state);
    await act(async () => {await captured.actions.runAll();});
    await act(async () => {expect((await exportAction(true, old)).ok).toBe(false);});
    expect(api.prepareStructureExport).not.toHaveBeenCalled();
  });

  it('retains historical snapshot and reference Z through successful download', async () => {
    const recipe = [step(0, {name: 'Structure Wafer', runtimeStatus: 'done'}), step(1, {runtimeStatus: 'done', executionResult: {referenceZNm: 395}})];
    const api = exportApi({getTimeline: vi.fn(async () => ({...timeline, items: timeline.items.map(item => ({...item, snapshotValid: true}))})), restoreTimeline: vi.fn(async () => ({timeline: {...timeline, current: 1}, model: initView.model, recipe, log: []}))});
    await mount(api); await act(async () => {await captured.actions.loadTimeline();}); await act(async () => {await captured.actions.restoreTimeline(1);});
    const before = captured.state;
    await act(async () => {expect(await exportAction()).toEqual({ok: true});});
    expect(captured.state.historicalStepIndex).toBe(1);
    expect(captured.state.recipe).toBe(before.recipe); expect(captured.state.recipe[1].executionResult).toEqual({referenceZNm: 395});
    expect(captured.state.timeline).toBe(before.timeline); expect(captured.state.model).toBe(before.model); expect(captured.state.previewGeneration).toBe(before.previewGeneration);
  });

  it.each(['draft', 'candidate', 'saving', 'running', 'unsupported', 'offline'] as const)('rejects forced exports while %s', async mode => {
    const pending = deferred<never>();
    const api = exportApi(mode === 'unsupported' ? {prepareStructureExport: undefined} : mode === 'offline' ? {init: vi.fn(async () => {throw new Error('offline');})} : {setStep: vi.fn(() => pending.promise), runAll: vi.fn(() => pending.promise)});
    const view = render(<AppStateProvider api={api}><Capture /></AppStateProvider>);
    await waitFor(() => expect(captured.state.phase).toBe(mode === 'offline' ? 'fatal' : 'ready'));
    act(() => {
      if (mode === 'draft' || mode === 'saving') captured.actions.updateDraft(0, 'dose', 200);
      if (mode === 'candidate') captured.actions.setTypeCandidate(0, true);
      if (mode === 'saving') void captured.actions.saveParameter(0, 'dose');
      if (mode === 'running') void captured.actions.runAll();
    });
    await act(async () => {expect((await exportAction()).ok).toBe(false);});
    if (api.prepareStructureExport) expect(api.prepareStructureExport).not.toHaveBeenCalled();
    expect(api.downloadStructureExport).not.toHaveBeenCalled();
    view.unmount();
  });

  it('download failure is local, manually retryable and never creates an URL for failure', async () => {
    const api = exportApi({downloadStructureExport: vi.fn().mockRejectedValueOnce(new Error('download')).mockResolvedValue(blob())}); await mount(api);
    await act(async () => {expect((await exportAction()).ok).toBe(false);});
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(api.prepareStructureExport).toHaveBeenCalledTimes(1);
    await act(async () => {expect(await exportAction()).toEqual({ok: true});});
    expect(api.prepareStructureExport).toHaveBeenCalledTimes(2);
  });

  it('aborts waiting on unmount and never downloads or creates an URL after late completion', async () => {
    const pending = deferred<typeof packageResult>(); const api = exportApi({prepareStructureExport: vi.fn(() => pending.promise)}); const view = await mount(api);
    let operation!: ReturnType<typeof exportAction>; act(() => {operation = exportAction();});
    const signal = vi.mocked(api.prepareStructureExport!).mock.calls[0][0]!;
    view.unmount(); await act(async () => {await Promise.resolve();}); expect(signal.aborted).toBe(true);
    await act(async () => {pending.resolve(packageResult); await operation;});
    expect(api.downloadStructureExport).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

const maskAsset: MaskAsset = {version: 1, id: 'opening', revision: 1, name: 'Opening', coordinateUnit: 'nm', boundsNm: [0,0,100,100], layers: [{id: '1', layer: 1, datatype: 0, name: 'M1', visible: true}], shapes: [], source: {kind: 'editor'}};
function MaskHarness({api}: {api: TcadApi}) {
  const {actions} = useAppState();
  const maskActions = actions as typeof actions & {beginMaskWrite?: (index: number) => boolean; endMaskWrite?: () => void};
  return <MaskWorkbench api={api} initialAsset={maskAsset} stepIndex={1} onApply={actions.applyMaskAsset} onClose={() => {}}
    onWriteStart={() => {expect(maskActions.beginMaskWrite).toBeTypeOf('function'); return maskActions.beginMaskWrite!(1);}}
    {...{onWriteEnd: () => maskActions.endMaskWrite!()}} />;
}
it.each(['save', 'import'] as const)('blocks %s mask writes during packaging without invalidating results or releasing export gate', async mode => {
  const pending = deferred<typeof packageResult>();
  const recipe = [step(0), step(1, {executionResult: {referenceZNm: 395}})];
  const api = exportApi({init: vi.fn(async () => ({...initView, recipe})), prepareStructureExport: vi.fn(() => pending.promise)});
  render(<AppStateProvider api={api}><Capture /><MaskHarness api={api} /></AppStateProvider>);
  await waitFor(() => expect(captured.state.phase).toBe('ready'));
  let operation!: ReturnType<typeof exportAction>;
  act(() => {operation = exportAction();});
  if (mode === 'save') fireEvent.click(screen.getByRole('button', {name: '保存并应用'}));
  else fireEvent.change(screen.getByLabelText('导入并应用文件'), {target: {files: [new File(['{}'], 'mask.json')]}});
  await act(async () => {await Promise.resolve();});
  expect(api.saveAndApplyMaskAsset).not.toHaveBeenCalled(); expect(api.importAndApplyMaskAsset).not.toHaveBeenCalled();
  expect(captured.state.activeMutation).toBe('export'); expect(captured.state.recipe[1].executionResult).toEqual({referenceZNm: 395});
  await act(async () => {pending.resolve(packageResult); await operation;});
});
it.each(['save', 'import'] as const)('blocks export throughout a pending %s mask write and releases the shared gate on failure', async mode => {
  const pending = deferred<never>(); const api = exportApi({saveAndApplyMaskAsset: vi.fn(() => pending.promise), importAndApplyMaskAsset: vi.fn(() => pending.promise)});
  render(<AppStateProvider api={api}><Capture /><MaskHarness api={api} /></AppStateProvider>);
  await waitFor(() => expect(captured.state.phase).toBe('ready'));
  if (mode === 'save') fireEvent.click(screen.getByRole('button', {name: '保存并应用'}));
  else fireEvent.change(screen.getByLabelText('导入并应用文件'), {target: {files: [new File(['{}'], 'mask.json')]}});
  await act(async () => {expect((await exportAction()).ok).toBe(false);});
  expect(api.prepareStructureExport).not.toHaveBeenCalled(); expect(captured.state.activeMutation).toBe('mask');
  await act(async () => {pending.reject(new Error('mask failed')); await pending.promise.catch(() => {});});
  expect(captured.state.activeMutation).toBeNull();
  await act(async () => {expect(await exportAction()).toEqual({ok: true});});
});

it('allows inactive parameter drafts without saving or losing their raw values', async () => {
  const recipe = [step(0, {params: {mode: 'Standard', hidden: 100}, parameterSpecs: [
    {key: 'mode', label: 'Mode', type: 'choice', choices: [['Standard', 'Standard'], ['Window', 'Window']]},
    {key: 'hidden', label: 'Hidden', type: 'float', minimum: 0, activeWhen: {mode: 'Window'}},
  ]})];
  const api = exportApi({init: vi.fn(async () => ({...initView, recipe}))}); await mount(api);
  act(() => {captured.actions.updateDraft(0, 'hidden', 'raw-invalid', {status: 'invalid'}, 'raw-invalid');});
  const before = captured.state.drafts;
  await act(async () => {expect(await exportAction()).toEqual({ok: true});});
  expect(api.setStep).not.toHaveBeenCalled(); expect(captured.state.drafts).toBe(before);
});

it('requires wafer-only ACK but exports a complete non-wafer flow without ACK', async () => {
  const api = exportApi({init: vi.fn(async () => ({...initView, recipe: [step(0, {name: 'Structure Wafer', runtimeStatus: 'done'})]}))});
  const view = await mount(api);
  await act(async () => {expect((await exportAction(false)).ok).toBe(false);});
  expect(api.prepareStructureExport).not.toHaveBeenCalled(); view.unmount();
  const complete = exportApi({init: vi.fn(async () => ({...initView, recipe: [step(0, {runtimeStatus: 'done'})]}))}); await mount(complete);
  await act(async () => {expect(await exportAction(false)).toEqual({ok: true});});
});

it('rejects mismatched confirmation sources without any process or export request', async () => {
  const api = exportApi(); await mount(api); const current = source(captured.state);
  for (const stale of [{...current, model: {...current.model!, voxelSizeNm: 999}}, {...current, historicalStepIndex: 0}, {...current, previewGeneration: current.previewGeneration + 1}, {...current, lastModelRevision: 99}]) {
    await act(async () => {expect((await exportAction(true, stale)).ok).toBe(false);});
  }
  expect(api.prepareStructureExport).not.toHaveBeenCalled(); expect(api.runAll).not.toHaveBeenCalled(); expect(api.init).toHaveBeenCalledTimes(1);
});

it('releases a created URL even if triggering the browser download fails', async () => {
  const api = exportApi(); await mount(api);
  vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => {throw new Error('download denied');});
  await act(async () => {expect((await exportAction()).ok).toBe(false);});
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:structure'); expect(captured.state.activeMutation).toBeNull();
});

function ReferencePanel() {
  const {state} = useAppState();
  return <ParameterPanel step={state.recipe[1] ?? null} collapsed={false} />;
}
it.each(['success', 'pack failure', 'download failure'] as const)('keeps resolved reference Z visible in the real panel throughout structure export: %s', async outcome => {
  const template = parseStepListEnvelope({ok: true, result: templates}).find(item => item.name === 'Structure Etch')!;
  const recipe = [step(0, {name: 'Structure Wafer', runtimeStatus: 'done'}), {...template, index: 1,
    params: {...template.params, etch_mode: 'Depth window', depth_reference: 'Opening plane'},
    runtimeStatus: 'done' as const, executionResult: {referenceZNm: 395}}];
  const packing = deferred<typeof packageResult>(); const downloading = deferred<Blob>();
  const api = exportApi({init: vi.fn(async () => ({...initView, recipe})),
    prepareStructureExport: vi.fn(() => packing.promise), downloadStructureExport: vi.fn(() => downloading.promise)});
  render(<AppStateProvider api={api}><Capture /><ReferencePanel /></AppStateProvider>);
  expect(await screen.findByText('395 nm')).toBeVisible();
  const before = captured.state;
  let operation!: ReturnType<typeof exportAction>;
  act(() => {operation = exportAction(false);});
  expect(captured.state.activeMutation).toBe('export');
  expect(screen.getByText('395 nm')).toBeVisible();
  expect(screen.queryByText('未解析（需以当前输入成功构建）')).not.toBeInTheDocument();
  await act(async () => {await captured.actions.runAll(); await captured.actions.saveRecipe('blocked'); await captured.actions.uploadMask(new File(['x'], 'mask.json'));});
  expect(api.runAll).not.toHaveBeenCalled(); expect(api.saveRecipe).not.toHaveBeenCalled(); expect(api.uploadMask).not.toHaveBeenCalled();
  if (outcome === 'pack failure') {
    await act(async () => {packing.reject(new Error('pack failed')); expect((await operation).ok).toBe(false);});
    expect(api.downloadStructureExport).not.toHaveBeenCalled();
  } else {
    await act(async () => {packing.resolve(packageResult); await packing.promise;});
    expect(captured.state.activeMutation).toBe('export');
    expect(screen.getByText('395 nm')).toBeVisible();
    expect(screen.queryByText('未解析（需以当前输入成功构建）')).not.toBeInTheDocument();
    await act(async () => {
      if (outcome === 'download failure') downloading.reject(new Error('download failed')); else downloading.resolve(blob());
      expect((await operation).ok).toBe(outcome === 'success');
    });
  }
  expect(screen.getByText('395 nm')).toBeVisible();
  expect(captured.state.phase).toBe(before.phase); expect(captured.state.activeMutation).toBeNull();
  expect(captured.state.recipe).toBe(before.recipe); expect(captured.state.previewGeneration).toBe(before.previewGeneration);
  expect(captured.state.model).toBe(before.model); expect(captured.state.historicalStepIndex).toBe(before.historicalStepIndex);
  expect(captured.state.stepErrors).toBe(before.stepErrors); expect(captured.state.globalError).toBe(before.globalError);
});
