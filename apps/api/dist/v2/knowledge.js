import { prisma } from "../prisma.js";
import { writeAudit } from "./audit.js";
import { CHILD_KNOWLEDGE_STATUSES, KNOWLEDGE_NODE_TYPES, KNOWLEDGE_RELATION_TYPES, requireEnumValue, } from "./enum-normalize.js";
function normalizeKnowledgeNodeInput(node) {
    const raw = node;
    return {
        // 知识节点类型是枚举，非法取值会报出全部合法值
        type: requireEnumValue(KNOWLEDGE_NODE_TYPES, node.type, "知识节点类型（nodes[].type）"),
        title: node.title,
        subject: node.subject,
        grade: node.grade,
        description: node.description,
        content: (node.content ?? undefined),
        evidence: (raw.evidence ?? undefined),
        assessmentPrompt: (node.assessmentPrompt ?? raw.assessment_prompt ?? undefined),
        commonErrors: (raw.commonErrors ?? raw.common_errors ?? undefined),
        sourcePage: (node.sourcePage ?? raw.source_page ?? undefined),
    };
}
export async function importSourceDocument(familyId, input, actor = { type: "workbuddy" }) {
    const document = await prisma.sourceDocument.create({
        data: {
            familyId,
            title: input.title,
            kind: input.kind,
            subject: input.subject,
            grade: input.grade,
            publisher: input.publisher,
            version: input.version,
            fileKey: input.fileKey,
            nodes: input.nodes?.length
                ? {
                    create: input.nodes.map((node) => ({
                        familyId,
                        ...normalizeKnowledgeNodeInput(node),
                        version: input.version || "1.0.0",
                    })),
                }
                : undefined,
        },
        include: { nodes: true },
    });
    await writeAudit({
        familyId,
        actorType: actor.type,
        actorId: actor.id,
        action: "source_document.import",
        entityType: "SourceDocument",
        entityId: document.id,
        after: document,
    });
    return document;
}
export async function listSourceDocuments(familyId, filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit || 20), 1), 100);
    const offset = Math.max(Number(filters.offset || 0), 0);
    const where = {
        familyId,
        ...(filters.subject ? { subject: filters.subject } : {}),
        ...(filters.grade ? { grade: filters.grade } : {}),
        ...(filters.status ? { status: filters.status } : { status: "ACTIVE" }),
    };
    const [items, total] = await Promise.all([
        prisma.sourceDocument.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: offset,
            take: limit,
        }),
        prisma.sourceDocument.count({ where }),
    ]);
    return { items, total, limit, offset };
}
export async function saveKnowledgeNodesBatch(familyId, sourceDocumentId, nodes, actor = { type: "workbuddy" }) {
    const source = await prisma.sourceDocument.findFirst({
        where: { id: sourceDocumentId, familyId },
    });
    if (!source)
        throw new Error("教材或来源不存在或不属于当前家庭");
    if (nodes.length === 0)
        throw new Error("知识节点不能为空");
    const created = await prisma.$transaction(nodes.map((node) => prisma.knowledgeNode.create({
        data: {
            familyId,
            sourceDocumentId: source.id,
            ...normalizeKnowledgeNodeInput(node),
            version: source.version || "1.0.0",
        },
    })));
    await writeAudit({
        familyId,
        actorType: actor.type,
        actorId: actor.id,
        action: "knowledge_nodes.import",
        entityType: "KnowledgeNode",
        entityId: created.map((item) => item.id).join(","),
        after: created,
    });
    return created;
}
export async function listKnowledgeNodes(familyId, filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit || 20), 1), 100);
    const offset = Math.max(Number(filters.offset || 0), 0);
    const where = {
        familyId,
        ...(filters.subject ? { subject: filters.subject } : {}),
        ...(filters.grade ? { grade: filters.grade } : {}),
        ...(filters.sourceDocumentId ? { sourceDocumentId: filters.sourceDocumentId } : {}),
        ...(filters.status ? { status: filters.status } : { status: "ACTIVE" }),
    };
    const [items, total] = await Promise.all([
        prisma.knowledgeNode.findMany({
            where,
            orderBy: { createdAt: "asc" },
            skip: offset,
            take: limit,
        }),
        prisma.knowledgeNode.count({ where }),
    ]);
    return { items, total, limit, offset };
}
export async function getKnowledgeContext(familyId, childId, nodeId) {
    const child = await prisma.child.findFirst({ where: { id: childId, familyId } });
    if (!child)
        throw new Error("学生不存在或不属于当前家庭");
    const node = await prisma.knowledgeNode.findFirst({
        where: { id: nodeId, familyId, status: "ACTIVE" },
    });
    if (!node)
        throw new Error("知识节点不存在、已过期或不属于当前家庭");
    const [prerequisites, childState] = await Promise.all([
        prisma.knowledgeRelation.findMany({
            where: {
                familyId,
                targetNodeId: nodeId,
                relationType: "PREREQUISITE_OF",
            },
            include: { sourceNode: true },
        }),
        prisma.childKnowledgeState.findUnique({
            where: { childId_knowledgeNodeId: { childId, knowledgeNodeId: nodeId } },
        }),
    ]);
    return {
        child: {
            id: child.id,
            name: child.name,
            grade: child.grade,
            subjects: child.subjects,
        },
        node,
        prerequisites: prerequisites.map((item) => ({
            ...item.sourceNode,
            relationId: item.id,
            relationType: item.relationType,
            relationStrength: item.strength,
            relationReason: item.reason,
        })),
        childState,
    };
}
export async function saveKnowledgeRelationsBatch(familyId, sourceDocumentId, relations, actor = { type: "workbuddy" }) {
    const source = await prisma.sourceDocument.findFirst({
        where: { id: sourceDocumentId, familyId },
    });
    if (!source)
        throw new Error("教材或来源不存在或不属于当前家庭");
    if (relations.length === 0)
        throw new Error("知识关系不能为空");
    const saved = [];
    for (const relation of relations) {
        if (relation.prerequisiteTitle === relation.dependentTitle) {
            throw new Error("知识节点不能成为自己的前置知识点");
        }
        const relationType = requireEnumValue(KNOWLEDGE_RELATION_TYPES, relation.relationType || "PREREQUISITE_OF", "知识关系类型（relations[].relation_type）");
        const prerequisite = await prisma.knowledgeNode.findFirst({
            where: {
                familyId,
                sourceDocumentId: source.id,
                title: relation.prerequisiteTitle,
                status: "ACTIVE",
            },
            orderBy: { createdAt: "asc" },
        });
        const dependent = await prisma.knowledgeNode.findFirst({
            where: {
                familyId,
                sourceDocumentId: source.id,
                title: relation.dependentTitle,
                status: "ACTIVE",
            },
            orderBy: { createdAt: "asc" },
        });
        if (!prerequisite || !dependent) {
            throw new Error(`知识关系中的知识点不存在：${relation.prerequisiteTitle} -> ${relation.dependentTitle}`);
        }
        const existing = await prisma.knowledgeRelation.findFirst({
            where: {
                familyId,
                sourceNodeId: prerequisite.id,
                targetNodeId: dependent.id,
                relationType: relationType,
            },
        });
        const item = existing
            ? await prisma.knowledgeRelation.update({
                where: { id: existing.id },
                data: {
                    strength: relation.strength ?? existing.strength ?? "hard",
                    reason: relation.reason ?? existing.reason,
                },
            })
            : await prisma.knowledgeRelation.create({
                data: {
                    familyId,
                    sourceNodeId: prerequisite.id,
                    targetNodeId: dependent.id,
                    relationType: relationType,
                    strength: relation.strength ?? "hard",
                    reason: relation.reason,
                    version: source.version || "1.0.0",
                },
            });
        saved.push(item);
    }
    await writeAudit({
        familyId,
        actorType: actor.type,
        actorId: actor.id,
        action: "knowledge_relations.import",
        entityType: "KnowledgeRelation",
        entityId: saved.map((item) => item.id).join(","),
        after: saved,
    });
    return saved;
}
export async function upsertChildKnowledgeState(familyId, input, actor = { type: "workbuddy" }) {
    const child = await prisma.child.findFirst({ where: { id: input.childId, familyId } });
    if (!child)
        throw new Error("学生不存在或不属于当前家庭");
    const node = await prisma.knowledgeNode.findFirst({ where: { id: input.knowledgeNodeId, familyId } });
    if (!node)
        throw new Error("知识节点不存在或不属于当前家庭");
    const knowledgeStatus = requireEnumValue(CHILD_KNOWLEDGE_STATUSES, input.status || "UNASSESSED", "知识点掌握状态（status）");
    const state = await prisma.childKnowledgeState.upsert({
        where: { childId_knowledgeNodeId: { childId: input.childId, knowledgeNodeId: input.knowledgeNodeId } },
        update: {
            status: knowledgeStatus,
            score: input.score,
            evidence: (input.evidence ?? undefined),
            manualStatus: knowledgeStatus,
            manualReason: input.manualReason,
            manualSource: actor.id || actor.type,
            lastPracticedAt: new Date(),
        },
        create: {
            familyId,
            childId: input.childId,
            knowledgeNodeId: input.knowledgeNodeId,
            status: knowledgeStatus,
            score: input.score || 0,
            evidence: (input.evidence ?? undefined),
            manualStatus: knowledgeStatus,
            manualReason: input.manualReason,
            manualSource: actor.id || actor.type,
        },
    });
    await writeAudit({
        familyId,
        actorType: actor.type,
        actorId: actor.id,
        action: "child_knowledge_state.upsert",
        entityType: "ChildKnowledgeState",
        entityId: state.id,
        after: state,
    });
    return state;
}
