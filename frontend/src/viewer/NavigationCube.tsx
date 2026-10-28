import {useState} from 'react';
import {useI18n} from '../i18n/I18nContext';
import type {TranslationKey} from '../i18n/catalogs';
import {NAVIGATION_TARGETS, projectNavigation} from './navigation';
import type {CameraOrientation, ViewDirection} from './viewerRuntime';

interface Props {
  orientation: CameraOrientation;
  onChoose(direction: ViewDirection): void;
  disabled: boolean;
}
export function NavigationCube({orientation, onChoose, disabled}: Props) {
  const {t} = useI18n();
  const [hovered, setHovered] = useState('');
  const faceKey = (axis: number, sign: number): TranslationKey => `viewer.navigation.${axis === 0 ? sign > 0 ? 'right' : 'left' : axis === 1 ? sign > 0 ? 'back' : 'front' : sign > 0 ? 'top' : 'bottom'}`;
  const label = (direction: ViewDirection) => [2,1,0].filter(axis => direction[axis] !== 0).map(axis => t(faceKey(axis,direction[axis]))).join(' · ');
  const choose = (direction: ViewDirection) => {if (!disabled) onChoose(direction);};
  return <div className="navigation-cube" role="group" aria-label={t('viewer.navigation.title')}
    onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
    <svg viewBox="0 0 144 144" aria-label={t('viewer.navigation.hint')}>
      {projectNavigation(orientation).map(target => {
        const name = label(target.direction);
        return <g key={target.id} role="button" tabIndex={disabled ? -1 : 0} aria-label={name} aria-disabled={disabled}
          data-direction={target.id} className={`navigation-target navigation-${target.kind}`}
          onMouseEnter={() => setHovered(name)} onMouseLeave={() => setHovered('')} onFocus={() => setHovered(name)} onBlur={() => setHovered('')}
          onClick={() => choose(target.direction)} onKeyDown={event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault();event.stopPropagation();choose(target.direction);}}}>
          <title>{name}</title>
          <polygon points={target.points.map(point => point.join(',')).join(' ')} />
          {target.kind === 'face' && <text x={target.center[0]} y={target.center[1]} dominantBaseline="middle" textAnchor="middle">{name}</text>}
        </g>;
      })}
      <text className="navigation-axes" x="72" y="140" textAnchor="middle">X · Y · Z</text>
    </svg>
    <span className="navigation-caption" role="status">{hovered || t('viewer.navigation.title')}</span>
    <select aria-label={t('viewer.navigation.choose')} defaultValue="" disabled={disabled} onChange={event => {
      const target = NAVIGATION_TARGETS.find(item => item.id === event.target.value);
      if (target) choose(target.direction);
    }}>
      <option value="" disabled>{t('viewer.navigation.choose')}</option>
      {NAVIGATION_TARGETS.map(target => <option key={target.id} value={target.id}>{label(target.direction)}</option>)}
    </select>
  </div>;
}
