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

export interface MapEvent {
  timestamp: string;
  eventType: 'map_start' | 'map_end' | 'beacon_used';
  zonePath?: string;
  levelId?: number;
  beaconBaseId?: string;
  beaconName?: string;
  zoneEnglishName?: string;
  isHideout?: boolean; // Tag hideout events
}

// Default path (will be overridden by user selection)
const DEFAULT_LOG_PATH = '';

// Store userData path (set by main process)
let userDataPath: string | null = null;

// Store last read position for map events to enable incremental reading
let lastMapEventPosition = 0;

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
export function getSettings(): { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean; leagueId?: string } {
  const config = loadConfig();
  const settings = config.settings || {};
  if (!settings.leagueId || String(settings.leagueId).trim() === '') {
    settings.leagueId = 's11-vorax';
  }
  return settings;
}

/**
 * Save settings to config file (preserves log path)
 */
export function saveSettings(settings: { keybind?: string; fullscreenMode?: boolean; includeTax?: boolean; leagueId?: string }): void {
  const config = loadConfig();
  config.settings = { ...config.settings, ...settings };
  saveConfig(config);
}

function extractBaseId(fullId: string): string {
  return fullId.split('_')[0];
}

/**
 * Parse a BagMgr@:InitBagData line
 * Format: BagMgr@:InitBagData PageId = 102 SlotId = 1 ConfigBaseId = 100300 Num = 320
 */
function parseInitBagDataLine(line: string): ParsedLogEntry | null {
  if (!line.includes('BagMgr@:InitBagData')) return null;

  const pageMatch = line.match(/PageId\s*=\s*(\d+)/);
  const pageId = pageMatch ? parseInt(pageMatch[1]) : null;
  
  // Only process PageId 102 and 103
  if (pageId !== 102 && pageId !== 103) {
    return null;
  }

  const slotMatch = line.match(/SlotId\s*=\s*(\d+)/);
  const slotId = slotMatch ? parseInt(slotMatch[1]) : null;

  const baseIdMatch = line.match(/ConfigBaseId\s*=\s*(\d+)/);
  if (!baseIdMatch) return null;
  const baseId = baseIdMatch[1];

  const numMatch = line.match(/Num\s*=\s*(\d+)/);
  if (!numMatch) return null;
  const bagNum = parseInt(numMatch[1]);

  const timestampMatch = line.match(/\[([\d\.\-:]+)\]/);
  const timestamp = timestampMatch ? timestampMatch[1] : 'unknown';

  // For InitBagData, we create a synthetic fullId (since it doesn't have one)
  // We use baseId + pageId + slotId + timestamp to make it unique
  const fullId = `${baseId}_init_${pageId}_${slotId}_${timestamp}`;

  return {
    timestamp,
    action: 'Add',
    fullId,
    baseId,
    bagNum,
    slotId,
    pageId
  };
}

