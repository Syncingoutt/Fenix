import * as fs from 'fs';
import * as path from 'path';

export interface ParsedLogEntry {
  timestamp: string;
  action: string;
  fullId: string;
  baseId: string;
  bagNum: number;
  slotId: number | null;
  pageId: number | null;
}

export interface PriceCheckData {
  baseId: string;
  prices: number[];
  timestamp: string;
}

// Default path (will be overridden by user selection)
const DEFAULT_LOG_PATH = '';

// Store userData path (set by main process)
let userDataPath: string | null = null;

/**
 * Initialize the log parser with userData path (called from main process)
 */
export function initLogParser(userData: string): void {
  userDataPath = userData;
}

/**
 * Get the path to the config file where we store the log path
 */
function getConfigPath(): string {
  if (!userDataPath) {
    throw new Error('Log parser not initialized. Call initLogParser() first.');
  }
  return path.join(userDataPath, 'config.json');
}

/**
 * Load the saved log path from config file
 */
export function getLogPath(): string {
  const configPath = getConfigPath();
  
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.logPath && fs.existsSync(config.logPath)) {
        return config.logPath;
      }
    } catch (error) {
      console.warn('Failed to read config file:', error);
    }
  }
  
  return DEFAULT_LOG_PATH;
}

/**
 * Load the entire config file
 */
function loadConfig(): any {
  const configPath = getConfigPath();
  
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (error) {
      console.warn('Failed to read config file:', error);
      return {};
    }
  }
  
  return {};
}

/**
 * Save the entire config file
 */
function saveConfig(config: any): void {
  const configPath = getConfigPath();
  
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save config file:', error);
    throw error;
  }
}

/**
 * Save the log path to config file (preserves other settings)
 */
export function setLogPath(logPath: string): void {
  const config = loadConfig();
  config.logPath = logPath;
  saveConfig(config);
}

/**
 * Check if log path is configured
 */
export function isLogPathConfigured(): boolean {
  const logPath = getLogPath();
  return logPath !== DEFAULT_LOG_PATH && logPath !== '' && fs.existsSync(logPath);
}

/**
 * Get settings from config file
 */
export function getSettings(): { keybind?: string; fullscreenMode?: boolean } {
  const config = loadConfig();
  return config.settings || {};
}

/**
 * Save settings to config file (preserves log path)
 */
export function saveSettings(settings: { keybind?: string; fullscreenMode?: boolean }): void {
  const config = loadConfig();
  config.settings = { ...config.settings, ...settings };
  saveConfig(config);
}

function extractBaseId(fullId: string): string {
  return fullId.split('_')[0];
}

export function parseLogLine(line: string): ParsedLogEntry | null {
  const idMatch = line.match(/Id=([^\s]+)/);
  if (!idMatch) return null;
  
  const fullId = idMatch[1];
  const baseId = extractBaseId(fullId);

  const bagMatch = line.match(/BagNum=(\d+)/);
  if (!bagMatch) return null;
  const bagNum = parseInt(bagMatch[1]);

  const pageMatch = line.match(/PageId=(\d+)/);
  const pageId = pageMatch ? parseInt(pageMatch[1]) : null;
  
  if (pageId !== 102 && pageId !== 103) {
    return null;
  }

  const timestampMatch = line.match(/\[([\d\.\-:]+)\]/);
  const timestamp = timestampMatch ? timestampMatch[1] : 'unknown';

  let action = 'Unknown';
  if (line.includes('ItemChange@ Add')) action = 'Add';
  else if (line.includes('ItemChange@ Update')) action = 'Update';
  else if (line.includes('ItemChange@ Remove')) action = 'Remove';

  const slotMatch = line.match(/SlotId=(\d+)/);
  const slotId = slotMatch ? parseInt(slotMatch[1]) : null;

  return {
    timestamp,
    action,
    fullId,
    baseId,
    bagNum,
    slotId,
    pageId
  };
}

