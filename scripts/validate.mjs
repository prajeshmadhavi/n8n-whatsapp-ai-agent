// Structural check for the n8n workflow JSON. No dependencies (node:fs only).
// Usage: node scripts/validate.mjs [path/to/workflow.json ...]
// Exits 1 if any check fails.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2);
if (files.length === 0) {
  for (const f of readdirSync('workflows')) if (f.endsWith('.json')) files.push(join('workflows', f));
}

const REQUIRED = ['id', 'name', 'type', 'typeVersion', 'position', 'parameters'];
const CONNECTION_TYPES = new Set(['main', 'ai_languageModel', 'ai_memory', 'ai_tool', 'ai_outputParser']);
const SECRET_PATTERNS = [
  [/EAA[A-Za-z0-9]{20,}/, 'Meta access token (EAA...)'],
  [/sk-ant-[A-Za-z0-9_-]+/, 'Anthropic API key (sk-ant-...)'],
  [/\b[a-fA-F0-9]{32,}\b/, 'long hex string (possible token/secret)'],
  [/Bearer\s+[A-Za-z0-9._-]{20,}/, 'hard-coded Bearer token'],
  [/ya29\.[A-Za-z0-9_-]+/, 'Google OAuth access token'],
];

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log('  FAIL ' + msg);
};
const pass = (msg) => console.log('  ok   ' + msg);

function walkStrings(value, path, cb) {
  if (typeof value === 'string') cb(value, path);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, cb));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      cb(k, `${path}.<key>`);
      walkStrings(v, `${path}.${k}`, cb);
    }
}

for (const file of files) {
  console.log(`\n${file}`);
  const before = failures;

  let wf;
  try {
    wf = JSON.parse(readFileSync(file, 'utf8'));
    pass('JSON parses');
  } catch (e) {
    fail(`JSON does not parse: ${e.message}`);
    continue;
  }

  if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) {
    fail('"nodes" missing or empty');
    continue;
  }
  if (!wf.connections || typeof wf.connections !== 'object') fail('"connections" missing');

  // Nodes
  const names = new Set();
  const ids = new Set();
  for (const n of wf.nodes) {
    const label = n.name || n.id || '(unnamed)';
    for (const key of REQUIRED) if (!(key in n)) fail(`node "${label}" missing "${key}"`);
    if (typeof n.type !== 'string' || !n.type.includes('.')) fail(`node "${label}" has bad type "${n.type}"`);
    if (typeof n.typeVersion !== 'number') fail(`node "${label}" typeVersion is not a number`);
    if (!Array.isArray(n.position) || n.position.length !== 2 || !n.position.every(Number.isFinite))
      fail(`node "${label}" position must be [x, y]`);
    if (typeof n.parameters !== 'object' || n.parameters === null) fail(`node "${label}" parameters must be an object`);
    if (names.has(n.name)) fail(`duplicate node name "${n.name}"`);
    if (ids.has(n.id)) fail(`duplicate node id "${n.id}"`);
    names.add(n.name);
    ids.add(n.id);

    // Credentials: placeholder name only, never an id or inline secret
    for (const [credType, cred] of Object.entries(n.credentials || {})) {
      if (!cred || typeof cred.name !== 'string' || !cred.name) fail(`node "${label}" credential ${credType} has no name`);
      const extra = Object.keys(cred || {}).filter((k) => k !== 'name');
      if (extra.length) fail(`node "${label}" credential ${credType} has extra keys: ${extra.join(', ')}`);
    }
  }
  if (failures === before) pass(`${wf.nodes.length} nodes have id, name, type, typeVersion, position, parameters; names and ids unique`);

  // Connections
  const beforeConn = failures;
  let edges = 0;
  for (const [source, outputs] of Object.entries(wf.connections || {})) {
    if (!names.has(source)) fail(`connection source "${source}" is not a node`);
    for (const [connType, branches] of Object.entries(outputs)) {
      if (!CONNECTION_TYPES.has(connType)) fail(`connection "${source}" uses unknown type "${connType}"`);
      for (const branch of branches || []) {
        for (const edge of branch || []) {
          edges++;
          if (!names.has(edge.node)) fail(`connection "${source}" -> "${edge.node}" targets a missing node`);
          if (edge.type !== connType) fail(`connection "${source}" -> "${edge.node}" type mismatch (${edge.type} vs ${connType})`);
          if (!Number.isInteger(edge.index)) fail(`connection "${source}" -> "${edge.node}" has no integer index`);
        }
      }
    }
  }
  if (failures === beforeConn) pass(`${edges} connections reference existing nodes`);

  // Every non-sticky node should be wired to something
  const wired = new Set(Object.keys(wf.connections || {}));
  for (const outputs of Object.values(wf.connections || {}))
    for (const branches of Object.values(outputs)) for (const b of branches || []) for (const e of b || []) wired.add(e.node);
  const orphans = wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote' && !wired.has(n.name));
  if (orphans.length) fail(`unconnected nodes: ${orphans.map((n) => n.name).join(', ')}`);
  else pass('no unconnected nodes (sticky notes excluded)');

  // Secrets
  const beforeSecrets = failures;
  walkStrings(wf, '$', (s, path) => {
    for (const [re, what] of SECRET_PATTERNS) if (re.test(s)) fail(`possible secret at ${path}: ${what}`);
  });
  if (failures === beforeSecrets) pass('no strings that look like secrets');
}

console.log(failures ? `\nFAILED: ${failures} problem(s)` : '\nPASSED: all checks');
process.exit(failures ? 1 : 0);