export function parseLogLine(line: string): ParsedLogEntry | null {
  const idMatch = line.match(/Id=([^\s]+)/);
  if (!idMatch) return null;
  
  const fullId = idMatch[1];
  const baseId = extractBaseId(fullId);

  let action = 'Unknown';
  if (line.includes('ItemChange@ Add')) action = 'Add';
  else if (line.includes('ItemChange@ Update')) action = 'Update';
  else if (line.includes('ItemChange@ Remove')) action = 'Remove';
  else if (line.includes('ItemChange@ Delete')) action = 'Delete';

  // Delete entries may not have BagNum (default to 0)
  const bagMatch = line.match(/BagNum=(\d+)/);
  let bagNum = 0;
  if (bagMatch) {
    bagNum = parseInt(bagMatch[1]);
  } else if (action !== 'Delete') {
    // Non-Delete entries must have BagNum
    return null;
  }

  // Match both "PageId=" and "in PageId=" formats
  const pageMatch = line.match(/in\s+PageId\s*=\s*(\d+)/) || line.match(/PageId\s*=\s*(\d+)/);
  const pageId = pageMatch ? parseInt(pageMatch[1]) : null;
  
  if (pageId !== 102 && pageId !== 103) {
    return null;
  }

  const timestampMatch = line.match(/\[([\d\.\-:]+)\]/);
  const timestamp = timestampMatch ? timestampMatch[1] : 'unknown';

  // Match both "SlotId=" and "in SlotId=" formats
  const slotMatch = line.match(/SlotId\s*=\s*(\d+)/);
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
    return [];
  }

  const stats = fs.statSync(logPath);
  const fileSize = stats.size;

  const startPosition = 0;

  const fd = fs.openSync(logPath, 'r');
  const buffer = Buffer.alloc(fileSize - startPosition);
  fs.readSync(fd, buffer, 0, fileSize - startPosition, startPosition);
  fs.closeSync(fd);

  const logContent = buffer.toString('utf-8');
  const lines = logContent.split('\n');

  // First, check if there's a ResetItemsLayout event (sort operation)
  // Look for the most recent ResetItemsLayout start/end pair
  let lastResetItemsLayoutStart = -1;
  let lastResetItemsLayoutEnd = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.includes('ItemChange@ ProtoName=ResetItemsLayout end') && lastResetItemsLayoutEnd === -1) {
      lastResetItemsLayoutEnd = i;
    }
    if (line.includes('ItemChange@ ProtoName=ResetItemsLayout start') && lastResetItemsLayoutStart === -1 && lastResetItemsLayoutEnd !== -1) {
      lastResetItemsLayoutStart = i;
      break;
    }
  }

  // If we found a ResetItemsLayout event, capture BagMgr@:InitBagData entries for both pages
  // AND also capture any ItemChange entries (like PickItems) that come after
  if (lastResetItemsLayoutStart !== -1 && lastResetItemsLayoutEnd !== -1) {
    const entries: ParsedLogEntry[] = [];
    
    // Look for InitBagData entries after the ResetItemsLayout end
    // Search until we hit another ResetItemsLayout start, or reach end of file
    // Use a larger initial window (500 lines) to ensure we capture all InitBagData entries
    // for pages 102 and 103, but continue searching if needed
    const initialSearchEnd = Math.min(lastResetItemsLayoutEnd + 500, lines.length);
    let foundInitBagData102 = false;
    let foundInitBagData103 = false;
    
    // First pass: collect InitBagData entries within initial window
    for (let i = lastResetItemsLayoutEnd; i < initialSearchEnd; i++) {
      const line = lines[i];
      
      // Stop if we hit another ResetItemsLayout start (new sort operation)
      if (line.includes('ItemChange@ ProtoName=ResetItemsLayout start')) {
        break;
      }
      
      // Parse InitBagData entries for PageId 102 and 103
      const parsed = parseInitBagDataLine(line);
      if (parsed) {
        // Check if we already have this slot (avoid duplicates)
        const existingIndex = entries.findIndex(e => 
          e.pageId === parsed.pageId && 
          e.slotId === parsed.slotId && 
          e.slotId !== null && 
          parsed.slotId !== null
        );
        
        if (existingIndex >= 0) {
          // Replace with newer entry (keep the latest)
          entries[existingIndex] = parsed;
        } else {
          entries.push(parsed);
        }
        
        if (parsed.pageId === 102) foundInitBagData102 = true;
        if (parsed.pageId === 103) foundInitBagData103 = true;
      }
    }
    
    // If we didn't find InitBagData for both pages in initial window, continue searching
    // This handles cases where there are many items or other log entries between InitBagData lines
    if (!foundInitBagData102 || !foundInitBagData103) {
      for (let i = initialSearchEnd; i < lines.length; i++) {
        const line = lines[i];
        
        // Stop if we hit another ResetItemsLayout start (new sort operation)
        if (line.includes('ItemChange@ ProtoName=ResetItemsLayout start')) {
          break;
        }
        
        // Parse InitBagData entries for PageId 102 and 103
        const parsed = parseInitBagDataLine(line);
        if (parsed) {
          // Check if we already have this slot (avoid duplicates)
          const existingIndex = entries.findIndex(e => 
            e.pageId === parsed.pageId && 
            e.slotId === parsed.slotId && 
            e.slotId !== null && 
            parsed.slotId !== null
          );
          
          if (existingIndex >= 0) {
            // Replace with newer entry (keep the latest)
            entries[existingIndex] = parsed;
          } else {
            entries.push(parsed);
          }
          
          if (parsed.pageId === 102) foundInitBagData102 = true;
          if (parsed.pageId === 103) foundInitBagData103 = true;
        }
        
        // Stop if we've found InitBagData for both pages and no more relevant entries likely
        // Continue a bit more to catch any stragglers (check 50 more lines after finding both)
        if (foundInitBagData102 && foundInitBagData103) {
          let checkMore = false;
          for (let j = i + 1; j < Math.min(i + 50, lines.length); j++) {
            if (lines[j].includes('BagMgr@:InitBagData')) {
              checkMore = true;
              break;
            }
            if (lines[j].includes('ItemChange@ ProtoName=ResetItemsLayout start')) {
              break;
            }
          }
          if (!checkMore) {
            break;
          }
        }
      }
    }
    
    // ALSO collect all ItemChange entries after the ResetItemsLayout end
    // This includes PickItems events and other item updates that happen after sorting
    for (let i = lastResetItemsLayoutEnd; i < lines.length; i++) {
      const line = lines[i];
      
      // Stop if we hit another ResetItemsLayout start (new sort operation)
      if (line.includes('ItemChange@ ProtoName=ResetItemsLayout start')) {
        break;
      }
      
      // Parse ItemChange entries (Add, Update, Remove, Delete) that come after the sort
      // Delete entries are included so the inventory manager can properly handle deletions
      if (line.includes('ItemChange@') && line.includes('Id=')) {
        const parsed = parseLogLine(line);
        if (parsed) {
          // First, check if we already have this exact fullId (for ItemChange entries)
          // This handles cases where the same item instance appears multiple times - keep the latest
          const duplicateIndex = entries.findIndex(e => e.fullId === parsed.fullId);
          if (duplicateIndex >= 0) {
            // Replace with newer entry (same fullId, but might have updated quantity)
            entries[duplicateIndex] = parsed;
          } else {
            // If this ItemChange entry corresponds to a slot we already have (from InitBagData or another ItemChange),
            // prefer the ItemChange entry (it's more recent and accurate)
            // Match by baseId + pageId + slotId to identify the same physical item stack
            // This handles cases where InitBagData shows quantity 600, then ItemChange@ Update shows quantity 664
            // Also handles multiple ItemChange updates for the same slot (replace older with newer)
            if (parsed.slotId !== null) {
              const existingIndex = entries.findIndex(e => 
                e.baseId === parsed.baseId &&
                e.pageId === parsed.pageId && 
                e.slotId === parsed.slotId && 
                e.slotId !== null
              );
              if (existingIndex >= 0) {
                // Replace existing entry (InitBagData or older ItemChange) with more recent ItemChange entry
                // The ItemChange entry has the updated quantity (or represents a new state)
                entries[existingIndex] = parsed;
              } else {
                // This is a new item instance (not in InitBagData, not in same slot, not a duplicate ItemChange)
                entries.push(parsed);
              }
            } else {
              // ItemChange entry without slotId - add it if not already present (rare case)
              entries.push(parsed);
            }
          }
        }
      }
    }
    
    // If we found entries, return them
    // These represent the complete state after sorting plus any updates (like PickItems)
    if (entries.length > 0) {
      return entries;
    }
    // If no entries found, fall through to normal processing
  }

  // Fall back to normal processing (find last reset for each page)
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

