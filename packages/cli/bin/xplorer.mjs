#!/usr/bin/env node

/**
 * Xplorer CLI
 *
 * Usage:
 *   xplorer [folder]              Open a folder in Xplorer
 *   xplorer login                 Authenticate with xplorer.space
 *   xplorer logout                Clear stored credentials
 *   xplorer whoami                Show current user
 *   xplorer publish               Build & publish extension to marketplace
 *   xplorer extensions            List your published extensions
 *   xplorer --help                Show help
 *   xplorer --version             Show version
 */

import { resolve, join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';

const VERSION = '1.0.0';
const API_URL = process.env.XPLORER_API_URL || 'https://xplorer.space/api';
const CONFIG_DIR = join(homedir(), '.xplorer');
const TOKEN_FILE = join(CONFIG_DIR, 'auth.json');

// ── Helpers ──────────────────────────────────────────────────────────────────

const loadToken = () => {
  try {
    if (existsSync(TOKEN_FILE)) {
      const data = JSON.parse(readFileSync(TOKEN_FILE, 'utf-8'));
      return data.token || null;
    }
  } catch {
    /* ignore */
  }
  return null;
};

const saveToken = (token, user) => {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify({ token, user }, null, 2));
};

const clearToken = () => {
  if (existsSync(TOKEN_FILE)) {
    writeFileSync(TOKEN_FILE, '{}');
  }
};

const apiFetch = async (path, options = {}) => {
  const token = loadToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  return res;
};

const print = (msg) => process.stdout.write(msg + '\n');
const error = (msg) => {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
};

// ── Commands ─────────────────────────────────────────────────────────────────

const showHelp = () => {
  print(`
Xplorer CLI v${VERSION}

Usage:
  xplorer [folder]              Open a folder in Xplorer app
  xplorer .                     Open current directory
  xplorer login                 Login to xplorer.space marketplace
  xplorer logout                Clear stored credentials
  xplorer whoami                Show current user info
  xplorer publish               Build & publish current extension
  xplorer extensions            List your published extensions
  xplorer create [name]         Scaffold a new extension
  xplorer --help, -h            Show this help
  xplorer --version, -v         Show version

Environment:
  XPLORER_API_URL               Marketplace API URL (default: https://xplorer.space/api)

Config: ~/.xplorer/auth.json
`);
};

const openFolder = (folderPath) => {
  const absPath = resolve(folderPath);
  if (!existsSync(absPath)) {
    error(`Path does not exist: ${absPath}`);
  }

  // Try to open with Xplorer desktop app
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      execSync(`open -a Xplorer "${absPath}"`, { stdio: 'pipe' });
    } else if (platform === 'win32') {
      execSync(`start xplorer://"${absPath}"`, { stdio: 'pipe' });
    } else {
      // Linux: try xdg-open with custom protocol, or direct binary
      try {
        execSync(`xdg-open "xplorer://${absPath}"`, { stdio: 'pipe' });
      } catch {
        execSync(`xplorer "${absPath}"`, { stdio: 'pipe' });
      }
    }
    print(`Opening ${absPath} in Xplorer...`);
  } catch {
    error(`Could not open Xplorer. Is the app installed?\n  Path: ${absPath}`);
  }
};

const login = async () => {
  // Generate a device code and poll for token (simplified: use API key for now)
  print('Login to xplorer.space\n');
  print('1. Go to: https://xplorer.space/auth/signin');
  print('2. After signing in, go to: https://xplorer.space/dashboard/settings');
  print('3. Click "Generate CLI Token" and copy it.\n');

  // Read token from stdin
  process.stdout.write('Paste your API token: ');
  const token = await new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      if (data.includes('\n')) {
        process.stdin.pause();
        resolve(data.trim());
      }
    });
    process.stdin.resume();
  });

  if (!token) error('No token provided.');

  // Verify the token
  try {
    const res = await fetch(`${API_URL}/user/token`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const user = await res.json();
      saveToken(token, user);
      print(`\nLogged in as ${user.name || user.username || user.email || 'user'}`);
    } else {
      error('Invalid token. Please check and try again.');
    }
  } catch (err) {
    error(`Failed to verify token: ${err.message}`);
  }
};

