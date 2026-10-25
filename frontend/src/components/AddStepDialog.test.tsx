import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {StepView} from '../api/types';
import {AddStepDialog} from './AddStepDialog';
import {I18nProvider, useI18n} from '../i18n/I18nContext';
const template: StepView = {index: 0, name: 'Structure Deposit', instanceName: 'Structure Deposit', group: '', loop: '', enabled: true, runtimeStatus: 'ready', params: {thickness_nm: 35, metadata: {source: 'default'}}, parameterSpecs: [{key: 'thickness_nm', label: 'Thickness', type: 'float', minimum: 0, dimension: 'length', canonicalUnit: 'nm', displayUnits: ['nm', 'µm'], units: 'nm'}, {key: 'metadata', label: 'Metadata', type: 'json'}]};
describe('创建表单', () => {
  it('英文创建文案与单位标签使用集中目录', () => {
    window.localStorage.setItem('tcad.locale.v1', 'en');
    render(<I18nProvider><AddStepDialog template={template} busy={false} onCancel={() => {}} onConfirm={async () => {}} /></I18nProvider>);
    expect(screen.getByRole('heading', {name: /Configure step/})).toBeVisible();
    expect(screen.getByLabelText('Thickness (nm)')).toHaveValue(35);
    expect(screen.getByLabelText('Thickness unit')).toHaveValue('nm');
    expect(screen.getByRole('button', {name: 'Add step'})).toBeVisible();
    expect(screen.getByRole('button', {name: 'Cancel'})).toBeVisible();
  });
  it('有限的µm极值转换溢出呈现invalid并保留表单与输入', () => {
    const confirm = vi.fn(async () => {});
    render(<AddStepDialog template={template} busy={false} onCancel={() => {}} onConfirm={confirm} />);
    fireEvent.change(screen.getByLabelText('厚度单位'), {target: {value: 'µm'}});
    fireEvent.change(screen.getByLabelText('厚度（µm）'), {target: {value: '1e308'}});
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByLabelText('厚度（µm）')).toHaveValue(1e308);
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有限数值');
    expect(screen.getByRole('button', {name: '确认添加'})).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('厚度（µm）'), {target: {value: '0.035'}});
    expect(screen.getByRole('button', {name: '确认添加'})).not.toBeDisabled();
  });
  it('切换ms导致显示值溢出时保留原值与单位并禁止确认，修正后可恢复', () => {
    const confirm = vi.fn(async () => {});
    const timeTemplate: StepView = {...template, params: {duration: 1e308}, parameterSpecs: [{key: 'duration', label: 'Duration', type: 'float', maximum: 1e308, units: 's', dimension: 'time', canonicalUnit: 's', displayUnits: ['s', 'ms']}]};
    render(<AddStepDialog template={timeTemplate} busy={false} onCancel={() => {}} onConfirm={confirm} />);
    fireEvent.change(screen.getByLabelText('Duration单位'), {target: {value: 'ms'}});
    expect(screen.getByLabelText('Duration（s）')).toHaveValue(1e308);
    expect(screen.getByLabelText('Duration单位')).toHaveValue('s');
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有限数值');
    expect(screen.getByRole('button', {name: '确认添加'})).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Duration（s）'), {target: {value: '1'}});
    fireEvent.change(screen.getByLabelText('Duration单位'), {target: {value: 'ms'}});
    expect(screen.getByLabelText('Duration（ms）')).toHaveValue(1000);
    expect(screen.getByRole('button', {name: '确认添加'})).not.toBeDisabled();
  });
  it('弧度极值的canonical转换溢出也呈现字段错误', () => {
    const confirm = vi.fn(async () => {});
    const angleTemplate: StepView = {...template, params: {orientation: 90}, parameterSpecs: [{key: 'orientation', label: 'Orientation', type: 'float', units: '°', dimension: 'angle', canonicalUnit: 'degree', displayUnits: ['°', 'rad']}]};
    render(<AddStepDialog template={angleTemplate} busy={false} onCancel={() => {}} onConfirm={confirm} />);
    fireEvent.change(screen.getByLabelText('旋转角单位'), {target: {value: 'rad'}});
    fireEvent.change(screen.getByLabelText('旋转角（rad）'), {target: {value: '1e308'}});
    expect(screen.getByLabelText('旋转角（rad）')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', {name: '确认添加'})).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();
  });
  it('35nm转为0.035µm并提交canonical值，复杂默认字段保留', () => {
    const confirm = vi.fn(async () => {});
    render(<AddStepDialog template={template} busy={false} onCancel={() => {}} onConfirm={confirm} />);
    fireEvent.change(screen.getByLabelText('厚度单位'), {target: {value: 'µm'}});
    expect(screen.getByLabelText('厚度（µm）')).toHaveValue(0.035);
    fireEvent.click(screen.getByRole('button', {name: '确认添加'}));
    expect(confirm).toHaveBeenCalledWith({params: {thickness_nm: 35, metadata: {source: 'default'}}});
  });
  it('invalid数值和进行中请求阻止确认', () => {
    const confirm = vi.fn(async () => {});
    const view = render(<AddStepDialog template={template} busy={false} onCancel={() => {}} onConfirm={confirm} />);
    fireEvent.change(screen.getByLabelText('厚度（nm）'), {target: {value: '-1'}});
    expect(screen.getByRole('button', {name: '确认添加'})).toBeDisabled();
    expect(screen.getByRole('alert')).toBeVisible();
    view.rerender(<AddStepDialog template={template} busy onCancel={() => {}} onConfirm={confirm} />);
    expect(screen.getByLabelText('厚度（nm）')).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();
  });
});

