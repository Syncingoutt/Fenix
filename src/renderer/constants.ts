// Constants for renderer process

// Price staleness thresholds
export const PRICE_STALE_3_DAYS_MS = 72 * 60 * 60 * 1000; // 72 hours = 3 days
export const PRICE_STALE_7_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Tax configuration
export const TAX_RATE = 0.125; // 12.5% tax rate (1 FE per 8 FE = 1/8 = 12.5%)
export const FLAME_ELEMENTIUM_ID = '100300'; // Never apply tax to currency

// Graph configuration
export const MAX_POINTS = 7200; // Store up to 2 hours of second-by-second data
