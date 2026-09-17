# Progress Log: WorkBuddy OAuth QR Binding

## Session: 2026-09-18 Mini Program Parent Experience Redesign

### Opening receipt
- Goal: make child state, weak points, and next actions the primary mobile experience while preserving every existing data and authorization workflow.
- Order: baseline and data audit -> production illustration assets -> mobile aggregate payload -> main tabs -> detail pages -> performance and preview verification.
- Existing screenshots remain preserved in `designs/miniprogram-home-preview.png` and `designs/miniprogram-login-preview.png`; approved redesign PNGs are read-only references.
- The current nine-page package and all 17 API test files / 51 tests plus nine mini-program logic assertions pass before changes.
- Home currently needs several separate requests for state, goals, relationship, wrong questions, and mastery; the existing authenticated mobile aggregate route is the safest place to reduce latency.
- Largest risk: keeping the package under 2 MB while using genuine 3D-rendered artwork; only display-sized, compressed assets will enter the mini-program package.
- No Prisma migration, authentication change, production-data mutation, Web UI change, MCP change, or WorkBuddy package change is in scope.

### Phase status
- Baseline verification and current-state audit: complete.
- Illustration asset production and compression: complete (9 assets, 733,987 bytes; full package 1,277,171 bytes at last check).
- Authenticated home aggregation: complete; optional insight failures degrade to empty sections instead of breaking the home page.
- Main navigation redesign: complete for login, home, students, growth, learning and settings.
- Secondary pages: complete for child state, student detail, weakness detail, monthly report, wrong book and family management; full legacy learning/settings management remains available in secondary pages.
- Logic/static/assets tests: complete; 18 API files / 54 tests and 16 mini-program assertions pass, no static class warnings.
- WeChat DevTools GUI compile: complete; iPhone 12/13 and Nexus 5 checked, simulator shows zero errors and no visible overflow/overlap.
- CLI preview, final diff audit, commit and push: pending.

### Asset compression record
- Five state-child PNG sources: 2,334,121-2,450,653 bytes each -> 79,991-85,583 bytes each at 213x320.
- Three scene sources: 1,878,184-2,566,202 bytes each -> 79,012-89,954 byte WebP files at 720x450.
- Family model source: 1,707,838 bytes -> 67,919 byte transparent PNG at 320x213.
- Legacy 1,105,521 byte app icon -> 176,184 byte PNG; no mini-program file now exceeds 200KB.
- Reverse asset test confirmed a temporary 300KB+ PNG is rejected, then removed; the normal asset check passes.

## Session: 2026-09-16 WeChat-only accounts + OAuth connector

### Summary
- Replaced visible email/password and invite-code registration with WeChat authorization on both the web app and the mini program.
- Added first-login family onboarding: create a family, or apply to join with a 6-digit family code that the family creator must approve.
- Replaced the WorkBuddy connector token mode with standard MCP OAuth 2.1 + PKCE, including the browser authorization page, mini program QR binding and connected-app revocation.
- Kept the legacy `X-MCP-Token` and legacy Bearer family token path working so already-connected WorkBuddy installs are not interrupted.

### Verification
- Prisma schema valid; migration `20260916010000_workbuddy_oauth` applied on production during rollout.
- API build passed; 17 test files / 51 tests passed, including new OAuth PKCE, redirect allowlist, hashing and family-join coverage.
- Web build passed; mini program validation passed (9 pages); WorkBuddy package validation passed (connector 2.0.0 / expert 1.4.0 / skill 2.4.0).
- Production: health 200, OAuth metadata served, MCP returns 401 with `WWW-Authenticate`, dynamic client registration 201, authorize page renders a real 430x430 WeChat mini program code, binding status polling returns `pending`.
- End-to-end production OAuth: authorization code -> token exchange with PKCE -> MCP initialize using the OAuth Bearer token succeeded; code reuse rejected; refresh token issued a new access token.
- Backward compatibility: legacy `X-MCP-Token` and legacy Bearer family token still return a successful MCP initialize; bogus tokens return 401.
- Self-test OAuth clients and sessions were deleted after verification; production data intact (8 users, 7 families, 4 children, 23 records, 3 wrong questions).
- Rollback artifact: `/opt/family-edu-agent/backups/pre-wechat-oauth-20260916-231709.dump` (SHA-256 `440281622af1c05ed0a2caebb0da101cbfb6d506fa19496221b90451d768c8ce`).

