import {expect, it} from 'vitest';
import {cleanRecipeName} from './savedRecipeState';

it('matches Python strip without dropping FEFF from a legal recipe name', () => {
  expect(cleanRecipeName('\u0085 A \u001c')).toBe('A');
  expect(cleanRecipeName('\uFEFFA')).toBe('\uFEFFA');
  expect(cleanRecipeName('A'.repeat(80) + '\u0085')).toBe('A'.repeat(80));
  expect(cleanRecipeName('😀'.repeat(80))).toBe('😀'.repeat(80));
  expect(cleanRecipeName('😀'.repeat(81))).toBeNull();
});
