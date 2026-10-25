import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {TcadApiError} from '../api/client';
import type {MaskAsset, TcadApi} from '../api/types';
import {MaskWorkbench} from './MaskWorkbench';

const asset: MaskAsset = {version: 1, id: 'opening', revision: 1, name: 'Opening', coordinateUnit: 'nm',
  boundsNm: [0,0,100,100], layers: [{id: '1', layer: 1, datatype: 0, name: 'M1', visible: true}], shapes: [], source: {kind: 'editor'}};
const network = new TcadApiError('unknown write outcome', {status: 0, code: 'network_error'});

it.each(['save', 'import'] as const)('%s invalidates input results after the request gate and before the POST', async operation => {
  const order: string[] = [];
  const onWriteStart = vi.fn(() => {order.push('invalidate');}); const onError = vi.fn();
  const write = vi.fn(async () => {order.push('post'); throw network;});
  const api = {saveAndApplyMaskAsset: write, importAndApplyMaskAsset: write} as unknown as TcadApi;
  render(<MaskWorkbench api={api} initialAsset={asset} stepIndex={0} onApply={() => {}} onClose={() => {}} onError={onError} onWriteStart={onWriteStart} />);
  if (operation === 'save') fireEvent.click(screen.getByRole('button', {name: '保存并应用'}));
  else fireEvent.change(screen.getByLabelText('导入并应用文件'), {target: {files: [new File(['{}'], 'opening.json')]}});
  await waitFor(() => expect(onError).toHaveBeenCalledWith(network));
  expect(order).toEqual(['invalidate', 'post']); expect(onWriteStart).toHaveBeenCalledTimes(1);
});
it('pure export and cancel never invalidate input results', async () => {
  const onWriteStart = vi.fn(); const onError = vi.fn(); const onClose = vi.fn();
  const api = {exportMaskAsset: vi.fn(async () => {throw network;})} as unknown as TcadApi;
  render(<MaskWorkbench api={api} initialAsset={asset} stepIndex={0} onApply={() => {}} onClose={onClose} onError={onError} onWriteStart={onWriteStart} />);
  fireEvent.click(screen.getByRole('button', {name: '导出 JSON'}));
  await waitFor(() => expect(onError).toHaveBeenCalledWith(network));
  expect(onWriteStart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: '放弃并返回'}));
  expect(onClose).toHaveBeenCalledTimes(1); expect(onWriteStart).not.toHaveBeenCalled();
});
it('a write rejected by the busy request gate never issues another invalidation', () => {
  const onWriteStart = vi.fn();
  const api = {saveAndApplyMaskAsset: vi.fn(() => new Promise(() => {}))} as unknown as TcadApi;
  render(<MaskWorkbench api={api} initialAsset={asset} stepIndex={0} onApply={() => {}} onClose={() => {}} onWriteStart={onWriteStart} />);
  const save = screen.getByRole('button', {name: '保存并应用'});
  fireEvent.click(save); fireEvent.click(save);
  expect(onWriteStart).toHaveBeenCalledTimes(1); expect(api.saveAndApplyMaskAsset).toHaveBeenCalledTimes(1);
});

it.each(['save', 'import'] as const)('%s rejected by shared model gate does not write, invalidate or release another operation', async operation => {
  const onWriteStart = vi.fn(() => false); const onWriteEnd = vi.fn();
  const write = vi.fn(async () => {throw network;});
  const api = {saveAndApplyMaskAsset: write, importAndApplyMaskAsset: write} as unknown as TcadApi;
  render(<MaskWorkbench api={api} initialAsset={asset} stepIndex={0} onApply={() => {}} onClose={() => {}} onWriteStart={onWriteStart} {...{onWriteEnd}} />);
  if (operation === 'save') fireEvent.click(screen.getByRole('button', {name: '保存并应用'}));
  else fireEvent.change(screen.getByLabelText('导入并应用文件'), {target: {files: [new File(['{}'], 'opening.json')]}});
  await waitFor(() => expect(onWriteStart).toHaveBeenCalledTimes(1));
  expect(write).not.toHaveBeenCalled(); expect(onWriteEnd).not.toHaveBeenCalled();
});

it.each(['save', 'import'] as const)('%s releases the acquired shared gate after failure', async operation => {
  const onWriteStart = vi.fn(() => true); const onWriteEnd = vi.fn();
  const write = vi.fn(async () => {throw network;});
  const api = {saveAndApplyMaskAsset: write, importAndApplyMaskAsset: write} as unknown as TcadApi;
  render(<MaskWorkbench api={api} initialAsset={asset} stepIndex={0} onApply={() => {}} onClose={() => {}} onWriteStart={onWriteStart} {...{onWriteEnd}} />);
  if (operation === 'save') fireEvent.click(screen.getByRole('button', {name: '保存并应用'}));
  else fireEvent.change(screen.getByLabelText('导入并应用文件'), {target: {files: [new File(['{}'], 'opening.json')]}});
  await waitFor(() => expect(onWriteEnd).toHaveBeenCalledTimes(1)); expect(write).toHaveBeenCalledTimes(1);
});
