import type {ParameterChoiceValue} from '../api/types';
import type {I18nContextValue} from '../i18n/I18nContext';
import type {TranslationKey} from '../i18n/catalogs';

const windowChoices: Record<string, TranslationKey> = {
  Standard: 'cad.standard', 'Depth window': 'cad.depthWindow',
  'Opening plane': 'cad.openingPlane', 'Fixed Z': 'cad.fixedZ',
};

export function parameterChoiceLabel(key: string, value: ParameterChoiceValue, fallback: string, t: I18nContextValue['t']): string {
  if ((key === 'etch_mode' || key === 'depth_reference') && typeof value === 'string' && Object.hasOwn(windowChoices, value)) return t(windowChoices[value]);
  return fallback;
}
