import {useEffect, useRef, useState} from 'react';
import {useAppState} from '../state/AppStateContext';
import {useI18n} from '../i18n/I18nContext';
import type {TcadApiError} from '../api/client';
import {ErrorNotice} from './ErrorNotice';
import {LanguageSwitcher} from './LanguageSwitcher';
import {sameStructureExportSource, structureExportBlock, structureExportNeedsAcknowledgement,
  structureExportSource, type StructureExportProgress, type StructureExportSource} from './structureExportState';

export function StructureExportDialog({supported, onClose}: {supported: boolean; onClose(): void}) {
  const {state, actions} = useAppState();
  const {t} = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState<StructureExportProgress | null>(null);
  const [acknowledgedSource, setAcknowledgedSource] = useState<StructureExportSource | null>(null);
  const [error, setError] = useState<TcadApiError | null>(null);
  const [success, setSuccess] = useState(false);
  const current = structureExportSource(state);
  const needsAcknowledgement = structureExportNeedsAcknowledgement(state);
  const acknowledged = acknowledgedSource !== null && sameStructureExportSource(acknowledgedSource, current);
  const blocked = structureExportBlock(state, supported);
  const busy = progress !== null;
  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof element?.showModal === 'function') element.showModal(); else element?.setAttribute('open', '');
    return () => {mounted.current = false; previous?.focus();};
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current || blocked !== null || (needsAcknowledgement && !acknowledged)) return;
    busyRef.current = true;
    setError(null); setSuccess(false); setProgress('packing');
    try {
      const result = await actions.exportStructure({source: current, acknowledged}, phase => {
        if (mounted.current) setProgress(phase);
      });
      if (!mounted.current) return;
      if (result.ok) setSuccess(true); else if (result.error) setError(result.error);
    } finally {
      busyRef.current = false;
      if (mounted.current) setProgress(null);
    }
  }
  const history = state.recipe.find(step => step.index === state.historicalStepIndex);
  return <dialog ref={dialog} className="structure-export-dialog" aria-modal="true" aria-labelledby="structure-export-title"
    onCancel={event => {event.preventDefault(); if (!busyRef.current) onClose();}}>
    <form onSubmit={event => void submit(event)}>
      <div className="structure-export-heading"><h2 id="structure-export-title">{t('structureExport.title')}</h2><LanguageSwitcher /></div>
      <p>{t('structureExport.description')}</p>
      <p>{t('structureExport.quality')}</p>
      {state.historicalStepIndex !== null && <p className="structure-export-history">{t('structureExport.history', {index: state.historicalStepIndex + 1, name: history?.instanceName ?? history?.name ?? '—'})}</p>}
      {needsAcknowledgement && <div className="structure-export-warning">
        <p id="structure-export-warning">{t('structureExport.warning')}</p>
        <label><input type="checkbox" checked={acknowledged} disabled={busy} aria-describedby="structure-export-warning"
          onChange={event => setAcknowledgedSource(event.target.checked ? structureExportSource(state) : null)} />{t('structureExport.acknowledge')}</label>
      </div>}
      {!busy && blocked !== null && <p role="status">{t(`structureExport.block.${blocked}`)}</p>}
      {error !== null && <ErrorNotice title={t('structureExport.failedTitle')} message={t('structureExport.failed')} />}
      {busy && <p role="status" aria-live="polite">{t(`structureExport.${progress}`)}</p>}
      {success && <p role="status">{t('structureExport.success')}</p>}
      <div className="structure-export-actions">
        <button type="button" className="toolbar-button" disabled={busy} onClick={() => {if (!busyRef.current) onClose();}}>{t('structureExport.close')}</button>
        <button type="submit" className="toolbar-button is-primary" disabled={busy || blocked !== null || (needsAcknowledgement && !acknowledged)}>{t(error === null ? 'structureExport.submit' : 'structureExport.retry')}</button>
      </div>
    </form>
  </dialog>;
}
