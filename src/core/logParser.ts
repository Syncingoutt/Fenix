import * as fs from 'fs';

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

// Common Steam installation paths
const STEAM_PATHS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\SteamLibrary',
  'D:\\Steam',
  'E:\\SteamLibrary',
  'E:\\Steam',
  'F:\\SteamLibrary',
  'F:\\Steam'
];

function findLogPath(): string {
  const logFileName = 'UE_game\\TorchLight\\Saved\\Logs\\UE_Game.log';
  const gamePath = 'steamapps\\common\\Torchlight Infinite';
  
  // First, try the most common specific paths
  const specificPaths = [
    'D:\\SteamLibrary\\steamapps\\common\\Torchlight Infinite\\UE_game\\TorchLight\\Saved\\Logs\\UE_Game.log',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Torchlight Infinite\\UE_game\\TorchLight\\Saved\\Logs\\UE_Game.log',
    'C:\\Program Files\\Steam\\steamapps\\common\\Torchlight Infinite\\UE_game\\TorchLight\\Saved\\Logs\\UE_Game.log'
  ];
  
  for (const path of specificPaths) {
    if (fs.existsSync(path)) {
      return path;
    }
  }
  
  // Then, try to find Steam installation and check for the game
  for (const steamPath of STEAM_PATHS) {
    if (fs.existsSync(steamPath)) {
      const fullPath = `${steamPath}\\${gamePath}\\${logFileName}`;
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  
  // If still not found, check all drive letters (A-Z)
  const driveLetters = 'CDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < driveLetters.length; i++) {
    const drive = `${driveLetters[i]}:\\`;
    if (fs.existsSync(drive)) {
      // Check common Steam paths on this drive
      const possiblePaths = [
        `${drive}SteamLibrary\\steamapps\\common\\Torchlight Infinite\\UE_game\\TorchLight\\Saved\\Logs\\UE_Game.log`,
        `${drive}Steam\\steamapps\\common\\Torchlight Infinite\\UE_game\\TorchLight\\Saved\\Logs\\UE_Game.log`,
        `${drive}Program Files (x86)\\Steam\\steamapps\\common\\Torchlight Infinite\\UE_game\\TorchLight\\Saved\\Logs\\UE_Game.log`,
        `${drive}Program Files\\Steam\\steamapps\\common\\Torchlight Infinite\\UE_game\\TorchLight\\Saved\\Logs\\UE_Game.log`
      ];
      
      for (const path of possiblePaths) {
        if (fs.existsSync(path)) {
          return path;
        }
      }
    }
  }
  
  throw new Error('Could not find Torchlight Infinite log file. Please ensure the game is installed via Steam.');
}

const LOG_PATH = findLogPath();

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
  if (!fs.existsSync(LOG_PATH)) {
    console.error(`❌ Log file not found at: ${LOG_PATH}`);
    return [];
  }

  const stats = fs.statSync(LOG_PATH);
  const fileSize = stats.size;

  const MAX_READ_BYTES = 100 * 1024 * 1024; // 100 MB
  const startPosition = fileSize > MAX_READ_BYTES ? fileSize - MAX_READ_BYTES : 0;

  const fd = fs.openSync(LOG_PATH, 'r');
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

export function getLogPath(): string {
  return LOG_PATH;
}

export function getLogSize(): number {
  if (!fs.existsSync(LOG_PATH)) return 0;
  const stats = fs.statSync(LOG_PATH);
  return stats.size;
}

export function readLogFromPosition(start: number, end: number): string {
  const buffer = Buffer.alloc(end - start);
  const fd = fs.openSync(LOG_PATH, 'r');
  fs.readSync(fd, buffer, 0, end - start, start);
  fs.closeSync(fd);
  return buffer.toString('utf-8');
}

export function ensureLogSizeLimit(maxSizeMB = 500): void {
  if (!fs.existsSync(LOG_PATH)) return;

  const stats = fs.statSync(LOG_PATH);
  const maxBytes = maxSizeMB * 1024 * 1024;

  if (stats.size <= maxBytes) return;

  const KEEP_BYTES = 5 * 1024 * 1024;
  const start = Math.max(0, stats.size - KEEP_BYTES);

  console.warn(`⚠️  Log file is ${Math.round(stats.size / 1024 / 1024)}MB — truncating...`);

  const fd = fs.openSync(LOG_PATH, 'r+');
  const buffer = Buffer.alloc(stats.size - start);
  fs.readSync(fd, buffer, 0, stats.size - start, start);
  fs.ftruncateSync(fd, 0);
  fs.writeSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);

  console.log(`✅ Log file truncated to last ${Math.round(KEEP_BYTES / 1024 / 1024)}MB`);
}