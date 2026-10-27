import {act, render, screen, waitFor} from '@testing-library/react';
import {StrictMode, useEffect} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createTcadApi, TcadApiError} from '../api/client';
import {structureExportSource} from '../components/structureExportState';
import type {
  InitView,
  RuntimeStatus,
  RunView,
  SetStepView,
  StepView,
  TcadApi,
  TimelineRestoreView,
  TimelineView,
} from '../api/types';
import {
  AppStateProvider,
  type AppStateContextValue,
  useAppState,
} from './AppStateContext';

afterEach(() => vi.unstubAllGlobals());

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

let captured: AppStateContextValue | null = null;

function Capture({events}: {events?: string[]}) {
  const context = useAppState();
  captured = context;
  useEffect(() => {
    if (context.state.lastModelRevision !== null) {
      events?.push(`ui:revision:${context.state.lastModelRevision}`);
    }
  }, [context.state.lastModelRevision, events]);
  return (
    <output>
      {context.state.phase}:{context.state.activeMutation ?? 'none'}:
      {context.state.lastModelRevision ?? 'none'}:{context.state.timeline?.current ?? 'none'}
    </output>
  );
}

function mount(api: TcadApi, events?: string[]) {
  captured = null;
  return render(
    <AppStateProvider api={api}>
      <Capture events={events} />
    </AppStateProvider>,
  );
}

async function waitUntilReady() {
  await waitFor(() => expect(captured?.state.phase).toBe('ready'));
}

it('saving a restored historical model keeps the exact source and reports success', async () => {
  const api = apiStub(); mount(api); await waitUntilReady();
  await act(async () => {await captured!.actions.loadTimeline(); await captured!.actions.restoreTimeline(0);});
  const before = captured!.state;
  expect(before.historicalStepIndex).toBe(0);
  await act(async () => {await captured!.actions.saveRecipe('Saved A');});
  expect(captured!.state.historicalStepIndex).toBe(before.historicalStepIndex);
  expect(captured!.state.recipe).toBe(before.recipe);
  expect(captured!.state.stepErrors).toBe(before.stepErrors);
  expect(captured!.state.model).toBe(before.model);
  expect(captured!.state.previewGeneration).toBe(before.previewGeneration);
  expect(captured!.state).toMatchObject({recipeSave: {status: 'unconfirmed', name: 'Saved A'}});
  expect(api.runAll).not.toHaveBeenCalled(); expect(api.runStep).not.toHaveBeenCalled(); expect(api.setStep).not.toHaveBeenCalled();
});
it('saving reports explicit success without changing process phase or errors', async () => {
  const api = apiStub(); mount(api); await waitUntilReady();
  await act(async () => {await captured!.actions.saveRecipe('Saved A');});
  expect(captured!.state).toMatchObject({recipeSave: {status: 'unconfirmed', name: 'Saved A'}});
});

it('save true with identity preserves a trusted execution result and invalidates feedback after a new draft', async () => {
  const source = [step(0, {executionResult: {referenceZNm: 395}, runtimeStatus: 'done'})];
  const api = apiStub({
    init: vi.fn(async () => ({...initView, recipe: source, currentRecipe: {id: 'a', name: 'Original'}})),
    saveRecipe: vi.fn(async () => ({saved: true, currentRecipe: {id: 'a', name: 'Renamed'}})),
  });
  mount(api); await waitUntilReady();
  const before = captured!.state;
  await act(async () => {await captured!.actions.saveRecipe('Renamed');});
  expect(captured!.state.recipeSave).toEqual({status: 'success', name: 'Renamed'});
  expect(captured!.state.currentRecipe).toEqual({id: 'a', name: 'Renamed'});
  expect(captured!.state.phase).toBe('ready');
  expect(captured!.state.recipe).toBe(before.recipe);
  expect(captured!.state.model).toBe(before.model);
  expect(captured!.state.recipe[0].executionResult?.referenceZNm).toBe(395);
  await act(async () => {captured!.actions.updateDraft(0, 'dose', 101);});
  expect(captured!.state.recipeSave).toBeUndefined();
  expect(api.runAll).not.toHaveBeenCalled(); expect(api.runStep).not.toHaveBeenCalled(); expect(api.setStep).not.toHaveBeenCalled();
});

