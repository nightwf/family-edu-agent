# Findings & Decisions: AI Learning Plan Generation

## Current findings

- Web and mini-program home cards currently build a clipboard instruction locally.
- `PlanningRequest` already stores pending/in-progress/completed state and a priority snapshot.
- Existing `proposeStageGoals`, `confirmStageGoal`, `createWeeklyPlan`, and `confirmWeeklyPlan` services provide audited persistence.
- WorkBuddy can read pending requests through MCP but Heya cannot proactively start a WorkBuddy run.
- The built-in Doubao provider already supports streaming chat; the planner needs a strict JSON collection wrapper and validation.
- Current child-tutor tool policy intentionally forbids creating plans, so planning must be a separate server workflow, not a hidden chat tool escalation.
- `StageGoal` and `WeeklyPlan` already expose proposal, draft, confirmation, and active states; the AI planner can reuse them without creating a parallel planning model.
- `createWeeklyPlan` currently activates its goal immediately while the plan is still `DRAFT`; the AI path must keep both inactive until parent confirmation.
- `PlanningRequest` has no structured AI draft, generated timestamp, or error field, so an additive migration is needed for a durable review workflow.
- The production Doubao model answers a minimal probe quickly but exceeded the tutor's 45-second timeout for a full structured plan. Planning now has an independent 90-second timeout and the mini-program request waits up to 110 seconds without replaying a mutating request.
- Doubao Seed 2.1 enables deep thinking by default. Planning does not need a long reasoning trace, so its request explicitly sends `thinking.type=disabled` while keeping the longer timeout as a safety margin.

## Product decisions

- Remove clipboard instructions everywhere.
- Parent explicitly starts AI planning to control cost.
- AI produces draft candidates and a weekly-plan draft; no task becomes active before parent confirmation.
- WorkBuddy remains compatible because drafts use the existing StageGoal/WeeklyPlan/PlanningRequest tables.

## Archived findings

# Findings & Decisions: WorkBuddy OAuth QR Binding

## Current findings

- WorkBuddy officially supports MCP OAuth 2.1 + PKCE for remote MCP servers.
- The server must provide protected-resource metadata, authorization-server metadata, dynamic client registration, authorization and token endpoints.
- WorkBuddy accepts the private callback `workbuddy://workbuddy/mcp/connector%3A<source>/oauth/callback` and can fall back to loopback HTTP.
- The current connector uses `auth_mode: token`, `X-MCP-Token` and `token-schema.json`.
- The project already has WeChat login, FamilyMember multi-family membership and McpToken family scoping.
- User.email, passwordHash and familyId are still required, so WeChat-only registration needs an additive compatibility change.
- Product decision changed: all visible login and registration paths use WeChat; the web app also uses mini-program QR login.
- First login must offer create-family or apply-to-join. Family join uses a visible 6-digit code and requires the family creator's approval.
- A direct family invitation remains a separate one-time flow and offers join-invited-family or create-new-family.
- Existing X-MCP-Token clients must remain valid while the OAuth connector is rolled out.

## Earlier archived findings

# Findings & Decisions

## Requirements

- 知识节点增加“掌握证据、评估问句、常见错误”一类字段。
- 前置关系区分硬性/软性并保留原因。
- WorkBuddy 导入真实教材时按该结构写回。
- 不引入 os-taxonomy 的英美课纲数据。

## Research Findings

- os-taxonomy is a pure dataset, not a WorkBuddy Skill or runtime.
- Heya already has `SourceDocument`, `KnowledgeNode`, `KnowledgeRelation`, `ChildKnowledgeState`, and version fields.
- `KnowledgeRelation` currently lacks strength and reason; `KnowledgeNode` lacks evidence and assessment prompt fields.
- Existing `save_knowledge_nodes_batch` does not create prerequisite relations.
- Existing migration `20260905_add_v2_core` established V2 knowledge schema.

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| `evidence Json?`, `assessmentPrompt String?`, `commonErrors Json?` | Allows structured or simple evidence and common mistakes without extra table joins |
| `KnowledgeRelation.strength String?`, `reason String?` | Hard/soft plus human-readable reason; metadata remains for richer data |
| New service `saveKnowledgeRelationsBatch` | Relation creation should be explicit after nodes are imported |
| MCP/API route `save_knowledge_relations_batch` | Lets WorkBuddy write hard/soft prerequisite edges by title |
| Update skill text and docs | Makes WorkBuddy actually produce evidence/assessment/prerequisite fields |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
|       |            |

## Resources

- /Users/nightwf/Desktop/儿童AI教育/family-edu-agent/prisma/schema.prisma
- /Users/nightwf/Desktop/儿童AI教育/family-edu-agent/apps/api/src/v2/knowledge.ts
- /Users/nightwf/Desktop/儿童AI教育/family-edu-agent/apps/api/src/v2/knowledge.test.ts
- /Users/nightwf/Desktop/儿童AI教育/family-edu-agent/apps/api/src/v2/mcp-tools.ts
- /Users/nightwf/Desktop/儿童AI教育/family-edu-agent/docs/ARCHITECTURE_PROPOSAL_V2.md

## Production Rollout

- Migration `20260905090000_knowledge_evidence` was applied on 2026-09-16.
- Existing production counts remained 13 KnowledgeNode rows and 0 KnowledgeRelation rows.
- Live MCP `tools/list` exposes `save_knowledge_relations_batch` and `get_knowledge_context`.
- The mini program needs no knowledge-graph-specific code change; WorkBuddy package v1.3.0 / Skill v2.3.0 already contains the new workflow.
- Production root disk usage reached 84%; cleanup or expansion should be scheduled separately.
