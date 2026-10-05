#!/usr/bin/env node
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
const [owner, expiry, output, ...scopes] = process.argv.slice(2);
const allowed = [
  'places:read',
  'places:lookup',
  'places:create',
  'visits:create',
  'places:location:update',
];
if (
  !owner?.includes('@') ||
  !(Date.parse(expiry) > Date.now()) ||
  !output ||
  scopes.some((s) => !allowed.includes(s))
) {
  console.error(
    'Usage: node scripts/create-agent-token.mjs OWNER_EMAIL EXPIRY_ISO REGISTRY_FILE [SCOPES...]',
  );
  process.exit(1);
}
const path = resolve(output);
if (path.includes('/docs/') || /\.(ts|js|md)$/.test(path))
  throw new Error('Use a private JSON registry outside source files.');
let registry = [];
try {
  registry = JSON.parse(await readFile(path, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!Array.isArray(registry) || registry.length >= 100)
  throw new Error('Registry must be an array of fewer than 100 tokens.');
const token = 'qp_' + randomBytes(32).toString('base64url');
const record = {
  tokenId: randomUUID(),
  identity: owner.toLowerCase(),
  scopes: scopes.length
    ? scopes
    : ['places:read', 'places:lookup', 'places:create'],
  hash: createHash('sha256').update(token).digest('hex'),
  expiresAt: new Date(expiry).toISOString(),
  disabled: false,
};
registry.push(record);
await writeFile(path, JSON.stringify(registry, null, 2) + '\n', {
  mode: 0o600,
});
await chmod(path, 0o600);
// Explicitly invoked by the owner: one-time credential display, never log in a Worker.
process.stdout.write(
  `Token ID: ${record.tokenId}\nBearer token (save securely; displayed once): ${token}\nRegistry written to ${path}\n`,
);
