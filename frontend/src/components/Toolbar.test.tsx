import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {App} from '../App';
import {TcadApiError} from '../api/client';
import type {
  InitView,
  RuntimeStatus,
  RunView,
  StepView,
  TcadApi,
  TimelineView,
} from '../api/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

function step(index: number, overrides: Partial<StepView> = {}): StepView {
  return {
    index,
    name: `step-${index}`,
    instanceName: `Step ${index + 1}`,
    group: '',
    loop: '',
    enabled: true,
    params: {dose: 100},
    parameterSpecs: [{
      key: 'dose',
      label: 'Dose',
      type: 'float',
      minimum: 0,
    }],
    runtimeStatus: 'ready',
    ...overrides,
  };
}

function initView(recipe: StepView[] = [step(0), step(1)]): InitView {
  return {
    recipe,
    model: {gridShape: [8, 8, 8], voxelSizeNm: 10},
    factories: ['deposit'],
    materials: [],
    uiState: {},
  };
}

const initialTimeline: TimelineView = {
  current: 0,
  items: [
    {index: 0, state: 'current', runtimeStatus: 'ready', snapshotValid: true},
    {index: 1, state: 'pending', runtimeStatus: 'ready', snapshotValid: false},
  ],
};

function apiStub(overrides: Partial<TcadApi> = {}): TcadApi {
  return {
    init: vi.fn(async () => initView()),
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
      model: initView().model,
      recipe: initView().recipe,
      currentRecipe: {name: 'Basic Trench', id: ''},
      log: [],
    })),
    newRecipe: vi.fn(async () => ({
      model: initView().model,
      recipe: initView().recipe,
      currentRecipe: {name: 'New', id: ''},
      log: [],
    })),
    saveRecipe: vi.fn(async () => ({saved: true})),
    addStep: vi.fn(async () => []),
    removeStep: vi.fn(async () => []),
    duplicateStep: vi.fn(async () => []),
    moveStep: vi.fn(async () => []),
    renameStep: vi.fn(async () => { throw new Error('unused'); }),
    uploadMask: vi.fn(async () => ({
      step: {} as never,
      statuses: [],
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
      model: initView().model,
      recipe: initView().recipe,
      currentRecipe: {name: 'Loaded', id: 'h1'},
      log: [],
    })),
    getTimeline: vi.fn(async () => initialTimeline),
    restoreTimeline: vi.fn(async index => ({
      timeline: {...initialTimeline, current: index},
      model: initView().model,
      recipe: initView().recipe,
      log: [],
    })),
    getPreviewManifest: vi.fn(async () => ({revision: 1, meshes: []})),
    getMaterialStl: vi.fn(async () => new ArrayBuffer(0)),
    ...overrides,
  };
}

const stubViewerRuntime = () => ({
  backend: 'WebGL2',
  mount: () => {},
  setStandardView: () => {},
  setProjection: () => {},
  setClipping: () => {},
  setMaterialDisplay: () => {},
  pickAt: () => null,
  setMeasureMarkers: () => {},
  fit: () => {},
  loadMeshes: async () => ({warnings: [], materials: []}),
  dispose: () => {},
});

it('imports the structure example and shows build controls', async () => {
  const demo = {name: 'Structure CAD — Trench', domain: {grid_shape: [64, 64, 64], voxel_size_nm: 5, threads: 1}, steps: [
    {name: 'Structure Wafer', params: {material: 'Silicon', thickness_nm: 100}},
    {name: 'Structure Deposit', params: {material: 'Silicon Dioxide', thickness_nm: 80, coverage: 'Full wafer'}},
    {name: 'Structure Pattern', params: {pattern: 'Lines', critical_dimension: 60, pitch: 160, orientation: 0}},
    {name: 'Structure Etch', params: {material: 'Silicon Dioxide', depth_nm: 40, sidewall_angle_deg: 90}},
    {name: 'Structure Fill', params: {material: 'Copper', height_nm: 180}},
    {name: 'Structure Planarize', params: {height_nm: 160}},
  ]};
  const recipe = demo.steps.map((blob, index) => step(index, {...blob, instanceName: blob.name, parameterSpecs: []}));
  const mount = vi.fn();
  const dispose = vi.fn();
  const api = apiStub({
    init: vi.fn(async () => ({...initView(), demoRecipes: {'Structure CAD — Trench': demo}})),
    importRecipe: vi.fn(async () => ({model: {...initView().model, voxelSizeNm: 5}, recipe, currentRecipe: {name: 'Structure CAD — Trench', id: ''}, log: []})),
  });
  render(<App api={api} viewerRuntimeFactory={() => ({...stubViewerRuntime(), mount, dispose})} />);
  fireEvent.click(await screen.findByRole('button', {name: '结构构建示例'}));
  await waitFor(() => expect(api.importRecipe).toHaveBeenCalled());
  expect(api.importRecipe).toHaveBeenCalledWith(expect.objectContaining({recipe: demo}), expect.any(AbortSignal));
  expect(await screen.findByRole('button', {name: '构建全部'})).toBeEnabled();
  expect(screen.getByText('结构构建 · 网格 5 nm · 纯几何，无物理仿真')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: 'EN'}));
  expect(screen.getByRole('button', {name: 'Build all'})).toBeEnabled();
  expect(api.init).toHaveBeenCalledTimes(1);
  expect(api.importRecipe).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', {name: '中文'}));
  expect(screen.getByRole('button', {name: '构建全部'})).toBeEnabled();
  expect(mount).toHaveBeenCalledTimes(1);
  expect(dispose).not.toHaveBeenCalled();
});