it('deduplicates pending save and never reports saved false as success', async () => {
  const pending = deferred<{saved: boolean}>();
  const api = apiStub({saveRecipe: vi.fn(() => pending.promise)});
  mount(api); await waitUntilReady();
  const first = captured!.actions.saveRecipe('A');
  const second = captured!.actions.saveRecipe('A');
  expect(api.saveRecipe).toHaveBeenCalledTimes(1);
  await act(async () => {pending.resolve({saved: false}); await Promise.all([first, second]);});
  expect(captured!.state.recipeSave).toEqual({status: 'failed', name: 'A'});
  expect(captured!.state.currentRecipe).toBeUndefined();
});

it('reports a timed-out save as unconfirmed rather than silently dropping feedback', async () => {
  const api = apiStub({saveRecipe: vi.fn(async () => {throw Object.assign(new Error('timeout'), {name: 'AbortError'});})});
  mount(api); await waitUntilReady();
  await act(async () => {await captured!.actions.saveRecipe('A');});
  expect(captured!.state.recipeSave).toEqual({status: 'unconfirmed', name: 'A'});
});

it('server rejection leaves the old source intact; timeout protects it until a real read-only sync', async () => {
  const old = {...initView, currentRecipe: {id: 'old', name: 'Old'}};
  const newView = {...initView, recipe: [step(0, {instanceName: 'New'})], currentRecipe: {id: 'new', name: 'New'}};
  const api = apiStub({
    init: vi.fn(async () => old),
    loadRecipe: vi.fn().mockRejectedValueOnce(new TcadApiError('not found', {status: 200, code: 'not_found'}))
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), {name: 'AbortError'})),
  });
  mount(api); await waitUntilReady();
  const before = captured!.state;
  await act(async () => {expect(await captured!.actions.openSavedRecipe('missing')).toBe(false);});
  expect(captured!.state.recipe).toBe(before.recipe);
  expect(captured!.state.currentRecipe).toEqual(old.currentRecipe);
  expect(captured!.state.recipeSessionUncertain).not.toBe(true);
  await act(async () => {expect(await captured!.actions.openSavedRecipe('new')).toBe(false);});
  expect(captured!.state.recipeSessionUncertain).toBe(true);
  await act(async () => {await captured!.actions.runAll(); await captured!.actions.saveRecipe('Old'); await captured!.actions.exportRecipe();});
  expect(api.runAll).not.toHaveBeenCalled(); expect(api.saveRecipe).not.toHaveBeenCalled(); expect(api.exportRecipe).not.toHaveBeenCalled();
  expect(api.setStep).not.toHaveBeenCalled();
  expect(captured!.state.recipe).toBe(before.recipe);
  (api.init as ReturnType<typeof vi.fn>).mockResolvedValue(newView);
  await act(async () => {expect(await captured!.actions.resyncRecipeSession()).toBe(true);});
  expect(captured!.state.currentRecipe).toEqual(newView.currentRecipe);
  expect(captured!.state.recipe[0].instanceName).toBe('New');
  expect(captured!.state.recipeSessionUncertain).toBe(false);
  expect(api.loadRecipe).toHaveBeenCalledTimes(2);
  expect(api.getTimeline).toHaveBeenCalledTimes(1);
});

it('recipe export and persistence operations exclude each other in both directions', async () => {
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const pendingSave = deferred<{saved: boolean}>();
  const api = apiStub({saveRecipe: vi.fn(() => pendingSave.promise)});
  mount(api); await waitUntilReady();
  const saving = captured!.actions.saveRecipe('A');
  await act(async () => {await captured!.actions.exportRecipe();});
  expect(api.exportRecipe).not.toHaveBeenCalled();
  await act(async () => {pendingSave.resolve({saved: false}); await saving;});

  const pendingExport = deferred<Blob>();
  api.exportRecipe = vi.fn(() => pendingExport.promise);
  const exporting = captured!.actions.exportRecipe();
  await act(async () => {expect(await captured!.actions.openSavedRecipe('h1')).toBe(false);});
  expect(api.loadRecipe).not.toHaveBeenCalled();
  await act(async () => {pendingExport.resolve(new Blob(['{}'])); await exporting;});
  anchorClick.mockRestore();
});