## Session: 2026-09-16 OAuth upgrade

### Phase 1: Discovery and security design
- **Status:** in progress
- Confirmed WorkBuddy MCP OAuth 2.1 + PKCE support in the current Open Platform documentation.
- Confirmed the current package is token-mode and the codebase already supports WeChat identity and multi-family membership.
- Chosen compatibility approach: OAuth for new connections, legacy X-MCP-Token accepted during transition.

## Archived progress

# Progress Log

## Session: 2026-09-05

### Phase 1: Requirements & Discovery
- **Status:** complete
- Actions taken:
  - Read os-taxonomy README, schema, provenance, curriculum coverage.
  - Read Heya V2 architecture, Prisma models, knowledge service, MCP tools and tests.
- Files created/modified:
  - task_plan.md
  - findings.md
  - progress.md

### Phase 2: Planning & Structure
- **Status:** complete
- Actions taken:
  - Decided to extend existing KnowledgeNode/KnowledgeRelation instead of introducing a separate global taxonomy.
  - Decided to add one explicit relation-save tool instead of forcing complex nested imports.

### Phase 3: Implementation
- **Status:** complete
- Actions taken:
  - Added `evidence`, `assessmentPrompt`, `commonErrors` to KnowledgeNode and `strength`, `reason` to KnowledgeRelation.
  - Created incremental Prisma migration `20260905090000_knowledge_evidence`.
  - Added `saveKnowledgeRelationsBatch` domain service and audit logging.
  - Added MCP tool `save_knowledge_relations_batch` and REST POST `/api/v2/knowledge-nodes/relations`.
  - Updated WorkBuddy prompts, connector/expert skill workflows and docs.

### Phase 4: Testing & Verification
- **Status:** complete
- Actions taken:
  - `npm run build --workspace @family-edu/api` passed.
  - `npm run test` passed 15 files / 40 tests.
  - Prisma schema validated.
  - `npm run check:workbuddy` passed.
  - MCP smoke not run because `MCP_SMOKE_TOKEN` is missing locally; bootstrap unit test passed.

## Test Results

| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Knowledge import | evidence/assessmentPrompt/commonErrors | fields written | written | ✓ |
| Relation create | hard prereq with reason | KnowledgeRelation created | created | ✓ |
| Relation update | soft update | no duplicate | updated | ✓ |
| Context | relation strength/reason | returned | returned | ✓ |
| API unit suite | npm run test | all pass | 40 passed | ✓ |
| WorkBuddy package | npm run check:workbuddy | pass | pass | ✓ |

## Error Log

| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
|           | Prisma validate missing DATABASE_URL | 1 | Used dummy local connection for validation only |
| 2026-09-16 22:40 | Remote migration wrapper had an unmatched shell quote | 1 | No database change occurred; split the operation into simpler commands |

## 5-Question Reboot Check

| Question | Answer |
|----------|--------|
| Where am I? | Phase 5 complete |
| Where am I going? | Hand off result to user |
| What's the goal? | Add evidence-rich knowledge nodes and hard/soft prerequisite relations |
| What have I learned? | See findings.md |
| What have I done? | See above |

## Session: 2026-09-16

### Phase 6: Production Rollout
- **Status:** in progress
- Confirmed production lacks migration `20260905090000_knowledge_evidence`.
- Confirmed the new domain and API are healthy before rollout.
- Revalidated Prisma schema, API build, 15 test files / 40 tests, WorkBuddy v1.3.0/expert v1.3.0/Skill v2.3.0, and the mini program package.
- Created and verified a 303-entry PostgreSQL custom-format backup at `/opt/family-edu-agent/backups/pre-knowledge-evidence-20260916-223200.dump` (SHA-256 `116aa3c5efdebea9d3ce7d0b1e9d49d51795a9e66d430736aa5d185650c7f9a5`).
- Applied migration `20260905090000_knowledge_evidence`; existing row counts remained unchanged.
- Rebuilt and restarted only the Heya API container.
- Verified Web 200, health 200, mobile home 200, database schema current, and no level-50 API errors.
- Completed a real authenticated MCP initialize + tools/list check; the new relation tool and knowledge-context tool are available.
- **Status:** complete
