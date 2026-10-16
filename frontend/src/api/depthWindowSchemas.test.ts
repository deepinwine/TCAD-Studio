import {expect, it} from 'vitest';
import templates from '../test/structureFactoryTemplates.json';
import {parseRunEnvelope, parseStepListEnvelope} from './schemas';
const raw = templates.find(step => step.name === 'Structure Etch')!;
it('consumes actual factory active_when and accepts absent legacy metadata', () => {
  const [step] = parseStepListEnvelope({ok: true, result: [raw]});
  expect(step.parameterSpecs.find(spec => spec.key === 'start_depth_nm')).toHaveProperty('activeWhen', {etch_mode: 'Depth window', depth_reference: 'Opening plane'});
});
it.each([[], 'bad', {etch_mode: []}, {etch_mode: Infinity}, {'': 'Standard'}, {unknown: 'Standard'}, {etch_mode: 'Unknown'}])('rejects invalid activity mapping %j', active_when => {
  expect(() => parseStepListEnvelope({ok: true, result: [{...raw, parameter_specs: raw.parameter_specs.map(spec => spec.key === 'depth_nm' ? {...spec, active_when} : spec)}]})).toThrow(/active_when/);
});
it('accepts only finite readonly execution references with a precise contract path', () => {
  expect(parseStepListEnvelope({ok: true, result: [{...raw, execution_result: {reference_z_nm: 395}}]})[0]).toHaveProperty('executionResult', {referenceZNm: 395});
  for (const reference_z_nm of ['395', null, Infinity, true]) {
    expect(() => parseStepListEnvelope({ok: true, result: [{...raw, execution_result: {reference_z_nm}}]})).toThrow(/execution_result.reference_z_nm/);
  }
});
it('consumes authoritative run recipes and tolerates old success without them', () => {
  const result = parseRunEnvelope({ok: true, result: {recipe: [{...raw, runtime_status: 'done', execution_result: {reference_z_nm: 395}}]}});
  expect(result.recipe?.[0].executionResult?.referenceZNm).toBe(395);
  expect(parseRunEnvelope({ok: true, result: {}})).not.toHaveProperty('recipe');
});
