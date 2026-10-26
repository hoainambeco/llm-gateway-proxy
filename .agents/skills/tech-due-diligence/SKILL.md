---
name: tech-due-diligence
description: >-
  Performs an objective, 100% factual Technical Due Diligence (TDD) audit on any software codebase
  and generates an executive, printable Tailwind CSS HTML report with ZERO fake numbers or hallucinated metrics.
  Captures real lines of code, test pass/fail counts, true line/branch coverage %, CVE vulnerabilities,
  linter warnings, and key person dependency (bus factor).
---

# Technical Due Diligence (TDD) Skill

> [!IMPORTANT]
> **STRICT INTEGRITY MANDATE: ZERO FAKE NUMBERS**
> - **Zero sugar-coating, zero fabrication, zero hallucinated metrics.**
> - The Technical Due Diligence assessment acts as an **Independent Technical Auditor**: rigorous, objective, and solely grounded in hard engineering evidence and live terminal execution data.
> - **EVERY SINGLE METRIC** (Lines of Code, Test count, Test pass/fail, Code coverage %, Vulnerabilities/CVEs, Linter warnings, Compile errors, Git commit history, Bus factor) **MUST** be measured via actual CLI commands on the target repository.
> - **NEVER CONFLATE** "100% test pass rate" with "100% code coverage". If unit line coverage is 30.98%, report 30.98% explicitly and highlight the 69% untested code risk. Never round up to 80% or 90%.
> - When vulnerabilities (CVEs) or technical debt exist, explicitly state the affected package, CVE identifier, CVSS severity, and affected source files.

---

## 1. Audit Methodology & Factual Scoring Criteria

The codebase is evaluated across 8 core engineering dimensions on a 1.0 to 10.0 scale based on concrete technical evidence:

| Weight | Dimension | Objective Criteria & Verification Evidence | Deductions & Real Risks to Highlight |
| :---: | :--- | :--- | :--- |
| **20%** | **Architecture & Design** | Clear separation of concerns (Controller -> Service -> Data Layer), loose coupling, event/queue patterns, modular monolith or microservices. | Spaghetti structure, circular dependencies, leaking business logic into transport controllers. |
| **15%** | **Type Safety & Code Integrity** | Strict TypeScript (`tsc --noEmit`), input validation schemas (Zod/DTOs), linter configuration. | Proliferation of `any`, bypassed type checks, active compiler or linter errors/warnings (e.g., 30+ linter warnings). |
| **20%** | **Testing Infrastructure & Coverage** | Automated test layers (Unit, E2E API, Browser E2E); isolated test databases (in-memory SQLite, ephemeral mocks); **Genuine Code Coverage (Line & Branch %)**. | **Code coverage < 50% incurs heavy score penalties** (capped at 6.5–7.2). Flaky tests, skipped tests, or failing suites. |
| **20%** | **Security & Vulnerabilities** | `npm audit` / dependency vulnerability scans (CVEs), timing-safe authentication, guards on internal routes, secret masking. | **Any High/Critical CVE prevents an "Excellent" rating**. Weak hashing (MD5/SHA1), unmasked secrets in logs, wildcard CORS `*`. |
| **10%** | **Operational Resilience & Error Handling** | Centralized error filters, rate limiting, retry strategies with exponential backoff, connection pooling, graceful shutdown. | Missing cooldown mechanisms, unhandled promise rejections, crashing on upstream 429/500 responses. |
| **5%** | **UI / UX & Localization** | Component modularity, state management, i18n key parity, dark mode, responsive layout. | Missing translation keys, UI flickering, React hook impurity or render lifecycle warnings. |
| **5%** | **Documentation & Developer Experience** | Setup walkthrough, API specs (Swagger/GraphQL/Postman), TESTING.md, SECURITY.md integrity. | Outdated setup steps, missing test instructions, undocumented environment variables. |
| **5%** | **Engineering Maturity & Team Dynamics** | **Genuine Bus Factor** (derived from `git shortlog`), CI/CD automation pipelines (`.github/workflows/`), commit hygiene. | **Bus Factor = 1 (single engineer writing >80% of commits) is a critical Key Person Risk**, maturity score capped at 5.5–6.5. |