function recordingViewerRuntime() {
  const loadedTokens: number[] = [];
  return {
    loadedTokens,
    factory: () => ({
      backend: 'WebGL2',
      mount: () => {},
      setStandardView: () => {},
      setProjection: () => {},
      setClipping: () => {},
      setMaterialDisplay: () => {},
      pickAt: () => null,
      setMeasureMarkers: () => {},
      fit: () => {},
      loadMeshes: async (token: number) => {
        loadedTokens.push(token);
        return {warnings: [], materials: []};
      },
      dispose: () => {},
    }),
  };
}

describe('Toolbar 配方管理', () => {
  it('项目设置为直接可见的主工具栏入口', async () => {
    render(<App api={apiStub()} viewerRuntimeFactory={stubViewerRuntime} />);
    expect(await screen.findByRole('button', {name: '项目设置'})).toBeVisible();
  });
  it('次要配方操作可展开且默认不占用主工具栏', async () => {
    render(<App api={apiStub()} viewerRuntimeFactory={stubViewerRuntime} />);
    const toggle = await screen.findByRole('button', {name: '配方操作'});
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', {name: '保存配方'})).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', {name: '保存配方'})).toBeVisible();
  });
  it('Demo 列表来自 init，选择后加载触发 importRecipe', async () => {
    const api = apiStub({
      init: vi.fn(async () => ({
        ...initView(),
        demoRecipes: {
          'Basic Trench': {description: '基础沟槽', steps: []},
          'Spacer Formation': {steps: []},
        },
      })),
    });
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
    fireEvent.click(await screen.findByRole('button', {name: '配方操作'}));
    const select = await screen.findByRole('combobox', {name: 'Demo 配方'});
    expect(select).toHaveDisplayValue('-- 选择 Demo 配方 --');
    const options = Array.from(select.querySelectorAll('option')).map(o => o.textContent);
    expect(options).toContain('Basic Trench — 基础沟槽');
    expect(options).toContain('Spacer Formation');

    fireEvent.change(select, {target: {value: 'Basic Trench'}});
    fireEvent.click(screen.getByRole('button', {name: '加载 Demo'}));
    await waitFor(() => expect(api.importRecipe).toHaveBeenCalledTimes(1));
  });

  it('保存与导出触发对应调用', async () => {
    const api = apiStub();
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
    fireEvent.click(await screen.findByRole('button', {name: '配方操作'}));
    await screen.findByRole('button', {name: '保存配方'});
    fireEvent.change(screen.getByRole('textbox', {name: '配方名称'}), {
      target: {value: 'My Recipe'},
    });
    fireEvent.click(screen.getByRole('button', {name: '保存配方'}));
    await waitFor(() => expect(api.saveRecipe).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', {name: '导出配方'}));
    await waitFor(() => expect(api.exportRecipe).toHaveBeenCalledTimes(1));
  });

  it('accepts exactly 80 Unicode characters and rejects 81 before a server can truncate', async () => {
    const api = apiStub();
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
    fireEvent.click(await screen.findByRole('button', {name: '配方操作'}));
    const input = screen.getByRole('textbox', {name: '配方名称'});
    fireEvent.change(input, {target: {value: '😀'.repeat(80)}});
    expect(screen.getByRole('button', {name: '保存配方'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button', {name: '保存配方'}));
    await waitFor(() => expect(api.saveRecipe).toHaveBeenCalledTimes(1));
    fireEvent.change(input, {target: {value: '😀'.repeat(81)}});
    expect(screen.getByRole('button', {name: '保存配方'})).toBeDisabled();
    expect(api.saveRecipe).toHaveBeenCalledTimes(1);
  });

  it('sends Python-stripped Unicode names from both save and new actions without JS trimming', async () => {
    const api = apiStub();
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
    fireEvent.click(await screen.findByRole('button', {name: '配方操作'}));
    const input = screen.getByRole('textbox', {name: '配方名称'});
    const saveButton = screen.getByRole('button', {name: '保存配方'});
    fireEvent.change(input, {target: {value: 'A'.repeat(80) + '\u0085'}});
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    await waitFor(() => expect(api.saveRecipe).toHaveBeenCalledWith('A'.repeat(80), expect.any(AbortSignal)));
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.change(input, {target: {value: '\uFEFFA'}});
    fireEvent.click(saveButton);
    await waitFor(() => expect(api.saveRecipe).toHaveBeenCalledWith('\uFEFFA', expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getByRole('button', {name: '新建配方'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button', {name: '新建配方'}));
    await waitFor(() => expect(api.newRecipe).toHaveBeenCalledWith('\uFEFFA', expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getByRole('textbox', {name: '配方名称'})).toHaveValue('New'));
    fireEvent.change(screen.getByRole('textbox', {name: '配方名称'}), {target: {value: '😀'.repeat(81)}});
    expect(saveButton).toBeDisabled();
  });

  it('keeps visible editors disabled while an interrupted open awaits server resync', async () => {
    const structure = step(0, {name: 'Structure Deposit', instanceName: 'Oxide', params: {dose: 100}});
    const api = apiStub({
      init: vi.fn(async () => ({...initView([structure]), currentRecipe: {id: 'old', name: 'Old'}})),
      listSavedRecipes: vi.fn(async () => [{id: 'next', name: 'Next'}]),
      loadRecipe: vi.fn(async () => {throw new TcadApiError('disconnected', {status: 0, code: 'network_error'});}),
      getTimeline: vi.fn(async () => ({current: -1, items: [{index: 0, state: 'current' as const, runtimeStatus: 'ready' as const, snapshotValid: true}]})),
    });
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
    expect(await screen.findByRole('button', {name: '下一个有效快照'})).toBeEnabled();
    fireEvent.click(await screen.findByRole('button', {name: '配方操作'}));
    fireEvent.click(screen.getByRole('button', {name: '打开已保存配方'}));
    fireEvent.click(await screen.findByRole('radio', {name: /Next/}));
    fireEvent.click(screen.getByRole('button', {name: '打开此配方'}));
    await waitFor(() => expect(screen.getAllByText(/当前配方状态待确认/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', {name: '关闭'}));
    expect(screen.getByRole('textbox', {name: /Dose/})).toBeDisabled();
    expect(screen.getByRole('combobox', {name: '添加步骤类型'})).toBeDisabled();
    expect(screen.getByRole('textbox', {name: '步骤重命名'})).toBeDisabled();
    expect(screen.getByRole('combobox', {name: '工艺类型'})).toBeDisabled();
    expect(screen.getByRole('button', {name: '下一个有效快照'})).toBeDisabled();
    expect(api.setStep).not.toHaveBeenCalled();
  });

  it('saving leaves the visible 395 nm execution reference and mounted Viewer intact', async () => {
    const mountViewer = vi.fn();
    const disposeViewer = vi.fn();
    const etch = step(0, {name: 'Structure Etch', runtimeStatus: 'done',
      params: {etch_mode: 'Depth window', depth_reference: 'Opening plane'},
      executionResult: {referenceZNm: 395}});
    const api = apiStub({
      init: vi.fn(async () => ({...initView([etch]), currentRecipe: {id: 'a', name: 'A'}})),
      saveRecipe: vi.fn(async () => ({saved: true, currentRecipe: {id: 'a', name: 'A'}})),
      getTimeline: vi.fn(async () => ({current: 0, items: [{index: 0, state: 'current' as const, runtimeStatus: 'done' as const, snapshotValid: true}]})),
    });
    render(<App api={api} viewerRuntimeFactory={() => ({...stubViewerRuntime(), mount: mountViewer, dispose: disposeViewer})} />);
    expect(await screen.findByText('395 nm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: '配方操作'}));
    expect(screen.getByRole('textbox', {name: '配方名称'})).toHaveValue('A');
    fireEvent.click(screen.getByRole('button', {name: '保存配方'}));
    await screen.findByText('已保存：A');
    expect(screen.getByText('395 nm')).toBeInTheDocument();
    expect(mountViewer).toHaveBeenCalledTimes(1);
    expect(disposeViewer).not.toHaveBeenCalled();
    expect(api.runAll).not.toHaveBeenCalled(); expect(api.runStep).not.toHaveBeenCalled(); expect(api.setStep).not.toHaveBeenCalled();
  });

  it('导入读取本地 JSON 文件并触发 importRecipe', async () => {
    const api = apiStub();
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
    fireEvent.click(await screen.findByRole('button', {name: '配方操作'}));
    await screen.findByRole('button', {name: '导入配方'});
    const input = screen.getByLabelText('导入配方文件') as HTMLInputElement;
    const file = new File([JSON.stringify({steps: []})], 'recipe.json', {
      type: 'application/json',
    });
    fireEvent.change(input, {target: {files: [file]}});
    await waitFor(() => expect(api.importRecipe).toHaveBeenCalledTimes(1));
  });

  it('新建配方以输入名调用 newRecipe', async () => {
    const api = apiStub();
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
    fireEvent.click(await screen.findByRole('button', {name: '配方操作'}));
    const nameInput = await screen.findByRole('textbox', {name: '配方名称'});
    fireEvent.change(nameInput, {target: {value: 'My Process'}});
    fireEvent.click(screen.getByRole('button', {name: '新建配方'}));
    await waitFor(() => expect(api.newRecipe).toHaveBeenCalledWith('My Process', expect.any(AbortSignal)));
  });
});

describe('Toolbar 本地配方文件错误', () => {
  const jsonError = '配方文件不是有效的 JSON，请检查文件后重试。';
  const readError = '无法读取配方文件，请重新选择文件后重试。';

  async function openImport(api = apiStub()) {
    const mount = vi.fn();
    const dispose = vi.fn();
    const loadMeshes = vi.fn(async () => ({warnings: [], materials: []}));
    render(<App api={api} viewerRuntimeFactory={() => ({...stubViewerRuntime(), mount, dispose, loadMeshes})} />);
    await waitFor(() => expect(screen.getByRole('button', {name: '恢复步骤 1'})).toBeEnabled());
    await waitFor(() => expect(loadMeshes).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', {name: '配方操作'}));
    return {api, mount, dispose, loadMeshes, input: screen.getByLabelText('导入配方文件') as HTMLInputElement};
  }

  function callCounts(api: TcadApi) {
    return Object.fromEntries(Object.entries(api).map(([name, method]) => [name, vi.mocked(method).mock.calls.length]));
  }

  it('坏 JSON 只显示安全提示，保留步骤、选择、Timeline 和 Viewer', async () => {
    const apiWithResult = apiStub({
      getTimeline: vi.fn(async () => ({...initialTimeline, items: initialTimeline.items.map(item => ({...item, runtimeStatus: 'done' as const}))})),
      init: vi.fn(async () => initView([
        step(0),
        step(1, {
          name: 'Structure Etch',
          params: {etch_mode: 'Depth window', depth_reference: 'Opening plane'},
          parameterSpecs: [],
          runtimeStatus: 'done',
          executionResult: {referenceZNm: 250},
        }),
      ])),
    });
    const {api, input, mount, dispose, loadMeshes} = await openImport(apiWithResult);
    fireEvent.click(screen.getByRole('option', {name: /Step 2/}));
    expect(screen.getByText('250 nm')).toBeVisible();
    const options = screen.getAllByRole('option').map(option => option.textContent);
    const timeline = screen.getByRole('navigation', {name: 'Process Timeline'}).textContent;
    const counts = callCounts(api);
    fireEvent.change(input, {target: {files: [new File(['{"private":"secret-recipe",'], 'private.json')]}});

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(jsonError);
    expect(alert).toHaveTextContent('操作失败');
    expect(alert).not.toHaveTextContent(/secret-recipe|private.json|SyntaxError/);
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(options);
    expect(screen.getByRole('option', {name: /Step 2/})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('250 nm')).toBeVisible();
    expect(screen.getByRole('navigation', {name: 'Process Timeline'})).toHaveTextContent(timeline!);
    expect(callCounts(api)).toEqual(counts);
    expect(loadMeshes).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: '配方操作'}));
    expect(alert).toBeVisible();
  });

  it('空文件显示 JSON 错误，不发送写请求', async () => {
    const {api, input} = await openImport();
    const counts = callCounts(api);
    fireEvent.change(input, {target: {files: [new File([''], 'empty.json')]}});
    expect(await screen.findByRole('alert')).toHaveTextContent(jsonError);
    expect(callCounts(api)).toEqual(counts);
  });

  it('读取拒绝显示读取错误且不泄漏路径', async () => {
    const {api, input} = await openImport();
    const counts = callCounts(api);
    const file = new File(['{}'], 'recipe.json');
    const text = vi.spyOn(file, 'text').mockRejectedValue(new Error('/private/secret-file.json'));
    try {
      fireEvent.change(input, {target: {files: [file]}});
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(readError);
      expect(alert).not.toHaveTextContent(/private|secret-file|Error:/);
      fireEvent.click(screen.getByRole('button', {name: 'EN'}));
      expect(alert).toHaveTextContent('Unable to read the recipe file. Select the file again and retry.');
      fireEvent.click(screen.getByRole('button', {name: '中文'}));
      expect(alert).toHaveTextContent(readError);
      expect(callCounts(api)).toEqual(counts);
    } finally {
      text.mockRestore();
    }
  });

  it('错误文案随中英文切换更新且不追加请求', async () => {
    const {api, input} = await openImport();
    fireEvent.change(input, {target: {files: [new File(['bad'], 'recipe.json')]}});
    expect(await screen.findByRole('alert')).toHaveTextContent(jsonError);
    const counts = callCounts(api);
    fireEvent.click(screen.getByRole('button', {name: 'EN'}));
    expect(screen.getByRole('alert')).toHaveTextContent('The recipe file is not valid JSON. Check the file and retry.');
    fireEvent.click(screen.getByRole('button', {name: '中文'}));
    expect(screen.getByRole('alert')).toHaveTextContent(jsonError);
    expect(callCounts(api)).toEqual(counts);
  });

  it('取消选文件保留旧错误与配方', async () => {
    const {api, input} = await openImport();
    fireEvent.change(input, {target: {files: [new File(['bad'], 'recipe.json')]}});
    expect(await screen.findByRole('alert')).toHaveTextContent(jsonError);
    const counts = callCounts(api);
    fireEvent.change(input, {target: {files: []}});
    expect(screen.getByRole('alert')).toHaveTextContent(jsonError);
    expect(screen.getByRole('option', {name: /Step 1/})).toBeInTheDocument();
    expect(screen.getByRole('option', {name: /Step 2/})).toBeInTheDocument();
    expect(callCounts(api)).toEqual(counts);
  });

  it('同一个文件可重复选择，input 在每次选择后清空', async () => {
    const {api, input} = await openImport();
    const file = new File(['bad'], 'recipe.json');
    for (let attempt = 0; attempt < 2; attempt++) {
      fireEvent.change(input, {target: {files: [file]}});
      expect(await screen.findByRole('alert')).toHaveTextContent(jsonError);
      expect(input.value).toBe('');
    }
    expect(api.importRecipe).not.toHaveBeenCalled();
  });

  it('重试读取开始清旧提示，成功只导入一次，之后仍可报告失败', async () => {
    const {api, input} = await openImport();
    fireEvent.change(input, {target: {files: [new File(['bad'], 'bad.json')]}});
    expect(await screen.findByRole('alert')).toHaveTextContent(jsonError);
    const pending = deferred<string>();
    const file = new File(['{"steps":[]}'], 'valid.json');
    const text = vi.spyOn(file, 'text').mockReturnValue(pending.promise);
    try {
      fireEvent.change(input, {target: {files: [file]}});
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(api.importRecipe).not.toHaveBeenCalled();
      await act(async () => pending.resolve('{"steps":[]}'));
      await waitFor(() => expect(screen.getByRole('button', {name: '导入配方'})).toBeEnabled());
      expect(api.importRecipe).toHaveBeenCalledTimes(1);
      expect(api.importRecipe).toHaveBeenCalledWith({recipe: {steps: []}, autosaveCurrent: true}, expect.any(AbortSignal));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      fireEvent.change(input, {target: {files: [new File(['bad again'], 'bad.json')]}});
      expect(await screen.findByRole('alert')).toHaveTextContent(jsonError);
      expect(api.importRecipe).toHaveBeenCalledTimes(1);
    } finally {
      text.mockRestore();
    }
  });

  it('有效 JSON 的服务端语义错误保留原有全局反馈', async () => {
    const api = apiStub({importRecipe: vi.fn(async () => {
      throw new TcadApiError('private server message', {status: 400, code: 'invalid_recipe'});
    })});
    const {input} = await openImport(api);
    fireEvent.change(input, {target: {files: [new File(['{"steps":"invalid"}'], 'recipe.json')]}});
    expect(await screen.findByRole('alert')).toHaveTextContent('配方无效。');
    expect(screen.queryByText(jsonError)).not.toBeInTheDocument();
    expect(screen.queryByText(readError)).not.toBeInTheDocument();
    expect(api.importRecipe).toHaveBeenCalledTimes(1);
  });

  it('本地失败保留非法参数草稿，有效 JSON 继续受 provider 门禁约束', async () => {
    const {api, input} = await openImport();
    const dose = screen.getByRole('textbox', {name: 'Dose'});
    fireEvent.change(dose, {target: {value: '-1'}});
    expect(screen.getByRole('button', {name: '导入配方'})).toBeDisabled();
    const counts = callCounts(api);
    // 程序触发隐藏 input 只检查文件错误边界，不代表禁用按钮可打开选择器。
    fireEvent.change(input, {target: {files: [new File(['bad'], 'recipe.json')]}});
    expect(await screen.findByRole('alert')).toHaveTextContent(jsonError);
    expect(dose).toHaveValue('-1');
    expect(screen.getByText('请先保存或修正参数')).toBeVisible();
    expect(callCounts(api)).toEqual(counts);
    await act(async () => {
      fireEvent.change(input, {target: {files: [new File(['{"steps":[]}'], 'valid.json')]}});
    });
    expect(dose).toHaveValue('-1');
    expect(screen.queryByText(jsonError)).not.toBeInTheDocument();
    expect(screen.queryByText(readError)).not.toBeInTheDocument();
    expect(callCounts(api)).toEqual(counts);
  });
});

describe('Toolbar undo/redo', () => {
  it('撤销与重做按钮触发对应 API 调用', async () => {
    const api = apiStub();
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
    await screen.findByRole('button', {name: '全部运行'});

    fireEvent.click(screen.getByRole('button', {name: '撤销'}));
    await waitFor(() => expect(api.undo).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', {name: '重做'}));
    await waitFor(() => expect(api.redo).toHaveBeenCalledTimes(1));
  });

  it('运行中撤销/重做禁用', async () => {
    const pending = new Promise<never>(() => undefined);
    const api = apiStub({runAll: vi.fn(() => pending)});
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
    await screen.findByRole('button', {name: '全部运行'});
    fireEvent.click(screen.getByRole('button', {name: '全部运行'}));
    await waitFor(() => expect(screen.getByRole('button', {name: '撤销'})).toBeDisabled());
    expect(screen.getByRole('button', {name: '重做'})).toBeDisabled();
  });
});

describe('Toolbar 执行操作', () => {
  it('三个运行按钮分别调用选中步骤、运行至步骤和全部运行', async () => {
    const api = apiStub();
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
    await screen.findByRole('button', {name: '运行选中步骤'});

    fireEvent.click(screen.getByRole('button', {name: '运行选中步骤'}));
    await waitFor(() => expect(api.runStep).toHaveBeenCalledWith(0, expect.any(AbortSignal)));
    fireEvent.click(screen.getByRole('button', {name: '运行至选中步骤'}));
    await waitFor(() => expect(api.runTo).toHaveBeenCalledWith(0, expect.any(AbortSignal)));
    fireEvent.click(screen.getByRole('button', {name: '全部运行'}));
    await waitFor(() => expect(api.runAll).toHaveBeenCalledWith(expect.any(AbortSignal)));
  });

  it('Run All 进行中锁住参数和其他运行按钮，双击也只调用一次', async () => {
    const pending = deferred<RunView>();
    const api = apiStub({runAll: vi.fn(() => pending.promise)});
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);

    const runAll = await screen.findByRole('button', {name: '全部运行'});
    fireEvent.click(runAll);
    fireEvent.click(runAll);

    await waitFor(() => expect(api.runAll).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', {name: '运行选中步骤'})).toBeDisabled();
    expect(screen.getByRole('button', {name: '运行至选中步骤'})).toBeDisabled();
    expect(runAll).toBeDisabled();
    expect(screen.getByRole('region', {name: 'Parameters'})).toHaveAttribute(
      'aria-busy',
      'true',
    );

    pending.resolve({modelRevision: 7});
    await waitFor(() => expect(runAll).toBeEnabled());
  });

  it('没有选中步骤时只禁用依赖选择的两个操作', async () => {
    const api = apiStub({init: vi.fn(async () => initView([]))});
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);

    expect(await screen.findByRole('button', {name: '运行选中步骤'})).toBeDisabled();
    expect(screen.getByRole('button', {name: '运行至选中步骤'})).toBeDisabled();
    expect(screen.getByRole('button', {name: '全部运行'})).toBeEnabled();
  });

  it('存在未保存 draft 时禁用全部运行与恢复，并解释处理方式', async () => {
    const api = apiStub();
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
    const dose = await screen.findByRole('textbox', {name: 'Dose'});
    await screen.findByRole('button', {name: '恢复步骤 1'});

    fireEvent.change(dose, {target: {value: '-1'}});

    const guidance = screen.getByText('请先保存或修正参数');
    expect(guidance).toBeVisible();
    for (const label of ['运行选中步骤', '运行至选中步骤', '全部运行']) {
      const button = screen.getByRole('button', {name: label});
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-describedby', guidance.id);
    }
    expect(screen.getByRole('button', {name: '恢复步骤 1'})).toBeDisabled();
    expect(api.runStep).not.toHaveBeenCalled();
    expect(api.runTo).not.toHaveBeenCalled();
    expect(api.runAll).not.toHaveBeenCalled();
    expect(api.restoreTimeline).not.toHaveBeenCalled();
  });

  it.each([
    [false, '模型未回滚，状态可能已改变'],
    [true, '服务端报告：本次失败已回滚'],
  ] as const)('步骤错误显示安全结构字段和 rolledBack=%s', async (rolledBack, rollbackCopy) => {
    const api = apiStub({
      runStep: vi.fn(async () => {
        throw new TcadApiError('沉积失败', {
          status: 400,
          parameterPath: 'params.dose',
          suggestion: '减小剂量后重试',
          rolledBack,
          details: {stepIndex: 1},
        });
      }),
    });
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
    fireEvent.click(await screen.findByRole('option', {name: /Step 2/}));
    fireEvent.click(screen.getByRole('button', {name: '运行选中步骤'}));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('发生未预期的错误。');
    expect(alert).not.toHaveTextContent('沉积失败');
    expect(alert).toHaveTextContent('参数路径：params.dose');
    expect(alert).not.toHaveTextContent('建议：减小剂量后重试');
    expect(alert).toHaveTextContent('stepIndex: 1');
    expect(alert).toHaveTextContent(rollbackCopy);
    expect(screen.getByRole('option', {name: /Step 2/})).toHaveTextContent('Error');
  });

  it('成功后先采用真实 run 结果，再刷新权威 Timeline 和 Viewer generation', async () => {
    const refreshed: TimelineView = {
      current: 1,
      items: [
        {index: 0, state: 'done', runtimeStatus: 'done', snapshotValid: true},
        {index: 1, state: 'current', runtimeStatus: 'done', snapshotValid: true},
      ],
    };
    const getTimeline = vi.fn()
      .mockResolvedValueOnce(initialTimeline)
      .mockResolvedValueOnce(refreshed);
    const api = apiStub({
      runStep: vi.fn(async () => ({
        index: 1,
        runtimeStatus: 'done',
        modelRevision: 12,
        result: {server: 'authoritative'},
      } satisfies RunView)),
      getTimeline,
    });
    const viewerRuntime = recordingViewerRuntime();
    render(<App api={api} viewerRuntimeFactory={viewerRuntime.factory} />);
    fireEvent.click(await screen.findByRole('option', {name: /Step 2/}));
    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', {name: '运行选中步骤'}));

    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByRole('navigation', {name: 'Process Timeline'}))
        .toHaveTextContent('#2 当前');
    });
    await waitFor(() => expect(viewerRuntime.loadedTokens).toEqual([1, 2]));
  });

  it('Run All 的未知结构化错误显示为安全全局错误', async () => {
    const api = apiStub({
      runAll: vi.fn(async () => {
        throw new TcadApiError('全局执行失败', {
          status: 500,
          suggestion: '检查 Worker 日志',
          rolledBack: false,
        });
      }),
    });
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
    fireEvent.click(await screen.findByRole('button', {name: '全部运行'}));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('发生未预期的错误。');
    expect(alert).not.toHaveTextContent('全局执行失败');
    expect(alert).not.toHaveTextContent('检查 Worker 日志');
    expect(alert).toHaveTextContent('模型未回滚，状态可能已改变');
  });

  it('运行中通过 live region 播报当前操作，连接指示切换为 Running，结束后恢复', async () => {
    const pending = deferred<RunView>();
    const api = apiStub({runAll: vi.fn(() => pending.promise)});
    render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);

    const runAll = await screen.findByRole('button', {name: '全部运行'});
    expect(screen.getByText('已连接 Connected')).toBeInTheDocument();
    fireEvent.click(runAll);

    const announcement = await screen.findByText('正在运行：全部运行…');
    const liveRegion = announcement.closest('[role="status"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('运行中 Running')).toBeInTheDocument();

    pending.resolve({});
    await waitFor(() => expect(screen.queryByText('正在运行：全部运行…')).toBeNull());
    expect(screen.getByText('已连接 Connected')).toBeInTheDocument();
    expect(runAll).toBeEnabled();
  });
});

it('offers a distinct current structure export entry without exporting on open', async () => {
  const api = apiStub({prepareStructureExport: vi.fn(async () => ({zipFile: 'safe.zip', files: ['Si.stl']})), downloadStructureExport: vi.fn(async () => new Blob(['PK']))});
  render(<App api={api} viewerRuntimeFactory={stubViewerRuntime} />);
  const button = await screen.findByRole('button', {name: '导出结构'});
  fireEvent.click(button);
  expect(screen.getByRole('dialog', {name: '导出结构'})).toBeInTheDocument();
  expect(api.prepareStructureExport).not.toHaveBeenCalled();
});

it('keeps Viewer mounted and the model source unchanged while structure ZIP is packed and downloaded', async () => {
  const packing = deferred<{zipFile: string; files: string[]}>();
  const downloading = deferred<Blob>();
  const mount = vi.fn(); const dispose = vi.fn(); const loadMeshes = vi.fn(async () => ({warnings: [], materials: []}));
  const api = apiStub({prepareStructureExport: vi.fn(() => packing.promise), downloadStructureExport: vi.fn(() => downloading.promise)});
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:structure-export');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const view = render(<App api={api} viewerRuntimeFactory={() => ({...stubViewerRuntime(), mount, dispose, loadMeshes})} />);
  const entry = await screen.findByRole('button', {name: '导出结构'}); fireEvent.click(entry);
  const dialog = screen.getByRole('dialog', {name: '导出结构'});
  const checkbox = dialog.querySelector('input[type="checkbox"]')!; fireEvent.click(checkbox);
  const button = screen.getByRole('button', {name: '导出当前结构'}); fireEvent.click(button);
  const initialLoads = loadMeshes.mock.calls.length;
  const initialManifestCalls = vi.mocked(api.getPreviewManifest).mock.calls.length;
  expect(mount).toHaveBeenCalledTimes(1); expect(dispose).not.toHaveBeenCalled();
  await act(async () => {packing.resolve({zipFile: 'model.zip', files: ['Si.stl']}); await packing.promise;});
  expect(mount).toHaveBeenCalledTimes(1); expect(loadMeshes).toHaveBeenCalledTimes(initialLoads);
  await act(async () => {downloading.resolve(new Blob(['PKzip'])); await downloading.promise;});
  expect(await screen.findByText('ZIP 下载已触发。')).toBeInTheDocument();
  expect(mount).toHaveBeenCalledTimes(1); expect(dispose).not.toHaveBeenCalled(); expect(loadMeshes).toHaveBeenCalledTimes(initialLoads);
  expect(api.runAll).not.toHaveBeenCalled(); expect(api.runStep).not.toHaveBeenCalled(); expect(api.setStep).not.toHaveBeenCalled();
  expect(api.getPreviewManifest).toHaveBeenCalledTimes(initialManifestCalls);
  view.unmount(); vi.restoreAllMocks();
});