export function readLogFile(): ParsedLogEntry[] {
  const logPath = getLogPath();
  
  if (!logPath || !fs.existsSync(logPath)) {
    console.error(`❌ Log file not found at: ${logPath || 'not configured'}`);
    return [];
  }

  const stats = fs.statSync(logPath);
  const fileSize = stats.size;

  const MAX_READ_BYTES = 100 * 1024 * 1024; // 100 MB
  const startPosition = fileSize > MAX_READ_BYTES ? fileSize - MAX_READ_BYTES : 0;

  const fd = fs.openSync(logPath, 'r');
  const buffer = Buffer.alloc(fileSize - startPosition);
  fs.readSync(fd, buffer, 0, fileSize - startPosition, startPosition);
  fs.closeSync(fd);

  const logContent = buffer.toString('utf-8');
  const lines = logContent.split('\n');

  let lastReset102 = -1;
  let lastReset103 = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.includes('ItemChange@ Reset PageId=102') && lastReset102 === -1) {
      lastReset102 = i;
    }
    if (line.includes('ItemChange@ Reset PageId=103') && lastReset103 === -1) {
      lastReset103 = i;
    }
    if (lastReset102 !== -1 && lastReset103 !== -1) break;
  }

  const startIndex = Math.min(
    lastReset102 === -1 ? Infinity : lastReset102,
    lastReset103 === -1 ? Infinity : lastReset103
  );

  const relevantLines = startIndex === Infinity ? lines : lines.slice(startIndex);

  const entries: ParsedLogEntry[] = [];

  for (const line of relevantLines) {
    if (line.includes('ItemChange@') && line.includes('Id=')) {
      const parsed = parseLogLine(line);
      if (parsed) entries.push(parsed);
    }
  }

  return entries;
}


export function parsePriceCheck(lines: string[]): PriceCheckData | null {
  let baseId: string | null = null;
  let prices: number[] = [];
  let timestamp = 'unknown';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0) {
      const timestampMatch = line.match(/\[([\d\.\-:]+)\]/);
      if (timestampMatch) timestamp = timestampMatch[1];
    }

    if (line.includes('+refer') && line.includes('[')) {
      const match = line.match(/\[(\d+)\]/);
      if (match) {
        baseId = match[1];
      }
    }

    if ((line.includes('+unitPrices+') || line.includes('|          +')) && line.includes('[')) {
      const match = line.match(/\[([0-9.]+)\]/);
      if (match) {
        const price = parseFloat(match[1]);
        if (!isNaN(price)) {
          prices.push(price);
        }
      }
    }
  }

  if (baseId && prices.length === 100) {
    return { baseId, prices, timestamp };
  }

  return null;
}

export function getLogSize(): number {
  const logPath = getLogPath();
  if (!logPath || !fs.existsSync(logPath)) return 0;
  const stats = fs.statSync(logPath);
  return stats.size;
}

export function readLogFromPosition(start: number, end: number): string {
  const logPath = getLogPath();
  if (!logPath) return '';
  
  const buffer = Buffer.alloc(end - start);
  const fd = fs.openSync(logPath, 'r');
  fs.readSync(fd, buffer, 0, end - start, start);
  fs.closeSync(fd);
  return buffer.toString('utf-8');
}

export function ensureLogSizeLimit(maxSizeMB = 500): void {
  const logPath = getLogPath();
  if (!logPath || !fs.existsSync(logPath)) return;

  const stats = fs.statSync(logPath);
  const maxBytes = maxSizeMB * 1024 * 1024;

  if (stats.size <= maxBytes) return;

  const KEEP_BYTES = 5 * 1024 * 1024;
  const start = Math.max(0, stats.size - KEEP_BYTES);

  console.warn(`⚠️  Log file is ${Math.round(stats.size / 1024 / 1024)}MB — truncating...`);

  const fd = fs.openSync(logPath, 'r+');
  const buffer = Buffer.alloc(stats.size - start);
  fs.readSync(fd, buffer, 0, stats.size - start, start);
  fs.ftruncateSync(fd, 0);
  fs.writeSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);

  console.log(`✅ Log file truncated to last ${Math.round(KEEP_BYTES / 1024 / 1024)}MB`);
}