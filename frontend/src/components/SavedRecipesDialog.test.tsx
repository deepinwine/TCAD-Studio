import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {useState} from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import type {SavedRecipeSummary, TcadApi} from '../api/types';
import {I18nProvider} from '../i18n/I18nContext';
import {AppStateProvider} from '../state/AppStateContext';
import {SavedRecipesDialog} from './SavedRecipesDialog';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}

function setup(overrides: Partial<TcadApi> = {}) {
  const api = {
    init: vi.fn(async () => ({recipe: [], model: {gridShape: [8, 8, 8], voxelSizeNm: 10}, factories: [], materials: [], uiState: {}, currentRecipe: {id: 'a', name: 'Same'}})),
    listSavedRecipes: vi.fn(async () => [
      {id: 'a', name: 'Same', timestamp: '20261026_150000_1', autosave: false},
      {id: 'b', name: 'Same', timestamp: '20261026_160000_1', autosave: true},
    ] as SavedRecipeSummary[]),
    loadRecipe: vi.fn(async (id: string) => ({recipe: [], model: {gridShape: [8, 8, 8] as [number, number, number], voxelSizeNm: 10}, currentRecipe: {id, name: 'Same'}, log: []})),
    getTimeline: vi.fn(async () => ({items: [], current: -1})),
    ...overrides,
  } as unknown as TcadApi;
  function Host() {
    const [open, setOpen] = useState(true);
    return <AppStateProvider api={api}><I18nProvider>
      <button type="button" onClick={() => setOpen(true)}>entry</button>
      {open && <SavedRecipesDialog api={api} onClose={() => setOpen(false)} />}
    </I18nProvider></AppStateProvider>;
  }
  return {api, ...render(<Host />)};
}

afterEach(() => window.localStorage.clear());

it('requires an explicit choice and confirmation, keeps same-name identities distinct across language changes', async () => {
  const {api} = setup();
  await screen.findByText('选择要打开的配方');
  await screen.findByText('有自动保存');
  expect(api.loadRecipe).not.toHaveBeenCalled();
  expect(screen.getByText('当前配方')).toBeInTheDocument();
  expect(screen.getByRole('button', {name: '打开此配方'})).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', {name: /Same.*有自动保存/}));
  fireEvent.click(screen.getByRole('button', {name: 'EN'}));
  expect(screen.getByRole('radio', {name: /Same.*Autosave available/})).toBeChecked();
  expect(api.loadRecipe).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: 'Open this recipe'}));
  await waitFor(() => expect(api.loadRecipe).toHaveBeenCalledTimes(1));
  expect(api.loadRecipe).toHaveBeenCalledWith('b', expect.any(AbortSignal));
  expect(api.getTimeline).toHaveBeenCalledTimes(1);
});

it('discards a stale list after refresh and aborts a pending read on close', async () => {
  const old = deferred<SavedRecipeSummary[]>();
  const apiList = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue([{id: 'new', name: 'Latest'}]);
  const {api} = setup({listSavedRecipes: apiList});
  await screen.findByText('正在读取已保存配方…');
  const firstSignal = apiList.mock.calls[0][0] as AbortSignal;
  fireEvent.click(screen.getByRole('button', {name: '刷新列表'}));
  await screen.findByText('Latest');
  expect(firstSignal.aborted).toBe(true);
  await act(async () => {old.resolve([{id: 'old', name: 'Stale'}]);});
  expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: '关闭'}));
  expect(screen.queryByText('Latest')).not.toBeInTheDocument();
  expect(api.loadRecipe).not.toHaveBeenCalled();
});
