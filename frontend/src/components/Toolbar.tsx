import {SavedRecipesDialog} from './SavedRecipesDialog';
import {cleanRecipeName} from './savedRecipeState';
import {useEffect, useRef, useState} from 'react';
import {type ActiveMutation, hasUnsavedDrafts} from '../state/appReducer';
import {useAppState} from '../state/AppStateContext';
import {useI18n} from '../i18n/I18nContext';
import {LanguageSwitcher} from './LanguageSwitcher';
import type {TranslationKey} from '../i18n/catalogs';
import type {TcadApi} from '../api/types';
import {ProjectSettings} from './ProjectSettings';
import {isStructureFlow} from './processCatalog';
import {ErrorNotice} from './ErrorNotice';
import {StructureExportDialog} from './StructureExportDialog';
import {structureExportBlock} from './structureExportState';

interface ToolbarProps {
  api?: TcadApi;
  parametersCollapsed: boolean;
  onToggleParameters(): void;
}

const draftGuidanceId = 'mutation-draft-guidance';

const operationKeys: Record<Exclude<ActiveMutation, null>, TranslationKey> = {
  step: 'operation.step',
  to: 'operation.to',
  all: 'operation.all',
  timeline: 'operation.timeline',
  undo: 'operation.undo',
  redo: 'operation.redo',
  recipe: 'operation.recipe',
  mask: 'operation.mask',
  apply: 'operation.to',
  export: 'structureExport.title',
};