it('open commits the authoritative model once and keeps it when timeline refresh fails', async () => {
  const pending = deferred<Awaited<ReturnType<TcadApi['loadRecipe']>>>();
  const loaded = {recipe: [step(0, {instanceName: 'Opened'})], model: {gridShape: [9, 9, 9] as const, voxelSizeNm: 5},
    currentRecipe: {id: 'id-2', name: 'Opened'}, log: []};
  const api = apiStub({
    loadRecipe: vi.fn(() => pending.promise),
    getTimeline: vi.fn(async () => {throw new Error('timeline unavailable');}),
    prepareStructureExport: vi.fn(async () => ({zipFile: 'model.zip', files: []})),
    downloadStructureExport: vi.fn(async () => new Blob(['zip'])),
  });
  mount(api); await waitUntilReady();
  const before = captured!.state;
  const opening = captured!.actions.openSavedRecipe('id-2');
  expect(captured!.state.recipe).toBe(before.recipe);
  expect(captured!.actions.beginMaskWrite(0)).toBe(false);
  const exportResult = await captured!.actions.exportStructure({source: structureExportSource(before), acknowledged: true});
  expect(exportResult.ok).toBe(false);
  expect(api.prepareStructureExport).not.toHaveBeenCalled();
  await act(async () => {pending.resolve(loaded); expect(await opening).toBe(true);});
  expect(captured!.state.currentRecipe).toEqual(loaded.currentRecipe);
  expect(captured!.state.model).toEqual(loaded.model);
  expect(captured!.state.recipe[0].instanceName).toBe('Opened');
  expect(captured!.state.timelineStatus).toBe('error');
  expect(captured!.state.recipeOpened).toBe(true);
  expect(api.runAll).not.toHaveBeenCalled(); expect(api.runStep).not.toHaveBeenCalled(); expect(api.setStep).not.toHaveBeenCalled();
});

it('active drafts, type candidates and raw-mask writes block opening before HTTP', async () => {
  const api = apiStub(); const draftSession = mount(api); await waitUntilReady();
  await act(async () => {captured!.actions.updateDraft(0, 'dose', 150);});
  expect(await captured!.actions.openSavedRecipe('h1')).toBe(false);
  expect(api.loadRecipe).not.toHaveBeenCalled();
  draftSession.unmount();
  const candidateSession = mount(api); await waitUntilReady();
  await act(async () => {captured!.actions.setTypeCandidate(0, true);});
  expect(await captured!.actions.openSavedRecipe('h1')).toBe(false);
  expect(api.loadRecipe).not.toHaveBeenCalled();
  candidateSession.unmount();
  mount(api); await waitUntilReady();
  expect(captured!.actions.beginMaskWrite(0)).toBe(true);
  expect(await captured!.actions.openSavedRecipe('h1')).toBe(false);
  expect(api.loadRecipe).not.toHaveBeenCalled();
  captured!.actions.endMaskWrite();
});

it('failed read-only resync retains protection and a later retry clears it without replaying writes', async () => {
  const server = {...initView, currentRecipe: {id: 'server', name: 'Server'}};
  const api = apiStub({
    init: vi.fn().mockResolvedValueOnce(initView).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(server),
    loadRecipe: vi.fn(async () => {throw new TcadApiError('network', {status: 0, code: 'network_error'});}),
  });
  mount(api); await waitUntilReady();
  await act(async () => {expect(await captured!.actions.openSavedRecipe('server')).toBe(false);});
  await act(async () => {expect(await captured!.actions.resyncRecipeSession()).toBe(false);});
  expect(captured!.state.recipeSessionUncertain).toBe(true);
  expect(captured!.actions.beginMaskWrite(0)).toBe(false);
  await act(async () => {expect(await captured!.actions.resyncRecipeSession()).toBe(true);});
  expect(captured!.state.currentRecipe).toEqual(server.currentRecipe);
  expect(captured!.state.recipeSessionUncertain).toBe(false);
  expect(api.loadRecipe).toHaveBeenCalledTimes(1);
  expect(api.runAll).not.toHaveBeenCalled(); expect(api.runStep).not.toHaveBeenCalled(); expect(api.setStep).not.toHaveBeenCalled();
});

it('rejects a new recipe name that the server would silently truncate', async () => {
  const api = apiStub(); mount(api); await waitUntilReady();
  await act(async () => {await captured!.actions.newRecipe('😀'.repeat(81));});
  expect(api.newRecipe).not.toHaveBeenCalled();
});

it('aborts an in-flight open on unmount and ignores its late response', async () => {
  const pending = deferred<Awaited<ReturnType<TcadApi['loadRecipe']>>>();
  const api = apiStub({loadRecipe: vi.fn(() => pending.promise)});
  const view = mount(api); await waitUntilReady();
  let signal: AbortSignal | undefined;
  const opening = captured!.actions.openSavedRecipe('late');
  signal = (api.loadRecipe as ReturnType<typeof vi.fn>).mock.calls[0][1];
  view.unmount();
  await Promise.resolve();
  expect(signal?.aborted).toBe(true);
  pending.resolve({model: initView.model, recipe: [step(0)], currentRecipe: {id: 'late', name: 'Late'}, log: []});
  expect(await opening).toBe(false);
  expect(api.getTimeline).not.toHaveBeenCalled();
});

