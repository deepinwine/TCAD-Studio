import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {TcadApiError} from '../api/client';
import {I18nProvider} from '../i18n/I18nContext';
import {ErrorNotice} from './ErrorNotice';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderNotice(code: string, locale: 'zh-CN' | 'en' = 'zh-CN') {
  window.localStorage.setItem('tcad.locale.v1', locale);
  render(
    <I18nProvider>
      <ErrorNotice
        title="Test error"
        error={new TcadApiError('Authorization: Bearer secret-token', {status: 500, code})}
      />
    </I18nProvider>,
  );
  return screen.getByRole('alert');
}

describe('ErrorNotice error-code boundary', () => {
  it.each(['constructor', 'toString', '__proto__'])(
    'treats prototype code %s as an unknown error without throwing', code => {
      const alert = renderNotice(code);
      expect(alert).toHaveTextContent('发生未预期的错误。');
      expect(alert).not.toHaveTextContent('Authorization: Bearer secret-token');
    },
  );

  it.each([
    ['worker_timeout', '工作进程超时，请稍后重试。', 'The worker timed out. Please try again shortly.'],
    ['restore_failed', '无法恢复所选快照。', 'Unable to restore the selected snapshot.'],
    ['snapshot_unavailable', '所选快照暂不可用。', 'The selected snapshot is currently unavailable.'],
  ])('renders %s with stable translations in both locales', (code, zh, en) => {
    expect(renderNotice(code)).toHaveTextContent(zh);
    cleanup();
    expect(renderNotice(code, 'en')).toHaveTextContent(en);
  });

  it.each([
    ['depth_window_no_effective_opening', '当前掩膜没有有效开口。请设置有效开口；中段刻蚀需先建立通道。', 'The current mask has no effective opening. Set an opening; etching an interior band requires an existing channel.'],
    ['depth_window_no_nonempty_rim', '开口边缘没有实体，无法确定开口平面。请改用 Fixed Z 并设置高度区间。', 'The opening has no solid rim to define its plane. Use Fixed Z and set the height band.'],
    ['depth_window_band_outside_domain', '高度区间超出模型边界。请调整深度或 Fixed Z 上下界。', 'The height band exceeds the model domain. Adjust the depths or Fixed Z bounds.'],
    ['depth_window_no_voxel_center', '高度区间未包含体素中心。请扩大或移动区间，并检查体素尺寸。', 'The height band contains no voxel center. Widen or move the band and check the voxel size.'],
    ['depth_window_no_accessible_target', '区间内没有可达的目标表面。请先建立通道，并检查目标材料与高度区间。', 'There is no accessible target surface in the band. Create a channel and check the target material and height band.'],
    ['depth_window_no_effective_deletion', '区间内没有有效删除。请检查目标材料与高度区间；100% 方向性不会从纯竖壁向侧面删除，可降低方向性后重试。', 'No effective deletion occurred in the band. Check the target material and height band; 100% directionality does not etch laterally from purely vertical walls. Try reducing directionality.'],
    ['depth_window_budget_exceeded', '区间刻蚀超出计算预算。请缩小网格规模或刻蚀距离后重试。', 'Depth window etching exceeds the computation budget. Reduce the grid size or etch distance and retry.'],
  ])('renders safe actionable %s in both locales without raw secrets', (code, zh, en) => {
    expect(renderNotice(code)).toHaveTextContent(zh);
    expect(screen.getByRole('alert')).not.toHaveTextContent('secret-token');
    cleanup();
    expect(renderNotice(code, 'en')).toHaveTextContent(en);
    expect(screen.getByRole('alert')).not.toHaveTextContent('secret-token');
  });

  it('keeps unknown raw messages, suggestions and paths hidden', () => {
    render(<I18nProvider><ErrorNotice title="Unknown" error={new TcadApiError('/private/secret-token', {status: 500, code: 'unknown_geometry'})} suggestion="Bearer secret-token" parameterPath="/private/secret-token" /></I18nProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent('发生未预期的错误。');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/secret-token|\/private|Bearer/);
  });
});
