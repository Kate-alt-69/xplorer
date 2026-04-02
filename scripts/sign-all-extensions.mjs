#!/usr/bin/env node
/**
 * Sign all built extensions with the Ed25519 private key from EXTENSION_SIGNING_KEY env var.
 *
 * Usage:
 *   EXTENSION_SIGNING_KEY=<hex-encoded-32-byte-key> node scripts/sign-all-extensions.mjs
 *
 * Or put EXTENSION_SIGNING_KEY in your .env file and run:
 *   node -e "require('dotenv').config()" && node scripts/sign-all-extensions.mjs
 *
 * The key is a 64-char hex string (32 bytes). Generate one with:
 *   cd apps/src-tauri && cargo test generate_signing_keypair -- --nocapture
 */
import { createHash, sign } from 'crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
// Load .env manually (no dotenv dependency needed)
try {
  const envContent = readFileSync('.env', 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch { /* no .env file */ }

const SIGNING_KEY_HEX = process.env.EXTENSION_SIGNING_KEY;
if (!SIGNING_KEY_HEX) {
  console.error('ERROR: EXTENSION_SIGNING_KEY env var not set.');
  console.error('Add it to .env: EXTENSION_SIGNING_KEY=<64-char-hex-string>');
  console.error('Generate with: cd apps/src-tauri && cargo test generate_signing_keypair -- --nocapture');
  process.exit(1);
}

const SIGNER = 'Xplorer Team';

/**
 * Recursively hash all files in a directory (excluding .sig).
 * Matches the Rust hash_extension_contents logic.
 */
const hashExtensionContents = (dir) => {
  const hash = createHash('sha256');
  const files = [];

  const walk = (d) => {
    for (const entry of readdirSync(d).sort()) {
      const full = join(d, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry !== '.sig') {
        files.push(full);
      }
    }
  };

  walk(dir);

  for (const file of files) {
    const rel = relative(dir, file);
    const content = readFileSync(file);
    hash.update(rel);
    hash.update(content);
  }

  return hash.digest('hex');
};

/**
 * Sign a hash with Ed25519.
 */
const signHash = (hashHex, privateKeyHex) => {
  const keyBuffer = Buffer.from(privateKeyHex, 'hex');
  // Node.js crypto expects the private key in PKCS8 or raw format
  // For Ed25519, we need to create the proper key object
  const privateKey = {
    key: Buffer.concat([
      // Ed25519 PKCS8 prefix
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      keyBuffer,
    ]),
    format: 'der',
    type: 'pkcs8',
  };

  const signature = sign(null, Buffer.from(hashHex, 'utf-8'), privateKey);
  return signature.toString('hex');
};

// Find all extension directories with dist/index.js
const extensionsDir = join(process.cwd(), 'packages', 'extensions');
const dataDirs = [
  join(process.cwd(), 'apps', 'src-tauri', 'data', 'extensions'),
];

const allExtDirs = [];

// Scan packages/extensions
if (existsSync(extensionsDir)) {
  for (const name of readdirSync(extensionsDir)) {
    const dir = join(extensionsDir, name);
    if (statSync(dir).isDirectory() && existsSync(join(dir, 'dist', 'index.js'))) {
      allExtDirs.push(dir);
    }
  }
}

// Scan built-in extensions in data/extensions
for (const dataDir of dataDirs) {
  if (!existsSync(dataDir)) continue;
  for (const name of readdirSync(dataDir)) {
    const dir = join(dataDir, name);
    if (statSync(dir).isDirectory() && existsSync(join(dir, 'dist', 'index.js'))) {
      allExtDirs.push(dir);
    }
  }
}

console.log(`Found ${allExtDirs.length} extensions to sign\n`);

let signed = 0;
let failed = 0;

for (const dir of allExtDirs) {
  try {
    const hash = hashExtensionContents(dir);
    const signature = signHash(hash, SIGNING_KEY_HEX);
    const timestamp = new Date().toISOString();

    const sigInfo = {
      hash,
      signer: SIGNER,
      timestamp,
      verified: true,
      ed25519_signature: signature,
    };

    writeFileSync(join(dir, '.sig'), JSON.stringify(sigInfo, null, 2));

    const name = dir.split('/').pop();
    console.log(`  ✓ ${name}: ${hash.slice(0, 16)}...`);
    signed++;
  } catch (err) {
    const name = dir.split('/').pop();
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

console.log(`\nDone. Signed: ${signed}, Failed: ${failed}`);
