import type {AppState} from '../state/appReducer';
import {hasUnsavedDrafts} from '../state/appReducer';
import {isInitializer} from './processCatalog';

/** Capture only authoritative model sources; view settings and locale are deliberately absent. */
export type StructureExportSource = Pick<AppState, 'recipe' | 'model' | 'historicalStepIndex' | 'previewGeneration' | 'lastModelRevision'>;
export interface StructureExportConfirmation {source: StructureExportSource; acknowledged: boolean}
export type StructureExportProgress = 'packing' | 'downloading';
export type StructureExportBlock = 'unsupported' | 'offline' | 'busy' | 'saving' | 'candidate' | 'draft' | 'model';
export function structureExportSource(state: AppState): StructureExportSource {
  return {recipe: state.recipe, model: state.model, historicalStepIndex: state.historicalStepIndex,
    previewGeneration: state.previewGeneration, lastModelRevision: state.lastModelRevision};
}
export function sameStructureExportSource(left: StructureExportSource, right: StructureExportSource): boolean {
  return (left.recipe === right.recipe || JSON.stringify(left.recipe) === JSON.stringify(right.recipe))
    && (left.model === right.model || JSON.stringify(left.model) === JSON.stringify(right.model))
    && left.historicalStepIndex === right.historicalStepIndex
    && left.previewGeneration === right.previewGeneration && left.lastModelRevision === right.lastModelRevision;
}
export function structureExportNeedsAcknowledgement(state: AppState): boolean {
  return state.recipe.every(isInitializer) || Object.keys(state.stepErrors).length > 0
    || state.recipe.some(step => step.enabled && step.runtimeStatus !== 'done');
}
export function structureExportBlock(state: AppState, supported: boolean): StructureExportBlock | null {
  if (!supported) return 'unsupported';
  if (state.phase === 'booting' || state.phase === 'fatal') return 'offline';
  if (state.phase === 'running' || state.activeMutation !== null) return 'busy';
  if (state.pendingSaves > 0) return 'saving';
  if (state.pendingTypeEdits.length > 0) return 'candidate';
  if (hasUnsavedDrafts(state)) return 'draft';
  if (state.model === null) return 'model';
  return null;
}
