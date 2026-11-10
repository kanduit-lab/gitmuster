#!/usr/bin/env node
import { FETCH_WORKERS, discoverRepositories, pullRepository, scanRepositories } from './repositories.mjs';
import { selectRepositories, supportsColor } from './picker.mjs';

const COLOR = supportsColor(process.stdout);
const paint = (open, text) => (COLOR ? `\u001b[${open}m${text}\u001b[0m` : text);
const dim = text => paint('2', text);
const bold = text => paint('1', text);
const green = text => paint('32', text);
const red = text => paint('31', text);
const yellow = text => paint('33', text);
const cyan = text => paint('36', text);
const magenta = text => paint('35', text);

const HELP = `gitmuster — fetch and fast-forward-pull every Git repository in the current folder

USAGE
  gitmuster sync [options]        Fetch each repository and show incoming/outgoing commits
  gitmuster pull [options]        Fetch, then pick repositories in a TUI and pull them
  gitmuster help                  Show this help

OPTIONS
  --folders "repo-a,repo-b"   Limit the run to exact folder names
  --no-fetch                  Read the state of the last fetch instead of contacting remotes

Run gitmuster from the folder that holds the repositories; that folder is the target.
TUI: arrows / j k move, Space checks, a checks all eligible, Enter pulls, q cancels.
Only immediate child folders with .git are included. Counts use the current branch's
upstream. Pull uses fast-forward only; local changes, diverged branches, missing
upstreams, detached HEAD and ongoing Git operations are skipped. Nothing is pushed.
`;

const USAGE = 'Usage: gitmuster <sync|pull> [--folders "repo-a,repo-b"] [--no-fetch]';

function parseArguments(args) {
  const options = { command: 'help', folders: [], fetch: true };
  let folderFilterGiven = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--folders') {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} needs a value. ${USAGE}`);
      index += 1;
      folderFilterGiven = true;
      options.folders.push(...value.split(',').map(name => name.trim()).filter(Boolean));
      continue;
    }
    if (argument === '--no-fetch') { options.fetch = false; continue; }
    if (argument === '--fetch') { options.fetch = true; continue; }
    if (argument === 'help' || argument === '--help' || argument === '-h') continue;
    if (['sync', 'pull'].includes(argument)) { options.command = argument; continue; }
    throw new Error(`Unknown argument: ${argument}. ${USAGE}`);
  }
  if (folderFilterGiven && options.folders.length === 0) {
    throw new Error(`Specify at least one folder. ${USAGE}`);
  }
  return options;
}

function statusLabel(row) {
  if (row.error) return red('fetch failed');
  if (!row.selectable) return row.reason === 'up to date' ? dim('up to date') : red(row.reason || 'unavailable');
  if (row.reason === 'up to date') return dim('up to date');
  return green('ready to pull');
}

// Padding is applied to the plain text first: escape codes would otherwise be counted
// as characters and push the columns out of line.
function countLabel(value, tone) {
  const text = value === undefined || value === null ? '-' : String(value);
  const padded = text.padStart(4);
  if (value === undefined || value === null) return dim(padded);
  return value === 0 ? dim(padded) : tone(padded);
}

function printRows(rows, fetched = true) {
  const nameWidth = Math.max(6, ...rows.map(row => row.name.length));
  const branchWidth = Math.max(6, ...rows.map(row => (row.branch || '-').length));
  console.log(`${'FOLDER'.padEnd(nameWidth)}  ${'BRANCH'.padEnd(branchWidth)}  ${'IN'.padStart(4)}  ${'OUT'.padStart(4)}  STATUS`);
  for (const row of rows) {
    const name = (row.selectable ? row.name : dim(row.name)).padEnd(nameWidth);
    const branch = magenta((row.branch || '-').padEnd(branchWidth));
    console.log(`${name}  ${branch}  ${countLabel(row.behind, cyan)}  ${countLabel(row.ahead, yellow)}  ${statusLabel(row)}`);
    if (row.error) console.error(`  ${red(row.error)}`);
  }
  const incoming = rows.reduce((sum, row) => sum + (row.behind || 0), 0);
  const ready = rows.filter(row => row.selectable).length;
  console.log(`\n${bold(String(rows.length))} repositories  ${cyan(String(incoming))} incoming commits  ${green(String(ready))} ready to pull`);
  if (!fetched) {
    console.log(yellow('Counts are from the last fetch; run without --no-fetch to refresh them.'));
  }
}

function progressLine(index, total, name, result, width = 16) {
  const counter = dim(`${String(index).padStart(String(total).length)}/${total}`);
  const filled = Math.round((index / total) * width);
  const bar = `${green('\u2588'.repeat(filled))}${dim('\u2591'.repeat(width - filled))}`;
  const label = `${result} ${name}`;
  return `  ${counter} ${bar} ${label}`;
}

// A terminal redraws one line in place; a piped log would lose the record, so each
// repository still gets its own line there.
const inPlace = Boolean(process.stdout.isTTY);
function reportLine(index, total, name, result) {
  if (inPlace) process.stdout.write(`\r\u001b[2K${progressLine(index, total, name, result)}`);
  else console.log(progressLine(index, total, name, result));
}
function finishProgress() {
  if (inPlace) process.stdout.write('\r\u001b[2K');
}

async function main() {
  const { command, folders, fetch } = parseArguments(process.argv.slice(2));
  if (command === 'help') { process.stdout.write(HELP); return; }
  if (command === 'pull' && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error('gitmuster pull needs an interactive terminal. Run it directly in Windows Terminal, PowerShell or Git Bash.');
  }
  const cwd = process.cwd();
  const repositories = await discoverRepositories(cwd, folders);
  if (!repositories.length) { console.log(`No Git repositories found in ${cwd}.`); return; }
  if (fetch) {
    console.log(`${bold('Fetching')} ${repositories.length} repositories ${dim(`(up to ${FETCH_WORKERS} at once)`)}`);
  } else {
    console.log(`${bold('Reading')} ${repositories.length} repositories ${dim('(no fetch; counts come from the last one)')}`);
  }
  let seen = 0;
  const rows = await scanRepositories(repositories, row => {
    seen += 1;
    reportLine(seen, repositories.length, row.name, row.error ? red('FAIL') : green('  ok'));
  }, { fetch });
  finishProgress();
  console.log('');
  printRows(rows, fetch);
  process.exitCode = rows.some(row => row.error) ? 1 : 0;
  if (command === 'sync' || !rows.some(row => row.selectable)) return;
  const selected = await selectRepositories(rows);
  if (!selected?.length) { console.log(dim('No repositories pulled.')); return; }
  console.log(`${bold('Pulling')} ${selected.length} selected repositories`);
  let pulled = 0;
  for (const row of selected) {
    pulled += 1;
    try {
      const updated = await pullRepository(row);
      reportLine(pulled, selected.length, row.name, green(`ok   +${updated.received}`));
    } catch (error) {
      finishProgress();
      console.error(progressLine(pulled, selected.length, row.name, red(`FAIL ${error.message}`)));
      process.exitCode = 1;
    }
  }
  finishProgress();
  console.log('');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