const logout = () => {
  clearToken();
  print('Logged out. Credentials cleared.');
};

const whoami = () => {
  try {
    if (existsSync(TOKEN_FILE)) {
      const data = JSON.parse(readFileSync(TOKEN_FILE, 'utf-8'));
      if (data.user) {
        print(`Logged in as: ${data.user.name || data.user.email || 'unknown'}`);
        if (data.user.username) print(`Username: ${data.user.username}`);
        return;
      }
    }
  } catch {
    /* ignore */
  }
  print('Not logged in. Run: xplorer login');
};

const ask = (question) => new Promise((resolve) => {
  process.stdout.write(question);
  let data = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => {
    data += chunk;
    if (data.includes('\n')) {
      process.stdin.pause();
      process.stdin.removeAllListeners('data');
      resolve(data.trim());
    }
  });
  process.stdin.resume();
});

const CATEGORIES = ['Themes', 'Previews', 'Productivity', 'Developer Tools', 'Cloud Storage', 'Security', 'Media', 'Utilities'];

const publish = async () => {
  const token = loadToken();
  if (!token) error('Not logged in. Run: xplorer login');

  // Find package.json
  const pkgPath = resolve('package.json');
  if (!existsSync(pkgPath)) {
    error('No package.json found. Run this from an extension directory.');
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const manifest = pkg.xplorer || {};

  print('\n  Xplorer Extension Publisher\n');
  print('  Fill in the details below. Press Enter to accept defaults shown in [brackets].\n');

  // Interactive prompts with defaults from package.json
  const id = await ask(`  Extension ID [${manifest.id || pkg.name || ''}]: `) || manifest.id || pkg.name;
  if (!id) error('Extension ID is required.');

  const displayName = await ask(`  Display Name [${manifest.displayName || manifest.name || id}]: `) || manifest.displayName || manifest.name || id;
  const description = await ask(`  Description [${manifest.description || pkg.description || ''}]: `) || manifest.description || pkg.description || '';
  const version = await ask(`  Version [${manifest.version || pkg.version || '1.0.0'}]: `) || manifest.version || pkg.version || '1.0.0';

  // Category selection
  print('\n  Categories (pick up to 3, comma-separated numbers):');
  CATEGORIES.forEach((cat, i) => print(`    ${i + 1}. ${cat}`));
  const catInput = await ask('  Categories []: ');
  const selectedCategories = catInput
    ? catInput.split(',').map(n => CATEGORIES[parseInt(n.trim()) - 1]).filter(Boolean)
    : (manifest.categories || []);

  const icon = await ask(`  Icon (lucide icon name) [${manifest.icon || ''}]: `) || manifest.icon || '';
  const repoUrl = await ask(`  Repository URL [${pkg.repository?.url || ''}]: `) || pkg.repository?.url || '';
  const homepage = await ask(`  Homepage URL [${pkg.homepage || ''}]: `) || pkg.homepage || '';
  const license = await ask(`  License [${pkg.license || 'MIT'}]: `) || pkg.license || 'MIT';

  // Pricing
  const pricingInput = await ask('  Pricing (free/paid) [free]: ') || 'free';
  const pricing = pricingInput.toLowerCase() === 'paid' ? 'paid' : 'free';

  // Confirm
  print('\n  Summary:');
  print(`    ID:          ${id}`);
  print(`    Name:        ${displayName}`);
  print(`    Version:     ${version}`);
  print(`    Description: ${description.slice(0, 60)}${description.length > 60 ? '...' : ''}`);
  print(`    Categories:  ${selectedCategories.join(', ') || 'none'}`);
  print(`    License:     ${license}`);
  print(`    Pricing:     ${pricing}`);
  print('');

  const confirm = await ask('  Publish? (y/n) [y]: ') || 'y';
  if (confirm.toLowerCase() !== 'y') {
    print('  Cancelled.');
    return;
  }

  // Build
  print('\n  Building...');
  try {
    execSync('npm run build 2>&1 || pnpm build 2>&1', { stdio: 'pipe', shell: true });
  } catch {
    error('Build failed. Fix build errors and try again.');
  }

  // Check dist exists
  const distPath = resolve('dist', 'index.js');
  if (!existsSync(distPath)) {
    error('No dist/index.js found after build.');
  }

  // Package zip (include .sig if it exists)
  print('  Packaging...');
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('package.json', readFileSync(pkgPath));
  zip.file('dist/index.js', readFileSync(distPath));

  const sigPath = resolve('.sig');
  if (existsSync(sigPath)) {
    zip.file('.sig', readFileSync(sigPath));
    print('  Including .sig (signed extension)');
  }

  // Include README if exists
  const readmePath = resolve('README.md');
  if (existsSync(readmePath)) {
    zip.file('README.md', readFileSync(readmePath));
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const checksum = createHash('sha256').update(zipBuffer).digest('hex');

  // Upload
  print('  Uploading to xplorer.space...');
  const formData = new FormData();
  formData.append('file', new Blob([zipBuffer]), `${id}.zip`);
  formData.append('name', id);
  formData.append('displayName', displayName);
  formData.append('description', description);
  formData.append('version', version);
  formData.append('license', license);
  formData.append('pricing', pricing);
  formData.append('icon', icon);
  formData.append('checksum', checksum);
  if (selectedCategories.length > 0) formData.append('categories', JSON.stringify(selectedCategories));
  if (manifest.permissions) formData.append('permissions', JSON.stringify(manifest.permissions));
  if (repoUrl) formData.append('repositoryUrl', repoUrl);
  if (homepage) formData.append('homepageUrl', homepage);

  try {
    const res = await fetch(`${API_URL}/extensions/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (res.ok) {
      const data = await res.json();
      print(`\n  ✓ Published! ${data.slug || id}`);
      print(`  View: https://xplorer.space/extensions/${data.slug || id}\n`);
    } else {
      const err = await res.json().catch(() => ({}));
      error(`Publish failed: ${err.error || res.statusText}`);
    }
  } catch (err) {
    error(`Upload failed: ${err.message}`);
  }
};

const listExtensions = async () => {
  const token = loadToken();
  if (!token) error('Not logged in. Run: xplorer login');

  try {
    const res = await fetch(`${API_URL}/user/extensions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      const extensions = data.extensions || data || [];
      if (extensions.length === 0) {
        print('No published extensions yet.');
        return;
      }
      print(`Your extensions (${extensions.length}):\n`);
      for (const ext of extensions) {
        print(`  ${ext.displayName || ext.name} v${ext.version} (${ext.status})`);
        print(`    ${ext.downloadCount || 0} downloads · ${ext.slug}`);
      }
    } else {
      error('Failed to fetch extensions.');
    }
  } catch (err) {
    error(`Request failed: ${err.message}`);
  }
};

const createExtension = (name) => {
  // Delegate to the create-extension package
  try {
    const args = name ? `-- --name "${name}"` : '';
    execSync(`npx @xplorer/create-extension ${args}`, { stdio: 'inherit' });
  } catch {
    // create-extension handles its own errors
  }
};

// ── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd || cmd === '--help' || cmd === '-h') {
  showHelp();
} else if (cmd === '--version' || cmd === '-v') {
  print(`xplorer v${VERSION}`);
} else if (cmd === 'login') {
  await login();
} else if (cmd === 'logout') {
  logout();
} else if (cmd === 'whoami') {
  whoami();
} else if (cmd === 'publish') {
  await publish();
} else if (cmd === 'extensions') {
  await listExtensions();
} else if (cmd === 'create') {
  createExtension(args[1]);
} else {
  // Treat as folder path
  openFolder(cmd);
}
