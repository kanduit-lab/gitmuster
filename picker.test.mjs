import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { renderPicker, selectRepositories, updateSelection } from './picker.mjs';

const rows = [
  { name: 'first', branch: 'main', behind: 3, ahead: 0, selectable: true },
  { name: 'dirty', branch: 'feature', behind: 2, ahead: 0, selectable: false, reason: 'local changes' },
  { name: 'last', branch: 'master', behind: 1, ahead: 0, selectable: true },
];

function terminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  let screen = '';
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  output.isTTY = true;
  output.columns = 100;
  output.rows = 24;
  output.on('data', data => { screen += data; });
  return { input, output, screen: () => screen };
}

test('selection excludes disabled rows and preserves previous state', () => {
  const original = { cursor: 0, selected: new Set() };
  const checked = updateSelection(rows, original, 'toggle');
  assert.equal(original.selected.size, 0);
  assert.deepEqual([...checked.selected], [0]);
  const disabled = updateSelection(rows, checked, 'down');
  assert.equal(updateSelection(rows, disabled, 'toggle'), disabled);
  assert.deepEqual([...updateSelection(rows, disabled, 'all').selected], [0, 2]);
  assert.equal(updateSelection(rows, updateSelection(rows, disabled, 'all'), 'all').selected.size, 0);
  assert.equal(updateSelection(rows, original, 'up').cursor, 2);
});

test('viewport scrolls within terminal height and strips control sequences', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ ...rows[0], name: `repo-${index}` }));
  const rendered = renderPicker(many, { cursor: 29, selected: new Set() }, { columns: 80, lines: 14 });
  assert.ok(rendered.includes('repo-29'));
  assert.ok(!rendered.includes('repo-0\r'));
  assert.ok(rendered.split('\r\n').length <= 14);
  // Measured in display cells, not string length: color codes add characters that never
  // reach the terminal.
  const plain = stripVTControlCharacters(rendered);
  assert.ok(plain.split('\r\n').every(line => line.length < 80));
  const unsafe = renderPicker([{ ...rows[0], name: '\u001b[31mhello\nworld' }], { cursor: 0, selected: new Set() });
  assert.ok(!unsafe.includes('hello\nworld'));
  assert.ok(stripVTControlCharacters(unsafe).includes('hello world'));
});

test('keypress stream selects original rows and restores terminal', async () => {
  const tty = terminal();
  const selected = selectRepositories(rows, tty);
  tty.input.write(' \u001b[B \u001b[B \r');
  assert.deepEqual(await selected, [rows[0], rows[2]]);
  assert.equal(tty.input.isRaw, false);
  assert.equal(tty.input.isPaused(), true);
  assert.equal(tty.input.listenerCount('keypress'), 0);
  assert.ok(tty.screen().endsWith('\u001b[?25h\u001b[?1049l'));
});

test('cancel, empty selection, resize and non-TTY paths', async () => {
  for (const key of ['q', '\u001b', '\u0003', '\r']) {
    const tty = terminal();
    const selected = selectRepositories(rows, tty);
    tty.output.rows = 10;
    tty.output.emit('resize');
    tty.input.write(key);
    assert.deepEqual(await selected, key === '\r' ? [] : null);
    assert.equal(tty.input.isRaw, false);
  }
  await assert.rejects(selectRepositories(rows, { input: new PassThrough(), output: new PassThrough() }), /terminal/);
});

test('stream failure restores terminal before rejecting', async () => {
  const tty = terminal();
  tty.input.isRaw = true;
  const selected = selectRepositories(rows, tty);
  tty.input.emit('error', new Error('terminal disconnected'));
  await assert.rejects(selected, /disconnected/);
  assert.equal(tty.input.isRaw, true);
  assert.equal(tty.output.listenerCount('resize'), 0);
  assert.ok(tty.screen().endsWith('\u001b[?25h\u001b[?1049l'));
});
