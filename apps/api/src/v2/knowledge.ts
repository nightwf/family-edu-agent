import { prisma } from "../prisma.js";
import { writeAudit } from "./audit.js";

export type KnowledgeNodeInput = {
  type: string;
  title: string;
  subject?: string | null;
  grade?: string | null;
  description?: string | null;
  content?: Record<string, unknown> | null;
  sourcePage?: string | null;
  parentId?: string | null;
};

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
              type: node.type as any,
              title: node.title,
              subject: node.subject,
              grade: node.grade,
              description: node.description,
              content: (node.content ?? undefined) as any,
              sourcePage: node.sourcePage,
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
          type: node.type as any,
          title: node.title,
          subject: node.subject,
          grade: node.grade,
          description: node.description,
          content: (node.content ?? undefined) as any,
          sourcePage: node.sourcePage,
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
    prerequisites: prerequisites.map((item) => item.sourceNode),
    childState,
  };
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
