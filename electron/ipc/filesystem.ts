import fs from 'fs';
import path from 'path';

const IGNORED_NAMES = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  '__pycache__',
  '.next',
  '.venv',
  '.turbo',
  '.cache',
  'Thumbs.db',
]);

const DEFAULT_MAX_BYTES = 1_048_576; // 1 MB

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}

export interface FileContentResult {
  content: string | null;
  truncated: boolean;
  totalSize: number;
  binary: boolean;
}

export function readDirectory(dirPath: string): DirEntry[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result: DirEntry[] = [];

  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);
    const isDir = entry.isDirectory();
    let size = 0;
    try {
      if (!isDir) {
        size = fs.statSync(fullPath).size;
      }
    } catch {
      // skip entries we can't stat
      continue;
    }
    result.push({ name: entry.name, isDirectory: isDir, size });
  }

  // Sort: directories first, then files, both alphabetical (case-insensitive)
  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return result;
}

export interface SearchResult {
  relativePath: string;
  isDirectory: boolean;
}

export function searchFiles(rootPath: string, query: string, maxResults = 50): SearchResult[] {
  const lowerQuery = query.toLowerCase();
  const results: SearchResult[] = [];
  const maxDepth = 10;

  function walk(dirPath: string, depth: number): void {
    if (depth > maxDepth || results.length >= maxResults) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (IGNORED_NAMES.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.relative(rootPath, fullPath);
      const isDir = entry.isDirectory();

      if (relPath.toLowerCase().includes(lowerQuery)) {
        results.push({ relativePath: relPath, isDirectory: isDir });
      }

      if (isDir) {
        walk(fullPath, depth + 1);
      }
    }
  }

  walk(rootPath, 0);
  return results;
}

export function writeFileContent(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function readFileContent(
  filePath: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
): FileContentResult {
  const stat = fs.statSync(filePath);
  const totalSize = stat.size;

  // Check for binary by reading first 512 bytes
  const peekSize = Math.min(512, totalSize);
  if (peekSize > 0) {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(peekSize);
    fs.readSync(fd, buf, 0, peekSize, 0);
    fs.closeSync(fd);
    if (buf.includes(0)) {
      return { content: null, truncated: false, totalSize, binary: true };
    }
  }

  const truncated = totalSize > maxBytes;
  const bytesToRead = truncated ? maxBytes : totalSize;

  if (bytesToRead === 0) {
    return { content: '', truncated: false, totalSize, binary: false };
  }

  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(bytesToRead);
  fs.readSync(fd, buf, 0, bytesToRead, 0);
  fs.closeSync(fd);

  return {
    content: buf.toString('utf-8'),
    truncated,
    totalSize,
    binary: false,
  };
}
