import { emitKeypressEvents } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';

const ENTER_SCREEN = '\u001b[?1049h\u001b[?25l';
const LEAVE_SCREEN = '\u001b[?25h\u001b[?1049l';
const RESET_SCREEN = '\u001b[H\u001b[2J';

const paint = (open, text, color) => (color ? `\u001b[${open}m${text}\u001b[0m` : text);
const dim = (text, color) => paint('2', text, color);
const bold = (text, color) => paint('1', text, color);
const green = (text, color) => paint('32', text, color);
const red = (text, color) => paint('31', text, color);
const yellow = (text, color) => paint('33', text, color);
const cyan = (text, color) => paint('36', text, color);
const magenta = (text, color) => paint('35', text, color);

export function supportsColor(stream) {
  // FORCE_COLOR wins over NO_COLOR: an explicit request should not be cancelled by an
  // ambient default, and checking NO_COLOR first made FORCE_COLOR silently ineffective.
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  if (process.env.NO_COLOR) return false;
  return Boolean(stream?.isTTY);
}

function plainText(value) {
  return stripVTControlCharacters(String(value ?? '')).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}

function characterWidth(character) {
  const code = character.codePointAt(0);
  if (/\p{Mark}/u.test(character)) return 0;
  return code >= 0x1100 && (
    code <= 0x115f || code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) ||
    code >= 0x1f300
  ) ? 2 : 1;
}

export function displayWidth(value) {
  let used = 0;
  for (const character of plainText(value)) used += characterWidth(character);
  return used;
}

function truncate(value, width) {
  const plain = plainText(value);
  if (displayWidth(plain) <= width) return plain;
  let text = '';
  let used = 0;
  for (const character of plain) {
    const size = characterWidth(character);
    if (used + size > width - 1) break;
    text += character;
    used += size;
  }
  return `${text}…`;
}

function pad(value, width) {
  const plain = plainText(value);
  return plain + ' '.repeat(Math.max(0, width - displayWidth(plain)));
}

function padLeft(value, width) {
  return ' '.repeat(Math.max(0, width - displayWidth(value))) + plainText(value);
}

// Layout is computed from plain values and colored afterwards, so escape codes never
// shift a column or leak into the width calculation.
export function layoutRow(row, index, state, width, color) {
  const selected = state.selected.has(index);
  const marker = row.selectable ? (selected ? green('[x]', color) : dim('[ ]', color)) : dim('[-]', color);
  const cursor = state.cursor === index ? cyan('\u276f', color) : ' ';

  const nameWidth = Math.max(8, Math.min(34, width - 46));
  const name = pad(truncate(row.name, nameWidth), nameWidth);
  const shownName = row.selectable && selected ? bold(name, color) : dim(name, color);

  const branch = pad(truncate(row.branch || '(no branch)', 18), 18);
  const arrow = (glyph, value, tone) => {
    if (value === undefined || value === null) return dim(`${glyph} \u2013`, color);
    return value === 0 ? dim(`${glyph} 0`, color) : tone(`${glyph} ${value}`, color);
  };
  const counts = `${arrow('\u2193', row.behind, cyan)} ${arrow('\u2191', row.ahead, yellow)}`;

  let status;
  if (!row.selectable) {
    // 'up to date' is a healthy end state, not a refusal; only real blockers read as red.
    status = row.reason === 'up to date' ? dim('up to date', color) : red(truncate(row.reason || 'unavailable', 26), color);
  } else if (selected) status = green('ready to pull', color);
  else status = dim(truncate(row.reason || 'ready to pull', 26), color);

  return `${cursor} ${marker} ${shownName}  ${magenta(branch, color)}  ${counts}  ${status}`;
}

export function updateSelection(rows, state, key) {
  const { cursor, selected } = state;
  if (key === 'up') return { ...state, cursor: (cursor - 1 + rows.length) % rows.length };
  if (key === 'down') return { ...state, cursor: (cursor + 1) % rows.length };
  if (key === 'all') {
    const eligible = rows.flatMap((row, index) => row.selectable ? [index] : []);
    return { ...state, selected: eligible.every(index => selected.has(index)) ? new Set() : new Set(eligible) };
  }
  if (key !== 'toggle' || !rows[cursor]?.selectable) return state;
  const next = new Set(selected);
  if (next.has(cursor)) next.delete(cursor);
  else next.add(cursor);
  return { ...state, selected: next };
}

