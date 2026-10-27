import {afterEach, expect, it, vi} from 'vitest';
import {createTcadApi, TcadApiError} from './client';
import {ApiContractError, parseInitEnvelope, parseSavedRecipesEnvelope} from './schemas';

afterEach(() => vi.unstubAllGlobals());

const response = (result: unknown) => new Response(JSON.stringify({ok: true, result}), {status: 200});

it('lists saved recipes by server timestamp then stable id, without exposing file', async () => {
  const fetcher = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => response([
    {id: 'b', name: 'Same', timestamp: '20261026_150000_1', file: '/private/b', autosave: false},
    {id: 'a', name: 'Same', timestamp: '20261026_150000_1', file: '/private/a', autosave: true},
    {id: 'old', name: 'Legacy'},
  ]));
  vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  const result = await createTcadApi().listSavedRecipes!(signal);
  expect(result.map(row => row.id)).toEqual(['a', 'b', 'old']);
  expect(result[0]).toEqual({id: 'a', name: 'Same', timestamp: '20261026_150000_1', autosave: true});
  expect(fetcher.mock.calls[0][0]).toBe('/api/history');
  expect((fetcher.mock.calls[0][1] as RequestInit).signal).toBe(signal);
});

it('rejects malformed or duplicate saved identities and invalid optional booleans', () => {
  for (const result of [[{id: '', name: 'A'}], [{id: 'same', name: 'A'}, {id: 'same', name: 'B'}], [{id: 'a', name: 1}], [{id: 'a', name: 'A', autosave: 'false'}]]) {
    expect(() => parseSavedRecipesEnvelope({ok: true, result})).toThrow(ApiContractError);
  }
  expect(parseSavedRecipesEnvelope({ok: true, result: []})).toEqual([]);
});

it('requires explicit saved true and forwards only the requested id when opening', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request, _options?: RequestInit) => response(
    url === '/api/recipe/save' ? {saved: true, current_recipe: {id: 'a', name: 'Renamed'}}
      : {loaded: true, model: {grid_shape: [2, 2, 2], voxel_size_nm: 10}, recipe: [], current_recipe: {id: 'a', name: 'Renamed'}},
  ));
  vi.stubGlobal('fetch', fetcher);
  const api = createTcadApi();
  expect(await api.saveRecipe('Renamed')).toEqual({saved: true, currentRecipe: {id: 'a', name: 'Renamed'}});
  await api.loadRecipe('a');
  expect(JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string)).toEqual({id: 'a'});
  vi.stubGlobal('fetch', vi.fn(async () => response({current_recipe: {id: 'a', name: 'Renamed'}})));
  await expect(api.saveRecipe('Renamed')).rejects.toThrow(ApiContractError);
  vi.stubGlobal('fetch', vi.fn(async () => response({loaded: false, model: {grid_shape: [2, 2, 2], voxel_size_nm: 10}, recipe: [], current_recipe: {id: 'a', name: 'Renamed'}})));
  await expect(api.loadRecipe('a')).rejects.toThrow(ApiContractError);
});

it('keeps the authority supplied by init and honors abort of a pending list fetch', async () => {
  const init = parseInitEnvelope({ok: true, result: {
    recipe: [], model: {grid_shape: [2, 2, 2], voxel_size_nm: 10}, recipe_factories: [],
    materials: [], ui_state: {}, current_recipe: {id: 'a', name: 'A'},
  }});
  expect(init.currentRecipe).toEqual({id: 'a', name: 'A'});
  vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  })));
  const controller = new AbortController();
  const request = createTcadApi().listSavedRecipes!(controller.signal);
  controller.abort();
  await expect(request).rejects.toMatchObject({name: 'AbortError'});
});

it('treats a server rejection as a definite error and network loss as uncertain', async () => {
  const api = createTcadApi();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ok: false, error: 'unknown id'}), {status: 200})));
  await expect(api.loadRecipe('missing')).rejects.toMatchObject({status: 200});
  vi.stubGlobal('fetch', vi.fn(async () => {throw new TypeError('network');}));
  await expect(api.loadRecipe('a')).rejects.toMatchObject({code: 'network_error'} as Partial<TcadApiError>);
});

it('classifies malformed load envelopes as uncertain even when HTTP succeeds', async () => {
  const api = createTcadApi();
  for (const payload of [{}, {ok: 'true'}, {ok: true, result: {loaded: false}}]) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {status: 200})));
    await expect(api.loadRecipe('a')).rejects.toThrow(ApiContractError);
  }
});

it('does not treat a malformed save envelope as a definite rejection', async () => {
  const api = createTcadApi();
  for (const payload of [{}, {ok: 'true'}]) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {status: 200})));
    await expect(api.saveRecipe('A')).rejects.toThrow(ApiContractError);
  }
});
