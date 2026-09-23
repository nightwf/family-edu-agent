# Task Plan: WorkBuddy OAuth QR Binding

## Goal

将账号入口统一为微信授权，并将 WorkBuddy 首次连接从手工复制家庭 Token 升级为 MCP OAuth 2.1 + PKCE：网页版使用微信扫码登录；WorkBuddy 打开禾芽授权网页后展示小程序码，家长扫码选择家庭并确认授权，WorkBuddy 自动获得并刷新家庭级凭证。

## Current Phase

Complete

## Phases

### Phase 1: Discovery and security design
- [x] Audit current API, MCP authentication, mini program login and deployment
- [x] Define OAuth endpoints, QR binding session and compatibility behavior
- **Status:** complete

### Phase 2: Database and backend
- [x] Add OAuth client, authorization code, access token and binding session models
- [x] Add browser WeChat QR login sessions and WeChat-only registration
- [x] Add first-login family choice, 6-digit family code applications and owner review
- [x] Implement OAuth metadata, dynamic registration, authorization and token endpoints
- [x] Update MCP Bearer authentication while retaining legacy X-MCP-Token compatibility
- **Status:** complete

### Phase 3: Web and mini program
- [x] Add browser authorization page with mini program code and live status
- [x] Replace web email/password login with WeChat QR login
- [x] Simplify mini program login to WeChat authorization only
- [x] Add mini program WorkBuddy binding page and family selection
- [x] Add connected-app management and revoke behavior
- **Status:** complete

### Phase 4: WorkBuddy packages and docs
- [x] Switch connector from token mode to standard MCP OAuth
- [x] Update expert, skill and project documentation
- [x] Rebuild connector/expert/skill packages
- **Status:** complete

### Phase 5: Verification and rollout
- [x] Run Prisma validation, builds, unit tests, OAuth smoke tests and mini program validation
- [x] Deploy additive migration and application without affecting other services
- [x] Verify public Web, OAuth metadata, MCP and compatibility paths
- [x] Commit and push the finished change
- **Status:** complete

## Security decisions

| Decision | Rationale |
|----------|-----------|
| Use OAuth 2.1 authorization code + PKCE | Official WorkBuddy MCP authorization flow |
| QR code contains only a short-lived opaque binding id | Prevents family ids and permanent credentials leaking through screenshots |
| Require explicit family selection and approval | A user may manage multiple families; authorization must not guess |
| Keep legacy X-MCP-Token temporarily | Existing connected WorkBuddy installations continue working during upgrade |
| Hide email/password login but keep the old API temporarily | Prevents unbound historical accounts from being irreversibly locked out during rollout |
| A new WeChat account may exist without a family | It can wait for an owner-approved join request without creating an unwanted empty family |
| Six-digit family codes only create applications | A short human-readable code must never directly grant access to family data |

## Archived completed task

# Task Plan: Knowledge Evidence Graph Improvement

## Goal

把 Marble 式“掌握证据 + 前置依赖 + 评估问句”设计贯彻到禾芽现有教材知识节点、关系、MCP 和 WorkBuddy 同步规范中，不引入 os-taxonomy 外国课纲数据。

## Current Phase

Phase 6

## Phases

### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify constraints and requirements
- [x] Document findings in findings.md
- **Status:** complete

### Phase 2: Planning & Structure
- [x] Define technical approach
- [x] Create project structure if needed
- [x] Document decisions with rationale
- **Status:** complete

### Phase 3: Implementation
- [x] Add Prisma fields and migration
- [x] Update knowledge domain service
- [x] Update MCP tool schemas and API routes
- [x] Update WorkBuddy prompt/skill/sync docs
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Run TypeScript checks
- [x] Run API unit tests
- [x] Run WorkBuddy package validation
- [x] Run MCP smoke test if token available
- **Status:** complete

MCP smoke test was not run because `MCP_SMOKE_TOKEN` is not configured locally; unit bootstrap test covers the MCP handshake path.

### Phase 5: Delivery
- [x] Review output files
- [x] Summarize changes and evidence
- [x] Deliver to user
- **Status:** complete

### Phase 6: Production Rollout
- [x] Re-run schema, build, unit and package validation
- [x] Back up the production PostgreSQL database
- [x] Deploy the incremental migration and knowledge API/MCP code
- [x] Verify Web/API/MCP health and migration status
- [x] Confirm rollback artifacts and document platform follow-ups
- **Status:** complete

## Key Questions

1. Should os-taxonomy itself be imported? No, only its structural pattern.
2. Do we need frontend changes? No, this phase is data import and AI-context improvement.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Add optional evidence/assessmentPrompt/commonErrors to KnowledgeNode | WorkBuddy can fill richer textbook knowledge without breaking existing records |
| Add strength/reason to KnowledgeRelation | Differentiate hard and soft prerequisites and preserve why an edge exists |
| Add save_knowledge_relations_batch MCP tool | Keeps node imports idempotent and lets relations be written after nodes exist |
| Do not import Marble data | It is US/UK-aligned and would conflict with Chinese textbook-driven product data |
| Deploy only after a timestamped database backup | The migration is additive, but production data must remain recoverable |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| Prisma validate missing DATABASE_URL | 1 | Ran validate with a dummy local connection string |
| Production migration wrapper had an unmatched shell quote | 1 | No database command ran; split count, migration and verification into separate commands |

## Notes

- Keep changes in family-edu-agent and avoid unrelated untracked files.
- Existing data can stay; new fields are optional.
