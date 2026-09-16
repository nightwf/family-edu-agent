import { prisma } from "../prisma.js";
import { writeAudit } from "./audit.js";

export type KnowledgeNodeInput = {
  type: string;
  title: string;
  subject?: string | null;
  grade?: string | null;
  description?: string | null;
  content?: Record<string, unknown> | null;
  evidence?: unknown;
  assessmentPrompt?: string | null;
  commonErrors?: unknown;
  sourcePage?: string | null;
  parentId?: string | null;
};

function normalizeKnowledgeNodeInput(node: KnowledgeNodeInput) {
  const raw = node as KnowledgeNodeInput & Record<string, unknown>;
  return {
    type: node.type as any,
    title: node.title,
    subject: node.subject,
    grade: node.grade,
    description: node.description,
    content: (node.content ?? undefined) as any,
    evidence: (raw.evidence ?? undefined) as any,
    assessmentPrompt: (node.assessmentPrompt ?? raw.assessment_prompt ?? undefined) as string | undefined,
    commonErrors: (raw.commonErrors ?? raw.common_errors ?? undefined) as any,
    sourcePage: (node.sourcePage ?? raw.source_page ?? undefined) as string | undefined,
  };
}

export async function importSourceDocument(
  familyId: string,
  input: {
    title: string;
    kind: string;
    subject?: string | null;
    grade?: string | null;
    publisher?: string | null;
    version?: string | null;
    fileKey?: string | null;
    nodes?: KnowledgeNodeInput[];
  },
  actor: { type: string; id?: string } = { type: "workbuddy" },
) {
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

export async function listSourceDocuments(
  familyId: string,
  filters: {
    subject?: string;
    grade?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const limit = Math.min(Math.max(Number(filters.limit || 20), 1), 100);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const where = {
    familyId,
    ...(filters.subject ? { subject: filters.subject } : {}),
    ...(filters.grade ? { grade: filters.grade } : {}),
    ...(filters.status ? { status: filters.status as any } : { status: "ACTIVE" }),
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

export async function saveKnowledgeNodesBatch(
  familyId: string,
  sourceDocumentId: string,
  nodes: KnowledgeNodeInput[],
  actor: { type: string; id?: string } = { type: "workbuddy" },
) {
  const source = await prisma.sourceDocument.findFirst({
    where: { id: sourceDocumentId, familyId },
  });
  if (!source) throw new Error("教材或来源不存在或不属于当前家庭");
  if (nodes.length === 0) throw new Error("知识节点不能为空");

  const created = await prisma.$transaction(
    nodes.map((node) =>
      prisma.knowledgeNode.create({
        data: {
          familyId,
          sourceDocumentId: source.id,
          ...normalizeKnowledgeNodeInput(node),
          version: source.version || "1.0.0",
        },
      }),
    ),
  );

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

export async function listKnowledgeNodes(
  familyId: string,
  filters: {
    subject?: string;
    grade?: string;
    status?: string;
    sourceDocumentId?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const limit = Math.min(Math.max(Number(filters.limit || 20), 1), 100);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const where = {
    familyId,
    ...(filters.subject ? { subject: filters.subject } : {}),
    ...(filters.grade ? { grade: filters.grade } : {}),
    ...(filters.sourceDocumentId ? { sourceDocumentId: filters.sourceDocumentId } : {}),
    ...(filters.status ? { status: filters.status as any } : { status: "ACTIVE" }),
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

export async function getKnowledgeContext(familyId: string, childId: string, nodeId: string) {
  const child = await prisma.child.findFirst({ where: { id: childId, familyId } });
  if (!child) throw new Error("学生不存在或不属于当前家庭");

  const node = await prisma.knowledgeNode.findFirst({
    where: { id: nodeId, familyId, status: "ACTIVE" },
  });
  if (!node) throw new Error("知识节点不存在、已过期或不属于当前家庭");

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

export type KnowledgeRelationInput = {
  prerequisiteTitle: string;
  dependentTitle: string;
  relationType?: string;
  strength?: string;
  reason?: string;
};

export async function saveKnowledgeRelationsBatch(
  familyId: string,
  sourceDocumentId: string,
  relations: KnowledgeRelationInput[],
  actor: { type: string; id?: string } = { type: "workbuddy" },
) {
  const source = await prisma.sourceDocument.findFirst({
    where: { id: sourceDocumentId, familyId },
  });
  if (!source) throw new Error("教材或来源不存在或不属于当前家庭");
  if (relations.length === 0) throw new Error("知识关系不能为空");

  const saved: Array<Record<string, unknown>> = [];
  for (const relation of relations) {
    if (relation.prerequisiteTitle === relation.dependentTitle) {
      throw new Error("知识节点不能成为自己的前置知识点");
    }

    const relationType = relation.relationType || "PREREQUISITE_OF";
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
      throw new Error(
        `知识关系中的知识点不存在：${relation.prerequisiteTitle} -> ${relation.dependentTitle}`,
      );
    }

    const existing = await prisma.knowledgeRelation.findFirst({
      where: {
        familyId,
        sourceNodeId: prerequisite.id,
        targetNodeId: dependent.id,
        relationType: relationType as any,
      },
    });
    const item =
      existing
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
              relationType: relationType as any,
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

export async function upsertChildKnowledgeState(
  familyId: string,
  input: {
    childId: string;
    knowledgeNodeId: string;
    status?: string;
    score?: number;
    evidence?: Record<string, unknown> | null;
    manualReason?: string | null;
  },
  actor: { type: string; id?: string } = { type: "workbuddy" },
) {
  const child = await prisma.child.findFirst({ where: { id: input.childId, familyId } });
  if (!child) throw new Error("学生不存在或不属于当前家庭");
  const node = await prisma.knowledgeNode.findFirst({ where: { id: input.knowledgeNodeId, familyId } });
  if (!node) throw new Error("知识节点不存在或不属于当前家庭");

  const state = await prisma.childKnowledgeState.upsert({
    where: { childId_knowledgeNodeId: { childId: input.childId, knowledgeNodeId: input.knowledgeNodeId } },
    update: {
      status: input.status as any,
      score: input.score,
      evidence: (input.evidence ?? undefined) as any,
      manualStatus: input.status,
      manualReason: input.manualReason,
      manualSource: actor.id || actor.type,
      lastPracticedAt: new Date(),
    },
    create: {
      familyId,
      childId: input.childId,
      knowledgeNodeId: input.knowledgeNodeId,
      status: input.status as any,
      score: input.score || 0,
      evidence: (input.evidence ?? undefined) as any,
      manualStatus: input.status,
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
