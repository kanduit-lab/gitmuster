import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { discoverRepositories, inspectRepository, pullRepository, scanRepositories } from './repositories.mjs';

const execute = promisify(execFile);
const ignoreFile = path.join(await mkdtemp(path.join(os.tmpdir(), 'gitmuster-config-')), 'gitconfig');
await writeFile(ignoreFile, '');
test.after(() => rm(path.dirname(ignoreFile), { recursive: true, force: true }));
// Git on Windows rejects NUL as a config path, so tests ignore host config through an empty file.
const silent = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: ignoreFile, GIT_CONFIG_SYSTEM: ignoreFile };

async function run(directory, ...args) {
  const { stdout } = await execute('git', ['-C', directory, ...args], { encoding: 'utf8', env: silent });
  return stdout.trim();
}

async function commit(directory, message) {
  await writeFile(path.join(directory, 'file.txt'), message);
  await run(directory, 'add', '-A');
  await run(directory, 'commit', '-m', message);
}

async function fixture(branch = 'main') {
  const base = await mkdtemp(path.join(os.tmpdir(), 'gitmuster-'));
  const origin = path.join(base, 'origin.git');
  const clone = path.join(base, 'clone');
  await execute('git', ['init', '--bare', '--initial-branch', branch, origin], { env: silent });
  await execute('git', ['clone', origin, clone], { env: silent });
  await run(clone, 'checkout', '-b', branch);
  await commit(clone, 'initial');
  await run(clone, 'push', '-u', 'origin', branch);
  return { base, origin, clone, branch };
}

async function addRemoteCommit(origin, branch, message) {
  const other = await mkdtemp(path.join(os.tmpdir(), 'gitmuster-peer-'));
  await execute('git', ['clone', '--branch', branch, origin, other], { env: silent });
  await commit(other, message);
  await run(other, 'push', 'origin', branch);
  await rm(other, { recursive: true, force: true });
}

test('discoverRepositories returns sorted repositories and filters unknown folders', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitmuster-root-'));
  for (const name of ['b-repo', 'a-repo', 'plain']) await mkdir(path.join(root, name));
  await execute('git', ['init', '-q', path.join(root, 'b-repo')], { env: silent });
  await execute('git', ['init', '-q', path.join(root, 'a-repo')], { env: silent });
  await mkdir(path.join(root, '.hidden'));
  const repositories = await discoverRepositories(root);
  assert.deepEqual(repositories.map(repo => repo.name), ['a-repo', 'b-repo']);
  assert.deepEqual((await discoverRepositories(root, ['b-repo'])).map(repo => repo.name), ['b-repo']);
  await assert.rejects(discoverRepositories(root, ['missing']), /Unknown repository folder: missing/);
  await rm(root, { recursive: true, force: true });
});

