import {afterEach, describe, expect, it, vi} from 'vitest';
import {createTcadApi, TcadApiError} from './client';

const success = {ok: true, result: {zip_file: 'tcad_export_1.zip', files: ['/staging/private/Silicon.stl']}};
const packed = () => new Response(JSON.stringify(success), {headers: {'content-type': 'application/json'}});
const zip = () => new Response(new Uint8Array([80, 75, 3, 4, 1]), {headers: {'content-type': 'application/zip'}});
afterEach(() => vi.unstubAllGlobals());

function methods() {
  const api = createTcadApi() as ReturnType<typeof createTcadApi> & {
    prepareStructureExport?: (signal?: AbortSignal) => Promise<{zipFile: string; files: string[]}>;
    downloadStructureExport?: (file: string, signal?: AbortSignal) => Promise<Blob>;
  };
  expect(api.prepareStructureExport, 'client must expose current-model packaging').toBeTypeOf('function');
  expect(api.downloadStructureExport).toBeTypeOf('function');
  return {prepare: api.prepareStructureExport!, download: api.downloadStructureExport!};
}

describe('structure export compatibility API', () => {
  it('posts fixed full-model options and downloads only the safe ZIP basename', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(packed()).mockResolvedValueOnce(zip());
    vi.stubGlobal('fetch', fetcher);
    const {prepare, download} = methods();
    const signal = new AbortController().signal;
    const result = await prepare(signal);
    expect(result).toEqual({zipFile: 'tcad_export_1.zip', files: ['/staging/private/Silicon.stl']});
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/export', expect.objectContaining({method: 'POST', credentials: 'same-origin', signal}));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({sti: true, cross: false, metrics: false, merge_same_materials: true, include_agent_report: false});
    expect((await download(result.zipFile, signal)).size).toBe(5);
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/export/download?file=tcad_export_1.zip', {method: 'GET', credentials: 'same-origin', signal});
  });

  it.each(['', '../a.zip', '/tmp/a.zip', 'a\\b.zip', '%2e%2e%2fa.zip', 'a%252f.zip', 'a.zip\n', 'a.stl', '.zip', 'a?.zip', 'a#b.zip'])('rejects unsafe filename %j before download', async name => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ok: true, result: {...success.result, zip_file: name}})));
    vi.stubGlobal('fetch', fetcher);
    const {prepare, download} = methods();
    await expect(prepare()).rejects.toThrow();
    fetcher.mockClear();
    await expect(download(name)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([{files: []}, {files: ['height.csv']}, {files: ['']}, {files: [32]}, {files: 'a.stl'}, {files: ['Si.stl', 32]}])('rejects empty or malformed STL list $files', async ({files}) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ok: true, result: {...success.result, files}}))));
    await expect(methods().prepare()).rejects.toThrow();
  });

  it.each([() => new Response(new Uint8Array()), () => new Response('<html>login</html>', {headers: {'content-type': 'text/html'}}), () => new Response('not zip', {headers: {'content-type': 'application/zip'}}), () => new Response(JSON.stringify({ok: true}), {headers: {'content-type': 'application/json'}})])('rejects empty, webpage, corrupt or JSON success downloads', async response => {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    await expect(methods().download('safe.zip')).rejects.toThrow();
  });

  it('preserves server JSON errors and aborts, normalizes network failures', async () => {
    const {prepare, download} = methods();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ok: false, code: 'no_geometry', error: 'empty'}), {status: 400, headers: {'content-type': 'application/json'}})));
    await expect(prepare()).rejects.toMatchObject({code: 'no_geometry'});
    await expect(download('safe.zip')).rejects.toMatchObject({code: 'no_geometry'});
    vi.stubGlobal('fetch', vi.fn(async () => {throw new TypeError('offline');}));
    await expect(prepare()).rejects.toBeInstanceOf(TcadApiError);
    await expect(download('safe.zip')).rejects.toMatchObject({code: 'network_error'});
    const abort = new DOMException('cancelled', 'AbortError');
    vi.stubGlobal('fetch', vi.fn(async () => {throw abort;}));
    await expect(prepare()).rejects.toBe(abort);
    await expect(download('safe.zip')).rejects.toBe(abort);
  });
});
