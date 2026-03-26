import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface ChangedFile {
  path: string;
  status: string; // 'M' | 'A' | 'D' | 'R' | '??'
}

/**
 * Find all git repositories within a project path (including nested ones).
 * Searches up to maxDepth levels for .git directories.
 */
export function findGitRepos(projectPath: string, maxDepth = 3): string[] {
  const repos: string[] = [];

  // Check if the project root itself is a git repo
  if (fs.existsSync(path.join(projectPath, '.git'))) {
    repos.push(projectPath);
  }

  function walk(dirPath: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (fs.existsSync(path.join(fullPath, '.git'))) {
        repos.push(fullPath);
      } else {
        walk(fullPath, depth + 1);
      }
    }
  }

  // Only walk subdirectories if we haven't already found a repo at root,
  // or always walk to find nested repos within a mono-repo parent
  walk(projectPath, 1);

  return repos;
}

/**
 * Get changed files for a git repository using `git status --porcelain=v1`.
 */
export function getChangedFiles(repoPath: string): ChangedFile[] {
  try {
    const output = execSync('git status --porcelain=v1', {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();

    if (!output) return [];

    return output.split('\n').map((line) => {
      const status = line.slice(0, 2).trim();
      const filePath = line.slice(3);
      return { path: filePath, status };
    });
  } catch {
    return [];
  }
}

/**
 * Get the diff for a specific file in a git repository.
 * Returns { oldContent, newContent } for use with MonacoDiffEditor.
 */
export function getFileDiff(
  repoPath: string,
  filePath: string,
): { oldContent: string; newContent: string } {
  const fullPath = path.join(repoPath, filePath);

  try {
    // Try to get the original (HEAD) version
    let oldContent = '';
    try {
      oldContent = execSync(`git show HEAD:${filePath}`, {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 10000,
      });
    } catch {
      // File is new (untracked or newly added) — no old content
      oldContent = '';
    }

    // Get current file content
    let newContent = '';
    try {
      newContent = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      // File was deleted
      newContent = '';
    }

    return { oldContent, newContent };
  } catch {
    return { oldContent: '', newContent: '' };
  }
}