it.each([{}, {ok: 'true'}])('a real malformed load envelope protects writes and export until authoritative resync: %j', async malformed => {
  const calls: string[] = [];
  let initCount = 0;
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    calls.push(path);
    const result = path === '/api/init' ? {
      ok: true, result: {recipe: [], model: {grid_shape: [8, 8, 8], voxel_size_nm: 10},
        recipe_factories: [], materials: [], ui_state: {},
        current_recipe: initCount++ === 0 ? {id: 'old', name: 'Old'} : {id: 'server', name: 'Server'}},
    } : path === '/api/recipe/load' ? malformed
      : path === '/api/timeline/get' ? {ok: true, result: {items: [], current: -1}}
        : {ok: false, error: `unexpected ${path}`};
    return new Response(JSON.stringify(result), {status: 200});
  });
  vi.stubGlobal('fetch', fetcher);
  const api = createTcadApi();
  const view = mount(api); await waitUntilReady();
  const previous = captured!.state;
  await act(async () => {expect(await captured!.actions.openSavedRecipe('server')).toBe(false);});
  expect(captured!.state.currentRecipe).toEqual({id: 'old', name: 'Old'});
  expect(captured!.state.recipe).toBe(previous.recipe);
  expect(captured!.state.recipeSessionUncertain).toBe(true);
  expect(captured!.actions.beginMaskWrite(0)).toBe(false);
  await act(async () => {
    await captured!.actions.runAll();
    await captured!.actions.saveRecipe('Old');
    await captured!.actions.exportRecipe();
  });
  const prepared = await captured!.actions.exportStructure({source: structureExportSource(previous), acknowledged: true});
  expect(prepared.ok).toBe(false);
  expect(calls).toEqual(['/api/init', '/api/recipe/load']);
  await act(async () => {expect(await captured!.actions.resyncRecipeSession()).toBe(true);});
  expect(calls).toEqual(['/api/init', '/api/recipe/load', '/api/init', '/api/timeline/get']);
  expect(captured!.state.currentRecipe).toEqual({id: 'server', name: 'Server'});
  expect(captured!.state.recipeSessionUncertain).toBe(false);
  view.unmount();
});

it('keeps confirmed save feedback across repeated read-only timeline refreshes, then clears it on an input edit', async () => {
  const api = apiStub({
    init: vi.fn(async () => ({...initView, currentRecipe: {id: 'a', name: 'A'}})),
    saveRecipe: vi.fn(async () => ({saved: true, currentRecipe: {id: 'a', name: 'A'}})),
    getTimeline: vi.fn(async () => ({items: initView.recipe.map(item => ({index: item.index,
      state: 'pending' as const, runtimeStatus: 'ready' as const, snapshotValid: false})), current: -1})),
  });
  mount(api); await waitUntilReady();
  await act(async () => {await captured!.actions.saveRecipe('A');});
  expect(captured!.state.recipeSave).toEqual({status: 'success', name: 'A'});
  await act(async () => {await captured!.actions.loadTimeline();});
  expect(captured!.state.recipeSave).toEqual({status: 'success', name: 'A'});
  await act(async () => {await captured!.actions.loadTimeline();});
  expect(captured!.state.recipeSave).toEqual({status: 'success', name: 'A'});
  await act(async () => {captured!.actions.updateDraft(0, 'dose', 101);});
  expect(captured!.state.recipeSave).toBeUndefined();
  expect(api.setStep).not.toHaveBeenCalled();
});

it('keeps the visible open operation busy until its deferred timeline refresh settles', async () => {
  const pendingTimeline = deferred<TimelineView>();
  const api = apiStub({getTimeline: vi.fn(() => pendingTimeline.promise)});
  mount(api); await waitUntilReady();
  const opening = captured!.actions.openSavedRecipe('h1');
  await waitFor(() => expect(api.getTimeline).toHaveBeenCalledTimes(1));
  expect(captured!.state.currentRecipe).toEqual({id: 'h1', name: 'Loaded'});
  expect(captured!.state.activeMutation).toBe('recipe');
  expect(captured!.state.phase).toBe('ready');
  expect(captured!.actions.beginMaskWrite(0)).toBe(false);
  await act(async () => {pendingTimeline.resolve(timeline); expect(await opening).toBe(true);});
  expect(captured!.state.activeMutation).toBeNull();
});