test('inspectRepository reports selectable state for a clean tracked branch', async () => {
  const { base, clone, branch } = await fixture();
  try {
    await run(clone, 'fetch', '--all');
    const row = await inspectRepository({ name: 'clone', directory: clone });
    assert.equal(row.branch, branch);
    assert.equal(row.upstream, `origin/${branch}`);
    assert.equal(row.remote, 'origin');
    assert.equal(row.behind, 0);
    assert.equal(row.ahead, 0);
    assert.equal(row.selectable, false);
    assert.equal(row.reason, 'up to date');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('detached HEAD, missing upstream and local changes are not selectable', async () => {
  const { base, clone, branch } = await fixture();
  try {
    await writeFile(path.join(clone, 'file.txt'), 'dirty');
    const dirty = await inspectRepository({ name: 'clone', directory: clone });
    assert.equal(dirty.selectable, false);
    assert.equal(dirty.reason, 'local changes');

    await run(clone, 'checkout', '--', 'file.txt');
    await run(clone, 'checkout', '-b', 'local-only');
    const untracked = await inspectRepository({ name: 'clone', directory: clone });
    assert.equal(untracked.reason, 'no upstream');

    await run(clone, 'checkout', branch);
    await run(clone, 'checkout', '--detach', 'HEAD');
    const detached = await inspectRepository({ name: 'clone', directory: clone });
    assert.equal(detached.selectable, false);
    assert.equal(detached.branch, 'detached HEAD');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('scanRepositories fetches new upstream commits and pullRepository advances head', async () => {
  const { base, origin, clone, branch } = await fixture();
  try {
    await addRemoteCommit(origin, branch, 'remote one');
    await addRemoteCommit(origin, branch, 'remote two');
    const [row] = await scanRepositories([{ name: 'clone', directory: clone }]);
    assert.equal(row.behind, 2);
    assert.equal(row.ahead, 0);
    assert.equal(row.selectable, true);
    const updated = await pullRepository(row);
    assert.equal(updated.received, 2);
    assert.equal(updated.behind, 0);
    assert.equal(updated.selectable, false);
    assert.equal(updated.reason, 'up to date');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('pullRepository refuses diverged, dirty and stale selections', async () => {
  const { base, origin, clone, branch } = await fixture();
  try {
    await addRemoteCommit(origin, branch, 'remote one');
    const [row] = await scanRepositories([{ name: 'clone', directory: clone }]);
    assert.equal(row.behind, 1);

    await commit(clone, 'local one');
    const diverged = await inspectRepository({ name: 'clone', directory: clone });
    assert.equal(diverged.reason, 'diverged');

    await writeFile(path.join(clone, 'file.txt'), 'dirty');
    await assert.rejects(pullRepository(row), /local changes|Repository changed/);

    await run(clone, 'checkout', '--', 'file.txt');
    await run(clone, 'reset', '--hard', 'HEAD~1');
    const fresh = (await scanRepositories([{ name: 'clone', directory: clone }]))[0];
    assert.equal(fresh.reason, '');
    await addRemoteCommit(origin, branch, 'remote two');
    await run(clone, 'fetch', '--all');
    await assert.rejects(pullRepository(fresh), /Repository changed since selection/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('no-fetch reports the last fetch without contacting the remote', async () => {
  const { base, origin, clone, branch } = await fixture();
  try {
    await addRemoteCommit(origin, branch, 'remote one');
    const [fetched] = await scanRepositories([{ name: 'clone', directory: clone }]);
    assert.equal(fetched.behind, 1);

    await addRemoteCommit(origin, branch, 'remote two');
    const [stale] = await scanRepositories([{ name: 'clone', directory: clone }], () => {}, { fetch: false });
    assert.equal(stale.behind, 1, 'the new remote commit is invisible without a fetch');
    assert.equal(stale.selectable, true);

    const [refreshed] = await scanRepositories([{ name: 'clone', directory: clone }]);
    assert.equal(refreshed.behind, 2);

    // A refused pull must still be refused under no-fetch, since pull re-inspects first.
    await writeFile(path.join(clone, 'file.txt'), 'dirty');
    const [dirty] = await scanRepositories([{ name: 'clone', directory: clone }], () => {}, { fetch: false });
    assert.equal(dirty.reason, 'local changes');
    assert.equal(dirty.selectable, false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('fetch failure is reported on the row instead of throwing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitmuster-broken-'));
  try {
    await execute('git', ['init', '-q', root], { env: silent });
    await run(root, 'checkout', '-b', 'main');
    await commit(root, 'initial');
    await run(root, 'remote', 'add', 'origin', path.join(root, 'does-not-exist.git'));
    await run(root, 'branch', '--set-upstream-to=main', 'main');
    await run(root, 'config', 'branch.main.remote', 'origin');
    await run(root, 'config', 'branch.main.merge', 'refs/heads/main');
    const [row] = await scanRepositories([{ name: 'broken', directory: root }]);
    assert.equal(row.selectable, false);
    assert.equal(row.reason, 'fetch/inspection failed');
    assert.ok(row.error);
    assert.ok((await readdir(root)).length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