export function ensureLogSizeLimit(maxSizeMB = 300): void {
  try {
    const logPath = getLogPath();
    if (!logPath || !fs.existsSync(logPath)) return;

    const stats = fs.statSync(logPath);
    const maxBytes = maxSizeMB * 1024 * 1024;
    // Add 5MB buffer - start truncating at 295MB to prevent hitting 300MB limit
    // This gives us headroom and prevents crashes from reading huge files
    const TRUNCATE_THRESHOLD = maxBytes - (5 * 1024 * 1024);

    if (stats.size <= TRUNCATE_THRESHOLD) return;

    console.warn(`Log file is ${Math.round(stats.size / 1024 / 1024)}MB — truncating...`);

    // Re-check file size right before reading to avoid race condition where file grows
    // between size check and read (game is actively writing)
    const currentStats = fs.statSync(logPath);
    const currentSize = currentStats.size;

    // Search backwards from the end of the file in chunks to find ResetItemsLayout start event
    // We need to search ALL the way back to find it, even if it's at the beginning
    // This prevents deleting items - we search in 50MB chunks for memory efficiency
    const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB chunks
    const fd = fs.openSync(logPath, 'r');
    
    let lastResetStartPosition = -1;
    // Start searching from the end and work backwards to the beginning
    let searchEnd = currentSize;
    const searchStart = 0; // Search all the way to the beginning
    
    // Search backwards in chunks until we find the event or reach the beginning
    while (searchEnd > searchStart && lastResetStartPosition === -1) {
      // Calculate chunk boundaries (searching backwards)
      const chunkEnd = searchEnd;
      const chunkStart = Math.max(searchStart, chunkEnd - CHUNK_SIZE);
      const chunkSize = chunkEnd - chunkStart;
      
      const chunkBuffer = Buffer.alloc(chunkSize);
      fs.readSync(fd, chunkBuffer, 0, chunkSize, chunkStart);
      
      const chunkContent = chunkBuffer.toString('utf-8');
      const chunkLines = chunkContent.split('\n');
      
      // Search backwards through this chunk
      for (let i = chunkLines.length - 1; i >= 0; i--) {
        if (chunkLines[i].includes('ItemChange@ ProtoName=ResetItemsLayout start')) {
          // Found it! Calculate the exact byte position
          let byteOffsetInChunk = 0;
          for (let j = 0; j < i; j++) {
            byteOffsetInChunk += chunkLines[j].length + 1; // +1 for newline
          }
          lastResetStartPosition = chunkStart + byteOffsetInChunk;
          break;
        }
      }
      
      // Move to next chunk backwards
      if (lastResetStartPosition === -1) {
        searchEnd = chunkStart;
      }
    }
    
    fs.closeSync(fd);

    let start = 0;
    let truncationMessage = '';

    if (lastResetStartPosition !== -1) {
      start = lastResetStartPosition;
      truncationMessage = `truncating to last inventory sort (found at ${Math.round(start / 1024 / 1024)}MB)`;
    } else {
      // Fallback to keeping the last (maxSizeMB - 10MB) if no sort event found
      // This ensures file ends up well below threshold to prevent immediate re-trigger
      const KEEP_BYTES = (maxSizeMB - 10) * 1024 * 1024;
      start = Math.max(0, currentSize - KEEP_BYTES);
      truncationMessage = `no inventory sort found in last 250MB, keeping last ${maxSizeMB - 10}MB`;
    }

    console.warn(`Log file truncation: ${truncationMessage}, keeping ${Math.round((currentSize - start) / 1024 / 1024)}MB`);

    // Read only the portion we want to keep (from start to end)
    // This is much more memory-efficient than reading the entire file
    const keepSize = currentSize - start;
    const readFd = fs.openSync(logPath, 'r');
    const keepBuffer = Buffer.alloc(keepSize);
    fs.readSync(readFd, keepBuffer, 0, keepSize, start);
    fs.closeSync(readFd);
    
    // Write the truncated content
    const writeFd = fs.openSync(logPath, 'r+');
    fs.ftruncateSync(writeFd, 0);
    fs.writeSync(writeFd, keepBuffer, 0, keepBuffer.length, 0);
    fs.closeSync(writeFd);

  } catch (error: any) {
    console.error(`Failed to truncate log file: ${error.message || error}`);
    // Don't throw - we want the app to continue running even if truncation fails
  }
}