function SwitchLanguage() {const {setLocale} = useI18n(); return <button onClick={() => setLocale('en')}>English</button>;}

describe('具体字段错误', () => {
  it.each([
    {mode: 'add', inline: false, project: false, confirmText: '确认添加'},
    {mode: 'inline', inline: true, project: false, confirmText: '确认替换'},
    {mode: 'project', inline: false, project: true, confirmText: '确认项目设置'},
  ])('$mode 非法值不提交，修正后只确认一次 canonical 配置', async ({inline, project, confirmText}) => {
    const confirm = vi.fn(async () => {});
    render(<AddStepDialog template={template} busy={false} inline={inline} project={project} onCancel={() => {}} onConfirm={confirm} />);
    const input = screen.getByLabelText('厚度（nm）');
    fireEvent.change(input, {target: {value: '-1'}});
    expect(screen.getByRole('alert')).toHaveTextContent('必须大于或等于 0 nm');
    expect(input).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
    fireEvent.submit(input.closest('form')!);
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('厚度单位'), {target: {value: 'µm'}});
    expect(screen.getByRole('alert')).toHaveTextContent('必须大于或等于 0 µm');
    fireEvent.change(input, {target: {value: '0.035'}});
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => {fireEvent.click(screen.getByRole('button', {name: confirmText}));});
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({params: {thickness_nm: 35, metadata: {source: 'default'}}});
  });

  it('语言和单位更新上限并保留原始输入与自定义名称', () => {
    const bounded = {...template, parameterSpecs: template.parameterSpecs.map(spec => spec.key === 'thickness_nm' ? {...spec, maximum: 1000} : spec)};
    render(<I18nProvider><SwitchLanguage /><AddStepDialog template={bounded} busy={false} inline onCancel={() => {}} onConfirm={async () => {}} /></I18nProvider>);
    fireEvent.change(screen.getByLabelText('自定义名称（可选）'), {target: {value: 'My cap'}});
    fireEvent.change(screen.getByLabelText('厚度单位'), {target: {value: 'µm'}});
    fireEvent.change(screen.getByLabelText('厚度（µm）'), {target: {value: '1.23456789'}});
    expect(screen.getByRole('alert')).toHaveTextContent('必须小于或等于 1 µm');
    fireEvent.click(screen.getByText('English'));
    expect(screen.getByRole('alert')).toHaveTextContent('Must be less than or equal to 1 µm');
    expect(screen.getByLabelText('Thickness (µm)')).toHaveValue(1.23456789);
    expect(screen.getByLabelText('Thickness unit')).toHaveValue('µm');
    expect(screen.getByLabelText('Custom name (optional)')).toHaveValue('My cap');
  });

  it('弧度上限不按 decimals 截断，保留合法边界', () => {
    const angle = {...template, params: {orientation: 45}, parameterSpecs: [{key: 'orientation', label: 'Orientation', type: 'float', maximum: 90, decimals: 2, units: '°', dimension: 'angle', canonicalUnit: 'degree', displayUnits: ['°', 'rad']}]};
    render(<AddStepDialog template={angle} busy={false} onCancel={() => {}} onConfirm={async () => {}} />);
    fireEvent.change(screen.getByLabelText('旋转角单位'), {target: {value: 'rad'}});
    fireEvent.change(screen.getByLabelText('旋转角（rad）'), {target: {value: '2'}});
    expect(screen.getByRole('alert')).toHaveTextContent(`必须小于或等于 ${String(Math.PI / 2)} rad`);
    fireEvent.change(screen.getByLabelText('旋转角（rad）'), {target: {value: String(Math.PI / 2)}});
    expect(screen.getByRole('button', {name: '确认添加'})).toBeEnabled();
  });

  it.each(['NaN', 'Infinity', '1e309', 'bad'])('非有限输入 %s 显示有限数值原因', raw => {
    const textTemplate = {...template, parameterSpecs: template.parameterSpecs.map(spec => ({...spec, activeWhen: {}}))};
    render(<AddStepDialog template={textTemplate} busy={false} onCancel={() => {}} onConfirm={async () => {}} />);
    fireEvent.change(screen.getByLabelText('厚度（nm）'), {target: {value: raw}});
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有限数值');
    expect(screen.getByLabelText('厚度（nm）')).toHaveValue(raw);
  });

  it('整数约束明确指向 canonical nm，合法的小数 µm 可以确认', () => {
    const integer = {...template, parameterSpecs: [{...template.parameterSpecs[0], type: 'int'}]};
    render(<AddStepDialog template={integer} busy={false} onCancel={() => {}} onConfirm={async () => {}} />);
    fireEvent.change(screen.getByLabelText('厚度单位'), {target: {value: 'µm'}});
    fireEvent.change(screen.getByLabelText('厚度（µm）'), {target: {value: '0.0001'}});
    expect(screen.getByRole('alert')).toHaveTextContent('以 nm 为单位时必须为整数');
    fireEvent.change(screen.getByLabelText('厚度（µm）'), {target: {value: '9007199254741'}});
    expect(screen.getByRole('alert')).toHaveTextContent('以 nm 为单位时必须为安全整数');
    fireEvent.change(screen.getByLabelText('厚度（µm）'), {target: {value: '0.001'}});
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: '确认添加'})).toBeEnabled();
  });

  it('无换算元数据沿用原单位，无单位字段不虚构单位', () => {
    const legacy = {...template, params: {dose: -1, count: -1}, parameterSpecs: [{key: 'dose', label: 'Dose', type: 'float', minimum: 0, units: 'mJ/cm²'}, {key: 'count', label: 'Count', type: 'float', minimum: 0}]};
    render(<AddStepDialog template={legacy} busy={false} onCancel={() => {}} onConfirm={async () => {}} />);
    expect(screen.getAllByRole('alert').map(item => item.textContent)).toEqual(['必须大于或等于 0 mJ/cm²', '必须大于或等于 0']);
  });

  it('两份候选的 choice、bool、range 与输入使用唯一错误关联，修正后清除', () => {
    const invalid = {...template, params: {operationMode: 'missing', enabled: 'invalid', directionality_percent: 101}, parameterSpecs: [{key: 'operationMode', label: 'Mode', type: 'choice', choices: [['on', 'On']] as const}, {key: 'enabled', label: 'Enabled', type: 'bool'}, {key: 'directionality_percent', label: 'Directionality', type: 'float', minimum: 0, maximum: 100, units: '%'}]};
    render(<><AddStepDialog template={invalid} busy={false} inline onCancel={() => {}} onConfirm={async () => {}} /><AddStepDialog template={invalid} busy={false} inline onCancel={() => {}} onConfirm={async () => {}} /></>);
    const alerts = screen.getAllByRole('alert');
    expect(new Set(alerts.map(alert => alert.id)).size).toBe(6);
    for (const candidate of document.querySelectorAll<HTMLElement>('.type-candidate')) {
      const controls = [within(candidate).getByLabelText('Mode'), within(candidate).getByLabelText('Enabled'), within(candidate).getByLabelText('方向性（%）'), within(candidate).getByRole('slider')];
      for (const control of controls) {
        expect(control).toHaveAttribute('aria-invalid', 'true');
        const id = control.getAttribute('aria-describedby');
        expect(id).toBeTruthy();
        expect(document.getElementById(id!)).toHaveAttribute('role', 'alert');
        expect(candidate).toContainElement(document.getElementById(id!));
      }
      expect(controls[2].getAttribute('aria-describedby')).toBe(controls[3].getAttribute('aria-describedby'));
      fireEvent.change(controls[0], {target: {value: '0'}});
      fireEvent.click(controls[1]);
      fireEvent.change(controls[3], {target: {value: '50'}});
      for (const control of controls) {
        expect(control).toHaveAttribute('aria-invalid', 'false');
        expect(control).not.toHaveAttribute('aria-describedby');
      }
      expect(within(candidate).queryByRole('alert')).not.toBeInTheDocument();
    }
  });
});