---

## 2. Step-by-Step Fact-Gathering Workflow

When conducting an audit, **always execute the following commands** to extract factual metrics before drafting the report:

### Step 1: Automated Fact Extraction (Recommended)
Run the automated metrics extraction script:
```bash
node .agents/skills/tech-due-diligence/scripts/gather-metrics.cjs
```
This script executes non-destructive tests and outputs structured data to `docs/tdd-metrics.json`.

If running manually on any repository:
1. **Count Lines of Code (LOC)**:
   ```bash
   find src web/src test -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) | xargs wc -l
   ```
2. **Verify Type Safety & Compiler Output**:
   ```bash
   npx tsc --noEmit
   ```
3. **Audit Linter Diagnostics**:
   ```bash
   npm run lint # or npx oxlint
   ```
4. **Execute Test Suites & Extract Genuine Coverage**:
   ```bash
   npx jest --coverage --coverageReporters="json-summary" --coverageReporters="text-summary"
   npm run test:e2e
   npx playwright test
   ```
   > [!CAUTION]
   > Capture all 4 coverage dimensions: **Statements %, Branches %, Functions %, Lines %**. Never hallucinate coverage figures.
5. **Scan for Dependency Vulnerabilities**:
   ```bash
   npm audit --json
   ```
   > [!NOTE]
   > Record exact vulnerability counts by severity (Critical, High, Moderate, Low) and list each advisory with package name and CVE/GHSA ID.
6. **Analyze Team Distribution & Bus Factor**:
   ```bash
   git rev-list --count HEAD
   git shortlog -sn --all
   ```

---

## 3. Scoring Matrix Ground Rules

- **9.0 - 10.0 (EXCELLENT / LOW RISK)**: Enterprise-ready: Unit line coverage > 80%, 0 High/Critical CVEs, 0 linter warnings, Bus Factor >= 3, comprehensive multi-stage CI/CD.
- **7.5 - 8.9 (GOOD / LOW-TO-MODERATE RISK)**: Solid foundations, clean architecture, all tests pass, but has minor gaps (e.g., coverage 30–60%, minor linter warnings, or moderate bus factor).
- **5.5 - 7.4 (MODERATE / MEDIUM RISK)**: Early-stage startup / MVP: Working product with good patterns, but significant technical debt (coverage < 30%, Bus Factor = 1, missing E2E tests, or unpatched High CVEs).
- **Below 5.5 (POOR / HIGH RISK)**: Critical technical risk: 0 tests, spaghetti architecture, hardcoded secrets, no CI/CD automation.

---

## 4. Standard HTML Report Architecture (`docs/due-diligence-report.html`)

The output report MUST be a single self-contained HTML file formatted with Tailwind CSS and FontAwesome:
- **Language**: English (`<html lang="en">`).
- **Executive KPI Cards**: Display real metrics (Test pass/fail, True Line Coverage %, Linter warnings, CVE count, Bus factor).
- **Objective Scorecard**: Category scores weighted and backed by **Concrete Technical Evidence** cited directly from command outputs.
- **Unvarnished Risk Analysis**:
  - Itemize unpatched CVEs with package names and advisory IDs.
  - Highlight untested modules based on coverage reports.
  - Explicitly flag single-engineer dependency (Bus Factor = 1).
- **30–60–90 Day Remediation Roadmap**:
  - Days 1–30 (Immediate): Patch CVEs via dependency updates, resolve all linter warnings, document core architecture.
  - Days 31–60 (Hardening): Increase line coverage from current baseline to >55%, onboard a second backend engineer.
  - Days 61–90 (Scaling): Raise branch coverage >70%, add multi-node Redis clustering.
- **Final Verdict / Recommendation**: Clear **GO**, **CONDITIONAL GO**, or **NO GO** recommendation with rationales.
