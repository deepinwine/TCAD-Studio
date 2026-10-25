import {useEffect, useId, useRef, useState} from 'react';
import type {StepView} from '../api/types';
import {useI18n} from '../i18n/I18nContext';
import {zhCN, type TranslationKey} from '../i18n/catalogs';
import {validateParameter, type ParameterValidationResult} from './parameterValidation';
import {presentStep} from './stepPresentation';
import {conversionSpec} from '../units/parameterUnits';
import {fromCanonical, toCanonical, UnitConversionError, type DisplayUnit} from '../units/units';
import {parameterIsActive} from './parameterActivity';
import {parameterChoiceLabel} from './parameterCopy';
import {parameterValidationMessage} from './parameterValidationMessage';

function displayBound(value: number | undefined, conversion: ReturnType<typeof conversionSpec>, unit: DisplayUnit): number | undefined {
  if (value === undefined || !conversion) return value;
  try {return fromCanonical(value, conversion.dimension, unit);}
  catch (error) {if (error instanceof UnitConversionError) return undefined; throw error;}
}

export function AddStepDialog({template, busy, onCancel, onConfirm, inline = false, project = false, canConfirm = true}: {template: StepView; busy: boolean; inline?: boolean; project?: boolean; canConfirm?: boolean; onCancel(): void; onConfirm(configuration: {params: Record<string, unknown>; instanceName?: string}): Promise<boolean | void>}) {
  const {locale, t} = useI18n();
  const instanceId = useId();
  const titleId = `${instanceId}-title`;
  const nameId = `${instanceId}-name`;
  const conditional = template.parameterSpecs.some(spec => spec.activeWhen !== undefined);
  const [units, setUnits] = useState<Record<string, DisplayUnit>>(() => Object.fromEntries(template.parameterSpecs.flatMap(spec => {
    const conversion = conversionSpec(spec); if (!conversion) return [];
    let preferred = conversion.preferred;
    if (conditional) {
      try {const stored = localStorage.getItem(`tcad.unit.v1:${template.name}:${spec.key}`); if (conversion.units.includes(stored as DisplayUnit)) preferred = stored as DisplayUnit;} catch { /* In-memory preference remains available. */ }
    }
    return [[spec.key, preferred]];
  })));
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(template.parameterSpecs.map(spec => {
    const value = Object.hasOwn(template.params, spec.key) ? template.params[spec.key] : spec.defaultValue;
    const conversion = conversionSpec(spec);
    return [spec.key, conversion && typeof value === 'number' ? fromCanonical(value, conversion.dimension, units[spec.key]) : value];
  })));
  const [name, setName] = useState(inline && template.instanceName !== template.name ? template.instanceName : '');
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [conversionErrors, setConversionErrors] = useState<Record<string, boolean>>({});
  const dialog = useRef<HTMLDialogElement>(null);
  const gate = useRef(false);
  function updateValue(key: string, value: unknown) {
    setValues(current => ({...current, [key]: value}));
    setConversionErrors(current => ({...current, [key]: false}));
  }
  useEffect(() => {
    if (inline) return;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    if (typeof element?.showModal === 'function') element.showModal();
    else element?.setAttribute('open', '');
    element?.querySelector<HTMLElement>('select, input, button')?.focus();
    return () => previous?.focus();
  }, [inline]);
  const validated = template.parameterSpecs.map(spec => {
    const active = parameterIsActive(spec, template.parameterSpecs, values);
    const conversion = conversionSpec(spec);
    const editable = ['float', 'int', 'integer', 'bool', 'boolean', 'choice', 'enum', 'string', 'str', 'text'].includes(spec.type);
    const raw = values[spec.key];
    let baseResult: ParameterValidationResult;
    try {
      const syntax = conversion ? validateParameter({...spec, type: 'float', minimum: undefined, maximum: undefined, capabilityKey: undefined}, raw) : undefined;
      const canonical = conversion && syntax?.ok && typeof syntax.value === 'number' ? toCanonical(syntax.value, conversion.dimension, units[spec.key]) : raw;
      // Inactive drafts are opaque recipe data. Only numeric display syntax is
      // converted above; semantic validation starts when the field is active.
      baseResult = editable && active ? validateParameter(spec, canonical) : {ok: true, value: canonical};
    } catch (error) {
      if (!(error instanceof UnitConversionError)) throw error;
      baseResult = {ok: false, messageKey: 'validation.finite'};
    }
    const result: ParameterValidationResult = conversionErrors[spec.key] ? {ok: false, messageKey: 'validation.finite'} : baseResult;
    return {spec, conversion, editable, result, baseResult, active};
  });
  const valid = validated.every(item => !item.active || item.result.ok) && name.trim().length <= 80;
  const disabled = busy || submitting;
  const form = <form onSubmit={async event => {
      event.preventDefault();
      if (!valid || !canConfirm || disabled || gate.current) return;
      gate.current = true; setSubmitting(true); setFailed(false);
      try {if (await onConfirm({params: Object.fromEntries(validated.map(({spec, result, active}) => [spec.key, result.ok ? result.value : !active ? values[spec.key] : undefined])), ...(name.trim() ? {instanceName: name.trim()} : {})}) === false) setFailed(true);}
      finally {gate.current = false; setSubmitting(false);}
    }}>
      <h2 id={titleId}>{t('addStep.title')} · {presentStep({...template, params: values}, [], locale).type}</h2>
      <p>{presentStep({...template, params: values}, [], locale).description}</p>
      {failed && <p role="alert">{t(inline ? 'typeEdit.failed' : 'addStep.failed')}</p>}
      {validated.filter(item => item.active).map(({spec, result, baseResult, conversion, editable}) => {
        const id = `${instanceId}-${spec.key}`;
        const validationId = `${id}-validation`;
        const accessibility = {'aria-invalid': !result.ok, 'aria-describedby': !result.ok ? validationId : undefined};
        const label = Object.hasOwn(zhCN, `cad.${spec.key}`) ? t(`cad.${spec.key}` as TranslationKey) : spec.label;
        return <div className="parameter-field" key={spec.key}>
          <label htmlFor={id}>{spec.units ? t('addStep.fieldWithUnit', {label, unit: units[spec.key] ?? spec.units}) : label}</label>
          {!editable ? <pre>{JSON.stringify(values[spec.key])}</pre> : spec.choices ? <select id={id} {...accessibility} disabled={disabled} value={spec.choices.findIndex(([value]) => Object.is(value, values[spec.key]))} onChange={event => updateValue(spec.key, spec.choices![Number(event.target.value)][0])}>
            {spec.choices.map(([value, text], index) => <option key={index} value={index}>{parameterChoiceLabel(spec.key, value, text, t)}</option>)}
          </select> : spec.type === 'bool' || spec.type === 'boolean' ? <input id={id} {...accessibility} type="checkbox" disabled={disabled} checked={Boolean(values[spec.key])} onChange={event => updateValue(spec.key, event.target.checked)} /> : <input id={id} type={!conditional && ['float', 'int', 'integer'].includes(spec.type) ? 'number' : 'text'} inputMode={['float', 'int', 'integer'].includes(spec.type) ? 'decimal' : undefined} step="any" min={displayBound(spec.minimum, conversion, units[spec.key])} max={displayBound(spec.maximum, conversion, units[spec.key])} disabled={disabled} {...accessibility} value={String(values[spec.key] ?? '')} onChange={event => updateValue(spec.key, event.target.value)} />}
          {conversion && <select aria-label={t('addStep.unit', {label})} disabled={disabled} value={units[spec.key]} onChange={event => {
            const nextUnit = event.target.value as DisplayUnit;
            try {
              if (baseResult.ok && typeof baseResult.value === 'number') {
                const converted = fromCanonical(baseResult.value, conversion.dimension, nextUnit);
                updateValue(spec.key, String(converted));
              } else setConversionErrors(current => ({...current, [spec.key]: false}));
              setUnits(current => ({...current, [spec.key]: nextUnit}));
              if (conditional) {try {localStorage.setItem(`tcad.unit.v1:${template.name}:${spec.key}`, nextUnit);} catch { /* Keep preference in memory. */ }}
            } catch (error) {
              if (!(error instanceof UnitConversionError)) throw error;
              setConversionErrors(current => ({...current, [spec.key]: true}));
            }
          }}>{conversion.units.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select>}
          {spec.tooltip && <small>{spec.tooltip}</small>}
          {spec.key === 'directionality_percent' && <><input type="range" {...accessibility} aria-label={label} min="0" max="100" step="any" value={Number.isFinite(Number(values[spec.key])) ? Number(values[spec.key]) : 0} disabled={disabled} onChange={event => updateValue(spec.key, event.target.value)} /><small>{t('cad.directionalityEndpoints')}</small></>}
          {!result.ok && <small id={validationId} role="alert">{parameterValidationMessage(result.messageKey, spec, t, units[spec.key])}</small>}
        </div>;
      })}
      {!project && <><label htmlFor={nameId}>{t('addStep.customName')}</label>
      <input id={nameId} maxLength={80} value={name} disabled={disabled} onChange={event => setName(event.target.value)} /></>}
      <div className="dialog-actions"><button type="button" disabled={disabled} onClick={onCancel}>{t('addStep.cancel')}</button><button type="submit" disabled={disabled || !valid || !canConfirm}>{t(project ? 'project.confirm' : inline ? 'typeEdit.confirm' : 'addStep.confirm')}</button></div>
    </form>;
  return inline ? <div className="type-candidate">{form}</div> : <dialog ref={dialog} aria-modal="true" aria-labelledby={titleId} className="add-step-dialog" onCancel={event => {event.preventDefault(); if (!disabled) onCancel();}}>{form}</dialog>;
}