function renderHeader(width, color, ready, total) {
  const title = bold('gitmuster', color);
  const subtitle = dim('select repositories to pull', color);
  const counter = `${green(String(ready), color)} ${dim(`ready / ${total} total`, color)}`;
  const left = `${title}  ${subtitle}`;
  const gap = Math.max(1, width - displayWidth(left) - displayWidth(counter));
  return `${left}${' '.repeat(gap)}${counter}`;
}

export function renderPicker(rows, state, { columns = 100, lines = 24, color = true } = {}) {
  const width = Math.max(1, columns - 1);
  if (lines < 8 || columns < 24) {
    return ['Enlarge terminal to select repositories.', 'q / Esc: cancel']
      .slice(0, Math.max(1, lines - 1)).map(line => truncate(line, width)).join('\r\n');
  }
  const readyCount = rows.filter(row => row.selectable).length;
  const visibleCount = Math.max(1, Math.floor((lines - 8) / 2));
  const start = Math.max(0, Math.min(state.cursor - Math.floor(visibleCount / 2), rows.length - visibleCount));
  const shown = rows.slice(start, start + visibleCount);
  const body = shown.flatMap((row, offset) => layoutRow(row, start + offset, state, width, color));
  if (rows.length === 0) body.push(dim('  No repositories found.', color));

  const checked = state.selected.size;
  const progress = readyCount ? Math.round((checked / readyCount) * 100) : 0;
  const barWidth = Math.max(10, Math.min(28, width - 40));
  const filled = Math.round((progress / 100) * barWidth);
  const bar = `${green('\u2588'.repeat(filled), color)}${dim('\u2591'.repeat(barWidth - filled), color)}`;
  const range = rows.length ? `${start + 1}-${start + shown.length}` : '0';

  const content = [
    renderHeader(width, color, readyCount, rows.length),
    dim('  \u2191/\u2193 j/k move   Space check   a all   Enter pull   q cancel', color),
    dim(`  ${bar} ${checked} of ${readyCount} checked  (${range} of ${rows.length} shown)`, color),
    '',
    ...body,
    '',
  ];
  return content.map(line => (displayWidth(line) > width ? truncate(line, width) : line)).join('\r\n');
}

export async function selectRepositories(rows, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Interactive selection needs a terminal. Run gitmuster pull in a terminal, or specify repository folders.');
  }
  if (rows.length === 0) return [];
  const color = supportsColor(output);
  const wasRaw = Boolean(input.isRaw);
  const wasFlowing = input.readableFlowing === true;
  let state = { cursor: 0, selected: new Set() };
  let finished = false;
  let resolveSelection;
  let rejectSelection;
  const selection = new Promise((resolve, reject) => {
    resolveSelection = resolve;
    rejectSelection = reject;
  });
  function finish(value) {
    if (finished) return;
    finished = true;
    resolveSelection(value);
  }
  function fail(error) {
    if (finished) return;
    finished = true;
    rejectSelection(error);
  }
  function draw() {
    try {
      output.write(RESET_SCREEN + renderPicker(rows, state, { columns: output.columns, lines: output.rows, color }));
    } catch (error) {
      fail(error);
    }
  }
  function onKeypress(character, key = {}) {
    if (finished) return;
    if (key.name === 'escape' || character === 'q' || (key.ctrl && key.name === 'c')) return finish(null);
    if (key.name === 'return' || key.name === 'enter') {
      return finish(rows.filter((row, index) => row.selectable && state.selected.has(index)));
    }
    const action = key.name === 'up' || character === 'k' ? 'up'
      : key.name === 'down' || character === 'j' ? 'down'
      : character === ' ' ? 'toggle' : character === 'a' ? 'all' : null;
    if (action) {
      state = updateSelection(rows, state, action);
      draw();
    }
  }
  const cancel = () => finish(null);
  try {
    emitKeypressEvents(input);
    input.on('keypress', onKeypress);
    input.on('error', fail);
    input.on('end', cancel);
    output.on('error', fail);
    output.on('resize', draw);
    process.on('SIGINT', cancel);
    process.on('SIGTERM', cancel);
    input.setRawMode(true);
    input.resume();
    output.write(ENTER_SCREEN);
    draw();
    return await selection;
  } finally {
    input.removeListener('keypress', onKeypress);
    input.removeListener('error', fail);
    input.removeListener('end', cancel);
    output.removeListener('error', fail);
    output.removeListener('resize', draw);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    try {
      input.setRawMode(wasRaw);
    } finally {
      if (!wasFlowing) input.pause();
      output.write(LEAVE_SCREEN);
    }
  }
}
