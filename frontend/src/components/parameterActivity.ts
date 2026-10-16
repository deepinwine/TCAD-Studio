import type {ParameterSpecView, StepView} from '../api/types';

export function parameterValues(step: StepView, drafts: Record<string, {value: unknown}> = {}): Record<string, unknown> {
  return Object.fromEntries(step.parameterSpecs.map(spec => [spec.key,
    Object.hasOwn(drafts, `${step.index}:${spec.key}`) ? drafts[`${step.index}:${spec.key}`].value
      : Object.hasOwn(step.params, spec.key) ? step.params[spec.key] : spec.defaultValue,
  ]));
}

export function parameterIsActive(spec: ParameterSpecView, specs: readonly ParameterSpecView[], values: Record<string, unknown>): boolean {
  return Object.entries(spec.activeWhen ?? {}).every(([key, expected]) =>
    Object.is(Object.hasOwn(values, key) ? values[key] : specs.find(spec => spec.key === key)?.defaultValue, expected));
}

// Unknown indices and keys are never exempted by conditional metadata.
export function draftIsActive(recipe: readonly StepView[], drafts: Record<string, {value: unknown}>, draftKey: string): boolean {
  const split = draftKey.indexOf(':');
  if (split < 1 || !/^\d+$/.test(draftKey.slice(0, split))) return true;
  const step = recipe.find(step => step.index === Number(draftKey.slice(0, split)));
  const spec = step?.parameterSpecs.find(spec => spec.key === draftKey.slice(split + 1));
  return !step || !spec || parameterIsActive(spec, step.parameterSpecs, parameterValues(step, drafts));
}
