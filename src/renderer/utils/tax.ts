// Tax calculation utilities

import { FLAME_ELEMENTIUM_ID, TAX_RATE } from '../constants.js';
import { getIncludeTax } from '../state/settingsState.js';

/**
 * Apply tax to a value based on settings and item type
 * @param value The value to tax
 * @param baseId The item's baseId (null for currency)
 * @returns The value after tax is applied (or original if tax disabled or currency)
 */
export function applyTax(value: number, baseId: string | null = null): number {
  // Never apply tax if preference is disabled
  if (!getIncludeTax()) return value;
  
  // Never apply tax to Flame Elementium (currency)
  if (baseId === FLAME_ELEMENTIUM_ID) return value;
  
  // Apply tax: subtract 12.5% (1 FE per 8 FE = multiply by 0.875)
  const taxedValue = value * (1 - TAX_RATE);
  return taxedValue;
}
