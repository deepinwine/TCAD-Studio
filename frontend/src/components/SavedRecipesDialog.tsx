import {useEffect, useRef, useState} from 'react';
import type {SavedRecipeSummary, TcadApi} from '../api/types';
import {useAppState} from '../state/AppStateContext';
import {hasUnsavedDrafts} from '../state/appReducer';
import {useI18n} from '../i18n/I18nContext';
import {LanguageSwitcher} from './LanguageSwitcher';

export function SavedRecipesDialog({api, onClose}: {api?: TcadApi; onClose(): void}) {
  const {state, actions} = useAppState();
  const {t} = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const [rows, setRows] = useState<SavedRecipeSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const blocked = state.phase !== 'ready' || state.activeMutation !== null || state.pendingSaves > 0
    || state.pendingTypeEdits.length > 0 || hasUnsavedDrafts(state);
  const current = state.currentRecipe?.id;
  async function refresh() {
    controller.current?.abort();
    const attempt = ++generation.current;
    const request = new AbortController(); controller.current = request;
    setLoading(true); setFailed(false);
    try {
      if (!api?.listSavedRecipes) throw new Error('unsupported');
      const result = await api.listSavedRecipes(request.signal);
      if (!mounted.current || request.signal.aborted || generation.current !== attempt) return;
      setRows(result); setSelected(value => result.some(row => row.id === value) ? value : '');
    } catch {
      if (mounted.current && !request.signal.aborted && generation.current === attempt) setFailed(true);
    } finally {
      if (mounted.current && generation.current === attempt) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof element?.showModal === 'function') element.showModal(); else element?.setAttribute('open', '');
    return () => {mounted.current = false; generation.current++; controller.current?.abort(); previous?.focus();};
  }, []);
  useEffect(() => {void refresh(); return () => {generation.current++; controller.current?.abort();};}, [api, current]);
  async function open() {
    if (busyRef.current || blocked || state.recipeSessionUncertain || !rows.some(row => row.id === selected)) return;
    busyRef.current = true; setBusy(true);
    try {if (await actions.openSavedRecipe(selected) && mounted.current) onClose();}
    finally {busyRef.current = false; if (mounted.current) setBusy(false);}
  }
  async function resync() {
    if (busyRef.current || blocked) return;
    busyRef.current = true; setBusy(true);
    try {if (await actions.resyncRecipeSession() && mounted.current) onClose();}
    finally {busyRef.current = false; if (mounted.current) setBusy(false);}
  }
  return <dialog ref={dialog} className="structure-export-dialog saved-recipes-dialog" aria-modal="true" aria-labelledby="saved-recipes-title"
    onCancel={event => {event.preventDefault(); if (!busyRef.current) onClose();}}>
    <div className="structure-export-heading"><h2 id="saved-recipes-title">{t('savedRecipes.title')}</h2><LanguageSwitcher /></div>
    <p>{t('savedRecipes.source')}</p>
    <button type="button" className="toolbar-button" disabled={busy} onClick={() => void refresh()}>{t('savedRecipes.refresh')}</button>
    {loading ? <p role="status">{t('savedRecipes.loading')}</p> : failed ? <p role="alert">{t(api?.listSavedRecipes ? 'savedRecipes.listFailed' : 'savedRecipes.unsupported')}</p>
      : rows.length === 0 ? <p>{t('savedRecipes.empty')}</p> : <fieldset disabled={busy} className="saved-recipes-list"><legend>{t('savedRecipes.select')}</legend>{rows.map(row => <label key={row.id} className="saved-recipes-row">
        <input type="radio" name="saved-recipe" value={row.id} checked={selected === row.id} onChange={() => setSelected(row.id)} />
        <span><strong>{row.name}</strong>{row.id === current && <em>{t('savedRecipes.current')}</em>}
          <small>{row.timestamp ? t('savedRecipes.time', {time: row.timestamp.replace(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d+)$/, '$1-$2-$3 $4:$5:$6.$7')}) : t('savedRecipes.unknownTime')}</small>
          <small>{t(row.autosave === undefined ? 'savedRecipes.unknownAutosave' : row.autosave ? 'savedRecipes.hasAutosave' : 'savedRecipes.noAutosave')}</small></span>
      </label>)}</fieldset>}
    {selected && <p>{t('savedRecipes.explanation')}</p>}
    {blocked && !busy && <p role="status">{t('savedRecipes.blocked')}</p>}
    {state.recipeOpenError && <p role="alert">{t('savedRecipes.openFailed')}</p>}
    {state.recipeSessionUncertain && <div role="alert"><p>{t('savedRecipes.uncertain')}</p><button type="button" disabled={busy || blocked} onClick={() => void resync()}>{t('savedRecipes.resync')}</button></div>}
    {busy && <p role="status">{t('savedRecipes.opening')}</p>}
    <div className="structure-export-actions"><button type="button" className="toolbar-button" disabled={busy} onClick={() => {if (!busyRef.current) onClose();}}>{t('structureExport.close')}</button>
      <button type="button" className="toolbar-button is-primary" disabled={busy || blocked || loading || failed || !selected || state.recipeSessionUncertain} onClick={() => void open()}>{t('savedRecipes.open')}</button></div>
  </dialog>;
}
