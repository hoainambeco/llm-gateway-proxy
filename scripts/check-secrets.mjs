#!/usr/bin/env node

import { execSync } from 'node:child_process';
import path from 'node:path';

// ANSI escape codes for styling
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

console.log(`${BOLD}[Security Guard] Checking staged files for secrets and sensitive data...${RESET}`);

// -----------------------------------------------------------------------------
// 1. Check Staged File Names (Blocked Sensitive Files)
// -----------------------------------------------------------------------------
let stagedFiles = [];
try {
  const output = execSync('git diff --cached --name-only -z', { encoding: 'utf-8' });
  stagedFiles = output.split('\0').filter(Boolean);
} catch (error) {
  console.error(`${RED}Failed to obtain staged files from git.${RESET}`, error);
  process.exit(1);
}

if (stagedFiles.length === 0) {
  console.log(`${GREEN}✔ No staged files to check.${RESET}`);
  process.exit(0);
}

// Patterns of filenames that must NEVER be committed
const FORBIDDEN_FILE_PATTERNS = [
  {
    pattern: /(^|\/)accounts(\..+)?\.json$/i,
    allow: /accounts\.json\.example$/i,
    reason: 'Accounts credentials file (contains OAuth refresh tokens / secret keys)',
  },
  {
    pattern: /(^|\/)(\.env(\..+)?|.+\.env)$/i,
    allow: /\.env\.example$/i,
    reason: 'Environment variables file with secrets (only .env.example is allowed)',
  },
  {
    pattern: /(^|\/)routing(\..+)?\.json$/i,
    allow: /routing\.json\.example$/i,
    reason: 'Routing configuration file (only routing.json.example is allowed)',
  },
  {
    pattern: /(^|\/)data\/.+/i,
    reason: 'Production runtime database or persistent state in data/ directory',
  },
  {
    pattern: /\.(sqlite|sqlite3|db)(-wal|-shm)?$/i,
    reason: 'SQLite database or WAL journal file',
  },
  {
    pattern: /(id_rsa|id_ed25519|id_ecdsa)(\.pub)?$/i,
    reason: 'SSH private or identity key',
  },
  {
    pattern: /\.(pem|key|pfx|p12|pkcs12)$/i,
    reason: 'Cryptographic private key or certificate bundle',
  },
];

const fileViolations = [];

for (const file of stagedFiles) {
  const normalized = file.replace(/\\/g, '/');
  for (const rule of FORBIDDEN_FILE_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      if (rule.allow && rule.allow.test(normalized)) {
        continue;
      }
      fileViolations.push({ file, reason: rule.reason });
    }
  }
}

// -----------------------------------------------------------------------------
// 2. Check Staged Diffs for Secret Patterns (Hardcoded API Keys & Private Keys)
// -----------------------------------------------------------------------------
const SECRET_REGEX_PATTERNS = [
  {
    name: 'OpenAI Project / Live API Key',
    regex: /\b(sk-proj-[A-Za-z0-9_-]{20,}|sk-[a-zA-Z0-9]{40,})\b/,
    ignore: /sk-(test|dummy|placeholder|sample|mock|proj-test)/i,
  },
  {
    name: 'Anthropic Live API Key',
    regex: /\b(sk-ant-api[0-9]{2}-[a-zA-Z0-9_-]{30,}|sk-ant-[a-zA-Z0-9_-]{40,})\b/,
    ignore: /sk-test|sk-dummy|placeholder/i,
  },
  {
    name: 'Google API Key (AIza...)',
    regex: /\b(AIza[0-9A-Za-z-_]{35})\b/,
    ignore: /AIzaSyDummy|AIzaSyTest|AIzaSyPlaceholder/i,
  },
  {
    name: 'Antigravity Gateway Raw API Key (sk-ag-...)',
    regex: /\bsk-ag-[a-f0-9]{48}\b/,
    ignore: /sk-ag-(0000|1111|2222|aaaa|bbbb|cccc|test|dummy)/i,
  },
  {
    name: 'Private Key Block Header',
    regex: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
    ignore: /dummy|mock|test/i,
  },
  {
    name: 'Live Google OAuth Refresh Token in JSON',
    regex: /"refresh_token"\s*:\s*"1\/\/[a-zA-Z0-9_-]{40,}"/,
    ignore: /refresh_token":\s*"(test|dummy|mock)/i,
  },
];

const contentViolations = [];

let diffOutput = '';
try {
  diffOutput = execSync('git diff --cached -U0', { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
} catch (error) {
  console.error(`${RED}Failed to read git diff.${RESET}`, error);
  process.exit(1);
}

let currentFile = null;
const lines = diffOutput.split('\n');

for (const line of lines) {
  if (line.startsWith('+++ b/')) {
    currentFile = line.slice(6);
    continue;
  }

  // Only inspect newly added lines in the commit
  if (line.startsWith('+') && !line.startsWith('+++')) {
    const addedContent = line.slice(1);

    for (const rule of SECRET_REGEX_PATTERNS) {
      if (rule.regex.test(addedContent)) {
        if (rule.ignore && rule.ignore.test(addedContent)) {
          continue;
        }
        contentViolations.push({
          file: currentFile,
          rule: rule.name,
          preview: addedContent.trim().slice(0, 80),
        });
      }
    }
  }
}

// -----------------------------------------------------------------------------
// 3. Evaluate Results
// -----------------------------------------------------------------------------
if (fileViolations.length > 0 || contentViolations.length > 0) {
  console.error(`\n${RED}${BOLD}✖ COMMIT REJECTED: Sensitive file or secret leak detected!${RESET}\n`);

  if (fileViolations.length > 0) {
    console.error(`${YELLOW}${BOLD}Forbidden File(s) Attempted to Commit:${RESET}`);
    for (const v of fileViolations) {
      console.error(`  - ${RED}${v.file}${RESET}: ${v.reason}`);
    }
    console.error(`\n  ${BOLD}Resolution:${RESET} Run 'git reset HEAD <file>' to unstage.`);
  }

  if (contentViolations.length > 0) {
    console.error(`\n${YELLOW}${BOLD}Potential Secrets Detected in Staged Diff:${RESET}`);
    for (const v of contentViolations) {
      console.error(`  - In ${BOLD}${v.file}${RESET}: [${v.rule}]`);
      console.error(`    ${RED}${v.preview}${RESET}`);
    }
    console.error(`\n  ${BOLD}Resolution:${RESET} Remove hardcoded secrets from code or replace with environment variables.`);
  }

  console.error(`\n${RED}Pre-commit hook aborted. Please clean up sensitive content before committing.${RESET}\n`);
  process.exit(1);
}

console.log(`${GREEN}✔ Security Guard: No sensitive files or secret patterns detected.${RESET}`);
process.exit(0);