it.each([
  {locale: 'zh-CN', label: '侧壁角（相对底面）', unitLabel: '侧壁角（相对底面）单位', message: '必须大于或等于 5e-324°', confirmText: '确认添加'},
  {locale: 'en', label: 'Sidewall angle (from base plane)', unitLabel: 'Sidewall angle (from base plane) unit', message: 'Must be greater than or equal to 5e-324°', confirmText: 'Add step'},
])('$locale legacy Etch zero rad stays invalid with the nonzero canonical minimum', ({locale, label, unitLabel, message, confirmText}) => {
  localStorage.setItem('tcad.locale.v1', locale);
  const confirm = vi.fn(async () => {});
  const legacyEtch: StepView = {...template, name: 'Etch', instanceName: 'Etch', params: {sidewall_angle_deg: 88}, parameterSpecs: [{key: 'sidewall_angle_deg', label: 'Sidewall angle', type: 'float', defaultValue: 88, minimum: Number.MIN_VALUE, maximum: 90, dimension: 'angle', canonicalUnit: 'degree', displayUnits: ['°', 'rad'], capabilityKey: 'etch.sidewall_angle'}]};
  render(<I18nProvider><AddStepDialog template={legacyEtch} busy={false} onCancel={() => {}} onConfirm={confirm} /></I18nProvider>);
  fireEvent.change(screen.getByLabelText(unitLabel), {target: {value: 'rad'}});
  const input = screen.getByLabelText(label);
  fireEvent.change(input, {target: {value: '0'}});
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
  expect(screen.getByRole('button', {name: confirmText})).toBeDisabled();
  fireEvent.submit(input.closest('form')!);
  expect(confirm).not.toHaveBeenCalled();
});
