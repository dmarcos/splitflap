import { CHAR_INDEX } from './atlas.js';

const COLOR_NAMES = {
  r: 'R', red: 'R',
  o: 'O', orange: 'O',
  y: 'Y', yellow: 'Y',
  g: 'G', green: 'G',
  b: 'B', blue: 'B',
  v: 'V', violet: 'V', purple: 'V',
  w: 'W', white: 'W',
  n: 'N', brown: 'N',
  t: 'T', tan: 'T',
};

const SUBSTITUTES = {
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '–': '-', '—': '-', '…': '...', 'º': '°',
};

export function hasLiveTokens(text) {
  return /\{(time|date)\}/i.test(text);
}

function expandLive(text, now = new Date()) {
  return text.replace(/\{(time|date)\}/gi, (_, key) =>
    key.toLowerCase() === 'time'
      ? now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  );
}

// One entry per board cell: a character from CHARS or a color token like "{R}".
function tokenize(line) {
  const cells = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '{') {
      const end = line.indexOf('}', i);
      const name = end > i ? line.slice(i + 1, end).toLowerCase() : '';
      if (COLOR_NAMES[name]) {
        cells.push(`{${COLOR_NAMES[name]}}`);
        i = end;
        continue;
      }
    }
    const ch = line[i].toUpperCase();
    for (const c of SUBSTITUTES[ch] ?? ch) cells.push(CHAR_INDEX.has(c) ? c : ' ');
  }
  return cells;
}

function wrap(cells, cols) {
  const words = [];
  let word = [];
  for (const c of cells) {
    if (c === ' ') {
      if (word.length) words.push(word);
      word = [];
    } else {
      word.push(c);
    }
  }
  if (word.length) words.push(word);

  const lines = [];
  let line = [];
  for (let w of words) {
    while (w.length > cols) {
      if (line.length) lines.push(line);
      line = [];
      lines.push(w.slice(0, cols));
      w = w.slice(cols);
    }
    if (!w.length) continue;
    if (!line.length) line = [...w];
    else if (line.length + 1 + w.length <= cols) line.push(' ', ...w);
    else {
      lines.push(line);
      line = [...w];
    }
  }
  if (line.length || !lines.length) lines.push(line);
  return lines;
}

// Returns rows x cols of CHARS indices.
export function layout(text, rows, cols, align = 'center') {
  const lines = expandLive(text)
    .split(/\r?\n/)
    .flatMap((p) => {
      // Lines that fit keep their spacing exactly, so pictures drawn with color
      // tiles and spaces stay intact; longer lines are word-wrapped.
      const cells = tokenize(p);
      return cells.length <= cols ? [cells] : wrap(cells, cols);
    });
  while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
  const visible = lines.slice(0, rows);

  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const top = Math.max(0, Math.floor((rows - visible.length) / 2));
  visible.forEach((line, k) => {
    const left = align === 'center' ? Math.floor((cols - line.length) / 2) : 0;
    line.forEach((c, j) => {
      grid[top + k][left + j] = CHAR_INDEX.get(c);
    });
  });
  return grid;
}
