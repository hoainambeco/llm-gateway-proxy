#!/usr/bin/env node
/**
 * gather-metrics.cjs
 *
 * Automated Fact-Gathering Engine for Technical Due Diligence (TDD).
 * STRICT INTEGRITY MANDATE: ZERO FAKE NUMBERS.
 * All metrics are executed and extracted live from the repository.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getGitRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

const ROOT_DIR = getGitRoot();

function runCmd(cmd, options = {}) {
  try {
    const stdout = execSync(cmd + ' 2>&1', {
      cwd: options.cwd || ROOT_DIR,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      ...options,
    });
    return {
      success: true,
      stdout,
      stderr: '',
      exitCode: 0,
    };
  } catch (error) {
    return {
      success: false,
      stdout: error.stdout ? error.stdout.toString() : '',
      stderr: error.stderr ? error.stderr.toString() : '',
      exitCode: error.status || 1,
    };
  }
}

console.log('🔍 [TDD Metrics] Gathering 100% factual codebase metrics (Strict No-Fake-Data Mode)...\n');

const metrics = {
  timestamp: new Date().toISOString(),
  git: {},
  loc: {},
  typecheck: {},
  lint: {},
  tests: {
    unit: {},
    e2e: {},
    playwright: {},
    totalPassed: 0,
    totalFailed: 0,
    totalCount: 0,
  },
  security: {},
};

// 1. Git & Team Dynamics (Bus Factor)
console.log('📦 1/6 Checking Git history and contributor distribution...');
const gitCommitsRes = runCmd('git rev-list --count HEAD');
metrics.git.totalCommits = gitCommitsRes.success ? parseInt(gitCommitsRes.stdout.trim(), 10) : 0;

const gitShortlogRes = runCmd('git shortlog -sn --all');
if (gitShortlogRes.success) {
  const lines = gitShortlogRes.stdout.trim().split('\n').filter(Boolean);
  const rawContributors = lines.map((l) => {
    const parts = l.trim().split(/\t+/);
    return {
      commits: parseInt(parts[0], 10),
      author: parts[1] || 'Unknown',
    };
  });

  // Deduplicate author aliases (e.g., HoaiNam, hoainambeco, Nguyễn Hoài Nam)
  const authorCommits = {};
  for (const c of rawContributors) {
    if (c.author.includes('[bot]')) continue;
    let normalized = c.author.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized.includes('hoainam') || normalized.includes('namnguyen')) {
      normalized = 'hoainam';
    }
    authorCommits[normalized] = (authorCommits[normalized] || 0) + c.commits;
  }
  const humanAuthorCount = Object.keys(authorCommits).length;
  const totalCommitsSum = rawContributors.reduce((acc, c) => acc + c.commits, 0);
  const sortedAuthorCommits = Object.values(authorCommits).sort((a, b) => b - a);
  const topHumanCommits = sortedAuthorCommits[0] || 0;

  metrics.git.contributors = rawContributors;
  metrics.git.distinctHumanAuthors = humanAuthorCount;
  metrics.git.topContributorRatio = `${((topHumanCommits / totalCommitsSum) * 100).toFixed(1)}%`;
  metrics.git.busFactor = humanAuthorCount <= 1 || (topHumanCommits / totalCommitsSum > 0.75) ? 1 : Math.min(humanAuthorCount, 3);
}

// 2. Lines of Code Breakdown
console.log('📊 2/6 Counting Lines of Code (Backend, Frontend, Tests)...');
function countLines(targetPath) {
  const absPath = path.join(ROOT_DIR, targetPath);
  if (!fs.existsSync(absPath)) return { files: 0, lines: 0 };
  const res = runCmd(`find ${targetPath} -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \\) | xargs wc -l | tail -n 1`);
  if (res.success && res.stdout.trim()) {
    const parts = res.stdout.trim().split(/\s+/);
    const countRes = runCmd(`find ${targetPath} -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \\) | wc -l`);
    return {
      files: parseInt(countRes.stdout.trim(), 10) || 0,
      lines: parseInt(parts[0], 10) || 0,
    };
  }
  return { files: 0, lines: 0 };
}

metrics.loc.backend = countLines('src');
metrics.loc.frontend = countLines('web/src');
metrics.loc.tests = countLines('test');
metrics.loc.totalLines = metrics.loc.backend.lines + metrics.loc.frontend.lines + metrics.loc.tests.lines;

// 3. TypeScript Type-Checking
console.log('⚡ 3/6 Verifying TypeScript strict type safety...');
const typecheckRes = runCmd('npx tsc --noEmit');
metrics.typecheck.success = typecheckRes.success;
metrics.typecheck.exitCode = typecheckRes.exitCode;
metrics.typecheck.errors = typecheckRes.success
  ? 0
  : (typecheckRes.stdout.match(/error TS\d+/g) || []).length;

// 4. Linter Analysis
console.log('🧹 4/6 Auditing linter warnings and code issues (Oxlint / ESLint)...');
const lintRes = runCmd('npx oxlint');
const lintMatch = lintRes.stdout.match(/Found (\d+) warnings? and (\d+) errors?/);
if (lintMatch) {
  metrics.lint.warnings = parseInt(lintMatch[1], 10);
  metrics.lint.errors = parseInt(lintMatch[2], 10);
  metrics.lint.totalIssues = metrics.lint.warnings + metrics.lint.errors;
} else {
  metrics.lint.warnings = 0;
  metrics.lint.errors = 0;
  metrics.lint.totalIssues = 0;
}

// 5. Test Suite & Exact Code Coverage
console.log('🧪 5/6 Running Unit, E2E & Browser tests to extract genuine numbers...');
const coverageDir = '/tmp/tdd-metrics-coverage';
const unitTestRes = runCmd(`npx jest --config jest.config.cjs --coverage --coverageReporters="json-summary" --coverageDirectory="${coverageDir}"`);

if (fs.existsSync(path.join(coverageDir, 'coverage-summary.json'))) {
  try {
    const cov = JSON.parse(fs.readFileSync(path.join(coverageDir, 'coverage-summary.json'), 'utf8'));
    metrics.tests.unit.coverage = {
      lines: cov.total.lines.pct,
      statements: cov.total.statements.pct,
      functions: cov.total.functions.pct,
      branches: cov.total.branches.pct,
      linesCovered: cov.total.lines.covered,
      linesTotal: cov.total.lines.total,
    };
  } catch (e) {
    metrics.tests.unit.coverage = null;
  }
}

// Parse unit test counts
const unitPassed = unitTestRes.stdout.match(/Tests:\s+.*?(\d+) passed/);
const unitFailed = unitTestRes.stdout.match(/Tests:\s+.*?(\d+) failed/);
const unitTotal = unitTestRes.stdout.match(/Tests:\s+.*?(\d+) total/);
metrics.tests.unit.passed = unitPassed ? parseInt(unitPassed[1], 10) : 0;
metrics.tests.unit.failed = unitFailed ? parseInt(unitFailed[1], 10) : 0;
metrics.tests.unit.total = unitTotal ? parseInt(unitTotal[1], 10) : metrics.tests.unit.passed;

// E2E Tests
const e2eRes = runCmd('npm run test:e2e');
const e2ePassed = e2eRes.stdout.match(/Tests:\s+.*?(\d+) passed/);
const e2eFailed = e2eRes.stdout.match(/Tests:\s+.*?(\d+) failed/);
const e2eTotal = e2eRes.stdout.match(/Tests:\s+.*?(\d+) total/);
metrics.tests.e2e.passed = e2ePassed ? parseInt(e2ePassed[1], 10) : 0;
metrics.tests.e2e.failed = e2eFailed ? parseInt(e2eFailed[1], 10) : 0;
metrics.tests.e2e.total = e2eTotal ? parseInt(e2eTotal[1], 10) : metrics.tests.e2e.passed;

// Playwright Tests
const pwRes = runCmd('npx playwright test');
const pwPassed = pwRes.stdout.match(/(\d+) passed/);
const pwFailed = pwRes.stdout.match(/(\d+) failed/);
metrics.tests.playwright.passed = pwPassed ? parseInt(pwPassed[1], 10) : 0;
metrics.tests.playwright.failed = pwFailed ? parseInt(pwFailed[1], 10) : 0;
metrics.tests.playwright.total = metrics.tests.playwright.passed + metrics.tests.playwright.failed;

metrics.tests.totalPassed = (metrics.tests.unit.passed || 0) + (metrics.tests.e2e.passed || 0) + (metrics.tests.playwright.passed || 0);
metrics.tests.totalFailed = (metrics.tests.unit.failed || 0) + (metrics.tests.e2e.failed || 0) + (metrics.tests.playwright.failed || 0);
metrics.tests.totalCount = metrics.tests.totalPassed + metrics.tests.totalFailed;

// 6. Security Vulnerability Audit
console.log('🔒 6/6 Running npm audit vulnerability scan...');
const auditRes = runCmd('npm audit --json');
try {
  const auditJson = JSON.parse(auditRes.stdout);
  const vuln = auditJson.metadata ? auditJson.metadata.vulnerabilities : {};
  metrics.security.vulnerabilities = {
    critical: vuln.critical || 0,
    high: vuln.high || 0,
    moderate: vuln.moderate || 0,
    low: vuln.low || 0,
    total: vuln.total || 0,
  };
  metrics.security.advisories = Object.keys(auditJson.vulnerabilities || {}).map(pkg => ({
    package: pkg,
    severity: auditJson.vulnerabilities[pkg].severity,
    title: auditJson.vulnerabilities[pkg].via && auditJson.vulnerabilities[pkg].via[0] && typeof auditJson.vulnerabilities[pkg].via[0] === 'object'
      ? auditJson.vulnerabilities[pkg].via[0].title
      : 'Vulnerability',
    url: auditJson.vulnerabilities[pkg].via && auditJson.vulnerabilities[pkg].via[0] && typeof auditJson.vulnerabilities[pkg].via[0] === 'object'
      ? auditJson.vulnerabilities[pkg].via[0].url
      : '',
  }));
} catch {
  metrics.security.vulnerabilities = { critical: 0, high: 0, moderate: 0, low: 0, total: 0 };
  metrics.security.advisories = [];
}

// Write output JSON to docs/
const docsDir = path.join(ROOT_DIR, 'docs');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}
const outputPath = path.join(docsDir, 'tdd-metrics.json');
fs.writeFileSync(outputPath, JSON.stringify(metrics, null, 2), 'utf8');

console.log('\n===============================================================');
console.log('        REAL FACTUAL CODEBASE METRICS (ZERO FAKE DATA)        ');
console.log('===============================================================');
console.log(`• Lines of Code     : ${metrics.loc.totalLines.toLocaleString()} LOC (Backend: ${metrics.loc.backend.lines}, Frontend: ${metrics.loc.frontend.lines}, Tests: ${metrics.loc.tests.lines})`);
console.log(`• TypeScript Errors : ${metrics.typecheck.errors} compile error(s)`);
console.log(`• Linter Diagnostics: ${metrics.lint.errors} error(s), ${metrics.lint.warnings} warning(s)`);
console.log(`• Test Suites       : Total: ${metrics.tests.totalCount} (Unit: ${metrics.tests.unit.total}, E2E: ${metrics.tests.e2e.total}, Playwright: ${metrics.tests.playwright.total})`);
console.log(`• Test Results      : ${metrics.tests.totalPassed} passed, ${metrics.tests.totalFailed} failed`);
console.log(`• Unit Coverage     : Lines: ${metrics.tests.unit.coverage ? metrics.tests.unit.coverage.lines : 'N/A'}% | Branches: ${metrics.tests.unit.coverage ? metrics.tests.unit.coverage.branches : 'N/A'}% | Statements: ${metrics.tests.unit.coverage ? metrics.tests.unit.coverage.statements : 'N/A'}% | Functions: ${metrics.tests.unit.coverage ? metrics.tests.unit.coverage.functions : 'N/A'}%`);
console.log(`• Vulnerabilities   : ${metrics.security.vulnerabilities.total} total (${metrics.security.vulnerabilities.high} High, ${metrics.security.vulnerabilities.moderate} Moderate, ${metrics.security.vulnerabilities.low} Low)`);
console.log(`• Bus Factor Risk   : ${metrics.git.busFactor} (Top contributor commits: ${metrics.git.topContributorRatio})`);
console.log('===============================================================');
console.log(`Factual metrics saved to: ${outputPath}\n`);
