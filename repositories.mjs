import { execFile } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const GIT_TIMEOUT_MS = 90_000;
export const FETCH_WORKERS = 4;
const OPERATION_FILES = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_START'];

export async function git(directory, args) {
  try {
    const { stdout } = await execute('git', ['-C', directory, ...args], {
      encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    });
    return stdout.trim();
  } catch (error) {
    const detail = error.killed ? 'Git timed out after 90 seconds' : error.stderr?.trim() || error.message;
    throw new Error(detail.replace(/(https?:\/\/)[^\s/@]+@/g, '$1[redacted]@'));
  }
}

// A probe into a folder the user cannot read is "not there" for discovery purposes;
// letting EACCES escape would abort the whole scan over one protected directory.
async function exists(filename) {
  try { await access(filename); return true; }
  catch { return false; }
}

export async function discoverRepositories(root, folders = []) {
  const entries = await readdir(root, { withFileTypes: true });
  const directories = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
  const candidates = await Promise.all(directories.map(async entry => {
    const directory = path.join(root, entry.name);
    return await exists(path.join(directory, '.git')) ? { name: entry.name, directory } : null;
  }));
  const repositories = candidates.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const unknown = folders.filter(name => !repositories.some(repo => repo.name === name));
  if (unknown.length) throw new Error(`Unknown repository folder: ${unknown.join(', ')}`);
  return folders.length ? repositories.filter(repo => folders.includes(repo.name)) : repositories;
}

// One git process per inspection step matters: process startup dominates on Windows,
// so every --git-path target arrives in a single call instead of one call per file.
async function operationInProgress(directory) {
  const locations = (await git(directory, ['rev-parse', ...OPERATION_FILES.flatMap(name => ['--git-path', name])]))
    .split(/\r?\n/).filter(Boolean);
  for (const location of locations) {
    if (await exists(path.resolve(directory, location))) return true;
  }
  return false;
}

export async function inspectRepository(repo) {
  const branch = await git(repo.directory, ['branch', '--show-current']);
  if (!branch) return { ...repo, branch: 'detached HEAD', selectable: false, reason: 'detached HEAD' };
  const tracking = await git(repo.directory, ['for-each-ref', '--format=%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)', `refs/heads/${branch}`]);
  const [upstream, remote, remoteRef] = tracking.split('\0');
  if (!upstream) return { ...repo, branch, selectable: false, reason: 'no upstream' };
  const [counts, status, busy, head, upstreamHead] = await Promise.all([
    git(repo.directory, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']),
    git(repo.directory, ['status', '--porcelain=v1', '--untracked-files=normal']),
    operationInProgress(repo.directory),
    git(repo.directory, ['rev-parse', 'HEAD']),
    git(repo.directory, ['rev-parse', '@{upstream}']),
  ]);
  const [ahead, behind] = counts.split(/\s+/).map(Number);
  const reason = busy ? 'Git operation in progress' : status ? 'local changes' : ahead && behind ? 'diverged' : behind ? '' : ahead ? 'local commits only' : 'up to date';
  return { ...repo, branch, upstream, remote, remoteRef, ahead, behind, head, upstreamHead,
    selectable: !reason, reason };
}

export async function scanRepositories(repositories, onProgress = () => {}, { fetch = true } = {}) {
  let next = 0;
  let reportFrom = 0;
  const rows = Array(repositories.length);
  // Workers finish out of order, so each result is held until every earlier index
  // has reported; otherwise progress lines arrive shuffled.
  const flush = () => {
    while (reportFrom < repositories.length && rows[reportFrom]) onProgress(rows[reportFrom++]);
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_WORKERS, repositories.length) }, async () => {
    while (next < repositories.length) {
      const index = next++;
      const repo = repositories[index];
      try {
        if (fetch) await git(repo.directory, ['fetch', '--all', '--prune']);
        rows[index] = await inspectRepository(repo);
      } catch (error) {
        const reason = fetch ? 'fetch/inspection failed' : 'inspection failed';
        rows[index] = { ...repo, branch: '-', selectable: false, reason, error: error.message };
      }
      flush();
    }
  }));
  return rows;
}

export async function pullRepository(row) {
  const current = await inspectRepository(row);
  if (!current.selectable) throw new Error(current.reason);
  if (current.branch !== row.branch || current.head !== row.head || current.upstream !== row.upstream || current.upstreamHead !== row.upstreamHead) {
    throw new Error('Repository changed since selection; run gitmuster pull again');
  }
  await git(row.directory, ['-c', 'merge.autostash=false', '-c', 'rebase.autostash=false',
    '-c', 'fetch.recurseSubmodules=false', 'pull', '--ff-only', '--no-rebase',
    '--no-autostash', '--no-recurse-submodules', '--', current.remote, current.remoteRef]);
  const updated = await inspectRepository(row);
  return { ...updated, received: Number(await git(row.directory, ['rev-list', '--count', `${current.head}..HEAD`])) };
}