export function Toolbar({api, parametersCollapsed, onToggleParameters}: ToolbarProps) {
  const {state, actions} = useAppState();
  const {t} = useI18n();
  const [savedRecipesOpen, setSavedRecipesOpen] = useState(false);
  const [recipeToolsOpen, setRecipeToolsOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [structureExportOpen, setStructureExportOpen] = useState(false);
  const exportSupported = Boolean(api?.prepareStructureExport && api?.downloadStructureExport);
  const exportBlock = structureExportBlock(state, exportSupported);
  const [demoChoice, setDemoChoice] = useState('');
  const [recipeName, setRecipeName] = useState(state.currentRecipe?.name ?? '');
  useEffect(() => {setRecipeName(state.currentRecipe?.name ?? '');}, [state.currentRecipe]);
  const validRecipeName = cleanRecipeName(recipeName) !== null;
  const [importFileError, setImportFileError] = useState<'read' | 'json' | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const demoRecipes = state.demoRecipes;
  const structureMode = isStructureFlow(state.recipe);
  const mutationActive = state.phase === 'running' || state.activeMutation !== null;
  const activeOperation = state.activeMutation;
  const online = state.phase === 'ready' || state.phase === 'running';
  const connectionLabel = mutationActive
    ? t('toolbar.connectionRunning')
    : online
      ? t('toolbar.connectionConnected')
      : t('toolbar.connectionWorking');
  const connectionTone = mutationActive || !online ? 'is-busy' : 'is-connected';
  const runAnnouncement = mutationActive && activeOperation !== null
    ? t('toolbar.runningAnnouncement', {operation: t(operationKeys[activeOperation])})
    : '';
  const draftBlocked = hasUnsavedDrafts(state);
  const selectedMissing = state.selectedStepIndex === null;
  const allRunsDisabled = Boolean(state.recipeSessionUncertain) || !online || mutationActive || draftBlocked || state.pendingSaves > 0 || state.pendingTypeEdits.length > 0;
  const describedBy = draftBlocked ? draftGuidanceId : undefined;

  async function importFile(file: File) {
    setImportFileError(null);
    let content: string;
    try {
      content = await file.text();
    } catch {
      setImportFileError('read');
      return;
    }
    let recipe: unknown;
    try {
      recipe = JSON.parse(content);
    } catch {
      setImportFileError('json');
      return;
    }
    await actions.importRecipe({recipe});
  }

  return (
    <header className="studio-toolbar">
      <div className="product-lockup">
        <span className="product-mark" aria-hidden="true">TS</span>
        <div>
          <h1>TCAD Studio</h1>
          <span className="product-context">{structureMode ? t('cad.mode', {grid: state.model?.voxelSizeNm ?? '—'}) : 'Process CAD'}</span>
        </div>
      </div>
      <div className="toolbar-run-group" aria-label={t('toolbar.processActions')}>
        <button type="button" className="toolbar-button is-primary" disabled={allRunsDisabled || !api} onClick={() => setProjectOpen(true)}>{t('project.title')}</button>
        {projectOpen && api && <ProjectSettings api={api} onClose={() => setProjectOpen(false)} />}
        <button type="button" className="toolbar-button is-primary" disabled={allRunsDisabled || demoRecipes?.['Structure CAD — Trench'] === undefined} aria-describedby={describedBy} onClick={() => {
          const recipe = demoRecipes?.['Structure CAD — Trench'];
          if (recipe !== undefined) void actions.importRecipe({recipe, name: 'Structure CAD — Trench'});
        }}>{t('cad.example')}</button>
        <button
          type="button"
          className="toolbar-button run-button"
          disabled={allRunsDisabled || selectedMissing}
          aria-describedby={describedBy}
          onClick={() => void actions.runStep()}
        >
          {t(structureMode ? 'cad.step' : 'toolbar.runStep')}
        </button>
        <button
          type="button"
          className="toolbar-button run-button"
          disabled={allRunsDisabled || selectedMissing}
          aria-describedby={describedBy}
          onClick={() => void actions.runTo()}
        >
          {t(structureMode ? 'cad.to' : 'toolbar.runTo')}
        </button>
        <button
          type="button"
          className="toolbar-button run-button is-primary"
          disabled={allRunsDisabled}
          aria-describedby={describedBy}
          onClick={() => void actions.runAll()}
        >
          {t(structureMode ? 'cad.all' : 'toolbar.runAll')}
        </button>
        <button
          type="button"
          className="toolbar-button"
          disabled={allRunsDisabled}
          onClick={() => void actions.undo()}
        >
          {t('toolbar.undo')}
        </button>
        <button
          type="button"
          className="toolbar-button"
          disabled={allRunsDisabled}
          onClick={() => void actions.redo()}
        >
          {t('toolbar.redo')}
        </button>
        <button type="button" className="toolbar-button" disabled={exportBlock !== null}
          title={exportBlock === null ? undefined : t(`structureExport.block.${exportBlock}`)}
          aria-describedby={exportBlock === null ? undefined : 'structure-export-block'}
          onClick={() => setStructureExportOpen(true)}>{t('structureExport.title')}</button>
        {exportBlock !== null && <span id="structure-export-block" className="visually-hidden">{t(`structureExport.block.${exportBlock}`)}</span>}
        {structureExportOpen && <StructureExportDialog supported={exportSupported} onClose={() => setStructureExportOpen(false)} />}
        <button type="button" className="toolbar-button" aria-controls="recipe-tools" aria-expanded={recipeToolsOpen} onClick={() => setRecipeToolsOpen(value => !value)}>{t('toolbar.recipeActions')}</button>
        <div id="recipe-tools" className="toolbar-recipe-tools" hidden={!recipeToolsOpen}>
        <button type="button" className="toolbar-button" disabled={mutationActive} onClick={() => setSavedRecipesOpen(true)}>{t('savedRecipes.title')}</button>
        {savedRecipesOpen && <SavedRecipesDialog api={api} onClose={() => setSavedRecipesOpen(false)} />}
        <select
          className="toolbar-button"
          aria-label={t('toolbar.demoRecipe')}
          value={demoChoice}
          disabled={allRunsDisabled || demoRecipes === undefined}
          onChange={event => setDemoChoice(event.target.value)}
        >
          <option value="">{t('toolbar.selectDemo')}</option>
          {demoRecipes !== undefined && Object.entries(demoRecipes).map(([key, demo]) => (
            <option key={key} value={key}>
              {demo.description ? `${key} — ${demo.description}` : key}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="toolbar-button"
          disabled={allRunsDisabled || demoChoice === ''}
          onClick={() => {
            const blob = demoRecipes?.[demoChoice];
            if (blob !== undefined) {
              void actions.importRecipe({recipe: blob, name: demoChoice});
              setDemoChoice('');
            }
          }}
        >
          {t('toolbar.loadDemo')}
        </button>
        <input
          type="text"
          className="toolbar-button"
          aria-label={t('toolbar.recipeName')}
          placeholder={t('toolbar.recipeName')}
          value={recipeName}
          disabled={allRunsDisabled}
          onChange={event => {setRecipeName(event.target.value); actions.clearRecipeSave();}}
        />
        <button
          type="button"
          className="toolbar-button"
          disabled={allRunsDisabled || !validRecipeName}
          onClick={() => {
            void actions.newRecipe(recipeName.trim());
          }}
        >
          {t('toolbar.newRecipe')}
        </button>
        <button
          type="button"
          className="toolbar-button"
          disabled={allRunsDisabled || !validRecipeName}
          onClick={() => {
            void actions.saveRecipe(recipeName.trim());
          }}
          title={t('toolbar.saveRecipeTitle')}
        >
          {t('toolbar.saveRecipe')}
        </button>
        <span className="toolbar-gate-copy">{t('savedRecipes.rename')}</span>
        {Array.from(recipeName.trim()).length > 80 && <span role="alert">{t('savedRecipes.invalidName')}</span>}
        {state.recipeSave && <span role="status">{t(`savedRecipes.save.${state.recipeSave.status}`, {name: state.recipeSave.name})}</span>}
        <button
          type="button"
          className="toolbar-button"
          disabled={allRunsDisabled}
          onClick={() => void actions.exportRecipe()}
        >
          {t('toolbar.exportRecipe')}
        </button>
        <button
          type="button"
          className="toolbar-button"
          disabled={allRunsDisabled}
          onClick={() => importInputRef.current?.click()}
        >
          {t('toolbar.importRecipe')}
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          aria-label={t('toolbar.importRecipeFile')}
          className="visually-hidden"
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file !== undefined) {
              void importFile(file);
            }
          }}
        />
        </div>
        {importFileError !== null && (
          <ErrorNotice
            title={t('error.operationTitle')}
            message={t(importFileError === 'read' ? 'toolbar.importFileReadError' : 'toolbar.importFileJsonError')}
          />
        )}
        {state.recipeOpened && <p role="status">{t('savedRecipes.restored')}</p>}
        {state.recipeSessionUncertain && <div role="alert"><p>{t('savedRecipes.uncertain')}</p><button type="button" disabled={mutationActive} onClick={() => void actions.resyncRecipeSession()}>{t('savedRecipes.resync')}</button></div>}
        {draftBlocked && (
          <span id={draftGuidanceId} className="toolbar-gate-copy" role="status">
            {t('toolbar.draftGuidance')}
          </span>
        )}
      </div>
      <div className="toolbar-actions">
        <LanguageSwitcher />
        <span
          className="toolbar-run-status"
          role="status"
          aria-live="polite"
          aria-label={runAnnouncement || undefined}
        >
          {runAnnouncement}
        </span>
        <span
          className={`connection-state ${connectionTone}`}
          aria-label={t('toolbar.connectionStatus', {status: connectionLabel})}
        >
          <span className="connection-dot" aria-hidden="true" />
          {connectionLabel}
        </span>
        <button
          type="button"
          className="toolbar-button"
          aria-controls="parameter-panel"
          aria-expanded={!parametersCollapsed}
          aria-label={parametersCollapsed
            ? t('toolbar.expandParameters')
            : t('toolbar.collapseParameters')}
          onClick={onToggleParameters}
        >
          {parametersCollapsed ? t('toolbar.showParameters') : t('toolbar.hideParameters')}
        </button>
      </div>
    </header>
  );
}
