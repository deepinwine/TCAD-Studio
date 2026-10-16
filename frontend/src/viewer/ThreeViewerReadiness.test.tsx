import {act, render, screen} from '@testing-library/react';
import {StrictMode, useLayoutEffect} from 'react';
import {expect, it, vi} from 'vitest';
import type {TcadApi} from '../api/types';
import {ThreeViewer, type ViewerRuntime} from './ThreeViewer';

const api = {} as TcadApi;
function runtimeFixture(order: string[]) {
  const runtime: ViewerRuntime = {
    backend: 'WebGL2', mount: vi.fn(() => {order.push('mount');}), dispose: vi.fn(() => {order.push('dispose');}),
    setStandardView: vi.fn(), setProjection: vi.fn(), setClipping: vi.fn(), fit: vi.fn(),
    setMaterialDisplay: vi.fn(), pickAt: () => null, setMeasureMarkers: vi.fn(),
    loadMeshes: vi.fn(async () => ({warnings: [], materials: []})),
  };
  return runtime;
}

it.each([
  ['顶视图', 'setStandardView', 'button'], ['适应窗口', 'fit', 'button'],
  ['正交视图', 'setProjection', 'button'], ['测量模式', 'setMeasureMarkers', 'button'],
  ['启用 Z 裁剪', 'setClipping', 'checkbox'],
] as const)('honors immediate %s interaction before passive effects', async (label, method, role) => {
  const order: string[] = []; const runtime = runtimeFixture(order); const factory = () => runtime;
  let callsAtInteraction = 0;
  function Parent() {
    useLayoutEffect(() => {
      order.push('interaction'); (screen.getByRole(role, {name: label}) as HTMLElement).click();
      callsAtInteraction = vi.mocked(runtime[method]).mock.calls.length;
    }, []);
    return <ThreeViewer api={api} refreshToken={0} runtimeFactory={factory} />;
  }
  await act(async () => {render(<Parent />);});
  expect(order.slice(0, 2)).toEqual(['mount', 'interaction']);
  expect(callsAtInteraction).toBe(1);
  expect(runtime.mount).toHaveBeenCalledTimes(1);
  expect(runtime.dispose).not.toHaveBeenCalled();
});

it('balances StrictMode mount/dispose and preserves the initialized runtime on refresh', async () => {
  const order: string[] = []; const runtime = runtimeFixture(order); const factory = () => runtime;
  function Parent({refresh}: {refresh: number}) {
    useLayoutEffect(() => {order.push('interaction'); (screen.getByRole('button', {name: '顶视图'}) as HTMLElement).click();}, []);
    return <ThreeViewer api={api} refreshToken={refresh} runtimeFactory={factory} />;
  }
  let view!: ReturnType<typeof render>;
  await act(async () => {view = render(<StrictMode><Parent refresh={0} /></StrictMode>);});
  expect(order).toEqual(['mount', 'interaction', 'dispose', 'mount', 'interaction']);
  expect(runtime.setStandardView).toHaveBeenCalledTimes(2);
  await act(async () => {view.rerender(<StrictMode><Parent refresh={1} /></StrictMode>);});
  expect(runtime.mount).toHaveBeenCalledTimes(2);
  expect(runtime.dispose).toHaveBeenCalledTimes(1);
  view.unmount(); expect(runtime.dispose).toHaveBeenCalledTimes(2);
});
