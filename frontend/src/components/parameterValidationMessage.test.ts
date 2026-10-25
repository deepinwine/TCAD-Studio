import {describe, expect, it, vi} from 'vitest';
import type {ParameterSpecView} from '../api/types';
import type {I18nContextValue} from '../i18n/I18nContext';
import {en, zhCN} from '../i18n/catalogs';
import * as units from '../units/units';
import {parameterValidationMessage} from './parameterValidationMessage';

const length: ParameterSpecView = {key: 'length', label: 'Length', type: 'float', minimum: 0, maximum: 1000, units: 'nm', dimension: 'length', canonicalUnit: 'nm', displayUnits: ['nm', 'µm'], decimals: 2};
function translator(catalog: typeof zhCN | typeof en): I18nContextValue['t'] {
  return (key, params) => catalog[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match));
}

describe.each([
  {locale: 'zh', t: translator(zhCN), minimum: '必须大于或等于 ', maximum: '必须小于或等于 ', integer: '以 nm 为单位时必须为整数', safeInteger: '以 nm 为单位时必须为安全整数', catalog: zhCN},
  {locale: 'en', t: translator(en), minimum: 'Must be greater than or equal to ', maximum: 'Must be less than or equal to ', integer: 'Must be an integer in nm', safeInteger: 'Must be a safe integer in nm', catalog: en},
])('$locale validation presentation', ({t, minimum, maximum, integer, safeInteger, catalog}) => {
  it('converts canonical bounds to the current legal unit', () => {
    expect(parameterValidationMessage('validation.minimum', length, t, 'nm')).toBe(`${minimum}0 nm`);
    expect(parameterValidationMessage('validation.maximum', length, t, 'µm')).toBe(`${maximum}1 µm`);
  });
  it('does not truncate radian bounds to field display precision', () => {
    const angle = {...length, maximum: 90, units: 'degree', dimension: 'angle', canonicalUnit: 'degree', displayUnits: ['°', 'rad']};
    expect(parameterValidationMessage('validation.maximum', angle, t, 'rad')).toBe(`${maximum}${String(Math.PI / 2)} rad`);
    expect(parameterValidationMessage('validation.maximum', angle, t, '°')).toBe(`${maximum}90°`);
  });
  it('uses original units when metadata is missing, inconsistent or the display unit is illegal', () => {
    expect(parameterValidationMessage('validation.minimum', {...length, dimension: undefined, units: 'mJ/cm²'}, t, 'µm')).toBe(`${minimum}0 mJ/cm²`);
    expect(parameterValidationMessage('validation.maximum', {...length, canonicalUnit: 's', units: 'legacy'}, t, 'µm')).toBe(`${maximum}1000 legacy`);
    expect(parameterValidationMessage('validation.maximum', length, t, 's')).toBe(`${maximum}1000 nm`);
    expect(parameterValidationMessage('validation.maximum', length, t)).toBe(`${maximum}1000 nm`);
  });
  it('does not invent a unit and joins percent and degrees without spaces', () => {
    expect(parameterValidationMessage('validation.maximum', {...length, units: undefined, dimension: undefined}, t)).toBe(`${maximum}1000`);
    expect(parameterValidationMessage('validation.maximum', {...length, units: '%', dimension: undefined, maximum: 100}, t)).toBe(`${maximum}100%`);
    expect(parameterValidationMessage('validation.maximum', {...length, units: 'degree', dimension: undefined, maximum: 90}, t)).toBe(`${maximum}90°`);
  });
  it('falls back to the canonical number and canonical unit on real conversion overflow', () => {
    const time = {...length, maximum: 1e308, units: 'ms', dimension: 'time', canonicalUnit: 's', displayUnits: ['s', 'ms']};
    expect(parameterValidationMessage('validation.maximum', time, t, 'ms')).toBe(`${maximum}1e+308 s`);
  });
  it('explains canonical integer semantics even when µm is selected', () => {
    expect(parameterValidationMessage('validation.integer', {...length, type: 'int'}, t, 'µm')).toBe(integer);
    expect(parameterValidationMessage('validation.safeInteger', {...length, type: 'int'}, t, 'µm')).toBe(safeInteger);
    expect(parameterValidationMessage('validation.integer', {...length, units: undefined, dimension: undefined}, t)).toBe(catalog['validation.integer']);
  });
  it.each(['validation.finite', 'validation.positive', 'validation.boolean', 'validation.choice', 'validation.unsupported'] as const)('retains the existing %s reason', key => {
    expect(parameterValidationMessage(key, length, t, 'µm')).toBe(catalog[key]);
  });
  it.each([undefined, 'future.validation'])('uses the existing generic fallback for %s', key => {
    expect(parameterValidationMessage(key, length, t, 'µm')).toBe(catalog['parameter.invalid']);
  });
});

it('propagates unexpected programming errors from the conversion instead of hiding them', () => {
  const failure = new Error('unexpected conversion bug');
  const conversion = vi.spyOn(units, 'fromCanonical').mockImplementationOnce(() => {throw failure;});
  try {expect(() => parameterValidationMessage('validation.maximum', length, translator(zhCN), 'µm')).toThrow(failure);}
  finally {conversion.mockRestore();}
});
