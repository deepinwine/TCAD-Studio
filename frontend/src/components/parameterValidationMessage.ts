import type {ParameterSpecView} from '../api/types';
import type {I18nContextValue} from '../i18n/I18nContext';
import {conversionSpec} from '../units/parameterUnits';
import {canonicalUnits, fromCanonical, UnitConversionError, type DisplayUnit} from '../units/units';

function unitLabel(unit: string | undefined): string {
  return unit === 'degree' ? '°' : unit ?? '';
}

function withUnit(value: number, unit: string | undefined): string {
  const label = unitLabel(unit);
  return `${String(value)}${label && label !== '°' && label !== '%' ? ' ' : ''}${label}`;
}

export function parameterValidationMessage(
  messageKey: string | undefined,
  spec: ParameterSpecView,
  t: I18nContextValue['t'],
  displayUnit?: DisplayUnit,
): string {
  const conversion = conversionSpec(spec);
  const canonicalUnit = conversion ? canonicalUnits[conversion.dimension] : spec.units;
  const bound = (value: number | undefined): string => {
    if (value === undefined) return '';
    if (!conversion || displayUnit === undefined || !conversion.units.includes(displayUnit)) {
      return withUnit(value, spec.units);
    }
    try {
      return withUnit(fromCanonical(value, conversion.dimension, displayUnit), displayUnit);
    } catch (error) {
      if (!(error instanceof UnitConversionError)) throw error;
      return withUnit(value, canonicalUnit);
    }
  };

  switch (messageKey) {
    case 'validation.finite':
    case 'validation.positive':
    case 'validation.boolean':
    case 'validation.choice':
    case 'validation.unsupported':
      return t(messageKey);
    case 'validation.integer':
      return canonicalUnit ? t('validation.integerInUnit', {unit: unitLabel(canonicalUnit)}) : t(messageKey);
    case 'validation.safeInteger':
      return canonicalUnit ? t('validation.safeIntegerInUnit', {unit: unitLabel(canonicalUnit)}) : t(messageKey);
    case 'validation.minimum':
      return t(messageKey, {minimum: bound(spec.minimum)});
    case 'validation.maximum':
      return t(messageKey, {maximum: bound(spec.maximum)});
    default:
      return t('parameter.invalid');
  }
}
