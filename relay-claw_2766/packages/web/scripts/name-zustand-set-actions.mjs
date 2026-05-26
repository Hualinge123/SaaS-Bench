/**
 * Add `set(partial, 'actionName')` labels for Redux DevTools.
 * Usage: node scripts/name-zustand-set-actions.mjs src/stores/chatStore.ts
 */
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/name-zustand-set-actions.mjs <file.ts>');
  process.exit(1);
}

const src = fs.readFileSync(file, 'utf8');
const openPatterns = ["(set, get) => ({", "(set) => ({", "(set, get) => ({"];
let bodyStart = -1;
let openLen = 0;
for (const p of openPatterns) {
  const idx = src.indexOf(p);
  if (idx >= 0) {
    bodyStart = idx + p.length;
    openLen = p.length;
    break;
  }
}
if (bodyStart < 0) {
  console.error(`store initializer not found in ${file}`);
  process.exit(1);
}

const bodyEnd = src.lastIndexOf('\n}));');
if (bodyEnd < 0) {
  console.error(`store end not found in ${file}`);
  process.exit(1);
}

const before = src.slice(0, bodyStart);
const body = src.slice(bodyStart, bodyEnd);
const after = src.slice(bodyEnd);

function resolveActionName(pos) {
  const prefix = body.slice(0, pos);
  const matches = [...prefix.matchAll(/^  ([A-Za-z_]\w*):/gm)];
  return matches.length > 0 ? matches[matches.length - 1][1] : 'unknown';
}

function findSetCallEnd(start) {
  if (body[start] !== '(') return -1;
  let depth = 0;
  let inStr = null;
  let escape = false;
  for (let j = start; j < body.length; j++) {
    const c = body[j];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

let i = 0;
let out = '';
let named = 0;
let skipped = 0;

while (i < body.length) {
  const rest = body.slice(i);
  // Only Zustand store `set(` at statement start — skip Map.set / other receivers.
  const setMatch = rest.match(/^(\s*)set\(/);
  if (setMatch) {
    const lineStart = body.lastIndexOf('\n', i - 1) + 1;
    const prefix = body.slice(lineStart, i);
    if (/\.[\w$]+\s*$/.test(prefix)) {
      out += body[i];
      i++;
      continue;
    }

    const callStart = i + setMatch[0].length - 1;
    const callEnd = findSetCallEnd(callStart);
    if (callEnd < 0) {
      out += body[i];
      i++;
      continue;
    }
    const callText = body.slice(i, callEnd + 1);
    const afterClose = body.slice(callEnd + 1);
    if (/^\s*,\s*'[^']+'\s*\)/.test(callText) || /,\s*'[^']+'\s*\)\s*$/.test(callText)) {
      out += callText;
      i = callEnd + 1;
      skipped++;
      continue;
    }
    if (/^\s*,\s*'/.test(afterClose)) {
      out += callText;
      i = callEnd + 1;
      skipped++;
      continue;
    }

    let action = resolveActionName(i);
    const inlineMethod = callText.match(/^(\s*)([A-Za-z_]\w*):\s*\([^)]*\)\s*=>\s*set\(/);
    if (inlineMethod) action = inlineMethod[2];

    const namedCall = callText.replace(/\)\s*$/, `, '${action}')`);
    out += namedCall;
    i = callEnd + 1;
    named++;
    continue;
  }

  out += body[i];
  i++;
}

fs.writeFileSync(file, before + out + after);
console.log(`${file}: named ${named} set() calls, skipped ${skipped} already named`);