/**
 * Parse LevelId from a log line
 * Format: LevelId = 110
 */
function parseLevelId(line: string): number | undefined {
  const match = line.match(/LevelId\s*=\s*(\d+)/);
  return match ? parseInt(match[1]) : undefined;
}

/**
 * Parse zone path from a log line
 * Format: /Game/Art/Maps/01SD/XZ_YuJinZhiXiBiNanSuo200/...
 */
function parseZonePath(line: string): string | undefined {
  // Look for InMainLevelPath = /Game/Art/Maps/... pattern
  const pathMatch = line.match(/InMainLevelPath\s*=\s*(\/Game\/Art\/Maps\/[^\s]+)/);
  if (pathMatch) {
    // Extract the zone path (remove trailing World' prefix if present)
    let path = pathMatch[1];
    path = path.replace(/^World'/, '');
    return path;
  }
  return undefined;
}

/**
 * Parse beacon usage from ItemChange line
 * Format: ItemChange@ Add Id=400006_... ConfigBaseId=400006 ... ProtoName=ItemUseItem
 */
function parseBeaconUsage(line: string): { baseId: string | undefined, timestamp: string | undefined } {
  if (!line.includes('ItemChange@ Add') && !line.includes('ItemChange@ Update')) {
    return { baseId: undefined, timestamp: undefined };
  }

  const baseIdMatch = line.match(/ConfigBaseId\s*=\s*(\d+)/);
  const timestampMatch = line.match(/\[([\d\.\-:]+)\]/);

  // Check if this is a beacon item (400006, 400007, 400008, etc.)
  const baseId = baseIdMatch ? baseIdMatch[1] : undefined;
  const beaconBaseIds = ['400006', '400007', '400008', '400014', '400015', '400021', '400022', '400027', '400028'];
  
  if (baseId && beaconBaseIds.includes(baseId)) {
    return {
      baseId,
      timestamp: timestampMatch ? timestampMatch[1] : undefined
    };
  }

  return { baseId: undefined, timestamp: undefined };
}

/**
 * Parse map-related events from the log file
 * Returns an array of map events (map start/end/beacon usage)
 */
export function parseMapEvents(): MapEvent[] {
  const logPath = getLogPath();

  if (!logPath || !fs.existsSync(logPath)) {
    return [];
  }

  const stats = fs.statSync(logPath);
  const fileSize = stats.size;

  // If file is smaller than last position (file was rotated/reset), start from beginning
  if (fileSize < lastMapEventPosition) {
    lastMapEventPosition = 0;
  }

  // If no new content, return empty array
  if (fileSize <= lastMapEventPosition) {
    return [];
  }

  const fd = fs.openSync(logPath, 'r');
  // Only read new content since last position
  const bufferSize = fileSize - lastMapEventPosition;
  const buffer = Buffer.alloc(bufferSize);
  fs.readSync(fd, buffer, 0, bufferSize, lastMapEventPosition);
  fs.closeSync(fd);

  // Update last read position
  lastMapEventPosition = fileSize;

  const logContent = buffer.toString('utf-8');
  const lines = logContent.split('\n');

  const mapEvents: MapEvent[] = [];

  // Hideout/hub zone patterns
  const HIDEOUT_PATTERNS = ['XZ_YuJinZhiXiBiNanSuo', 'DD_ShengTingZhuangYuan', 'UIMainLevel'];

  for (const line of lines) {
    if (!line.trim()) continue;

    const timestampMatch = line.match(/\[([\d\.\-:]+)\]/);
    const timestamp = timestampMatch ? timestampMatch[1] : 'unknown';

    // Detect map start events: OpenMainWorld END
    if (line.includes('OpenMainWorld END!')) {
      const zonePath = parseZonePath(line);
      const levelId = parseLevelId(line);
      
      // Check if this is a hideout/hub zone
      const isHideout = HIDEOUT_PATTERNS.some(pattern => zonePath && zonePath.includes(pattern));
      
      if (isHideout) {
        // Entering hideout - end current map first
        mapEvents.push({
          timestamp,
          eventType: 'map_end'
        });
      }
      
      // Always log the map start (even for hideouts and maps without zonePath)
      mapEvents.push({
        timestamp,
        eventType: 'map_start',
        zonePath,
        levelId,
        isHideout // Tag hideout events
      });
    }

    // Detect beacon usage events
    const { baseId, timestamp: beaconTimestamp } = parseBeaconUsage(line);
    if (baseId && beaconTimestamp) {
      mapEvents.push({
        timestamp: beaconTimestamp,
        eventType: 'beacon_used',
        beaconBaseId: baseId
      });
    }
  }

  return mapEvents;
}

/**
 * Reset map event reading position (call when clearing history or file changes)
 */
export function resetMapEventPosition(): void {
  // Set to current file size so we only track NEW events from this point forward
  // This prevents old events from being re-read
  const logPath = getLogPath();
  if (logPath && fs.existsSync(logPath)) {
    const stats = fs.statSync(logPath);
    lastMapEventPosition = stats.size;
  } else {
    lastMapEventPosition = 0;
  }
}