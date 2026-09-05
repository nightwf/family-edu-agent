import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function toEvidenceType(type) {
  const map = {
    writing: "WRITING",
    reading: "READING",
    homework: "HOMEWORK_COMPLETION",
    parent_note: "PARENT_NOTE",
  };
  return map[type] || "OBSERVATION";
}

function toKnowledgeType(kind) {
  const map = {
    report: "EXAMPLE",
    summary: "CONCEPT",
    suggestion: "MISCONCEPTION",
    knowledge: "KNOWLEDGE_POINT",
  };
  return map[kind] || "KNOWLEDGE_POINT";
}

async function migrateFamily(family) {
  await prisma.familyPolicy.upsert({
    where: { familyId: family.id },
    update: {},
    create: {
      familyId: family.id,
      weeklyTimeBudget: null,
      prioritySubjects: [],
      pressureBoundary: null,
      parentGoals: family.parentGoals || [],
      principles: {
        educationPhilosophy: family.educationPhilosophy,
        communicationStyle: family.communicationStyle,
        strictness: family.strictness,
      },
    },
  });
}

async function migrateChild(child) {
  const records = await prisma.record.findMany({
    where: { familyId: child.familyId, childId: child.id },
  });

  for (const record of records) {
    const sourceRef = `legacy-record:${record.id}`;
    const exists = await prisma.evidenceRecord.findFirst({
      where: { familyId: child.familyId, childId: child.id, sourceRef },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.evidenceRecord.create({
      data: {
        familyId: child.familyId,
        childId: child.id,
        type: toEvidenceType(record.type),
        taskDescription: record.title,
        observedBehavior: record.content,
        effectiveStrategy: record.notes,
        source: "legacy",
        sourceRef,
        observedAt: record.date,
        reviewStatus: "CONFIRMED",
        reviewedAt: new Date(),
        reviewedBy: "legacy-migration",
      },
    });
  }

  const reports = await prisma.report.findMany({
    where: { familyId: child.familyId, childId: child.id },
  });
  for (const report of reports) {
    const exists = await prisma.stageReport.findFirst({
      where: {
        familyId: child.familyId,
        childId: child.id,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
      },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.stageReport.create({
      data: {
        familyId: child.familyId,
        childId: child.id,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        verdict: "legacy",
        summary: report.summary || report.content,
        evidence: report.metrics ?? undefined,
        status: "legacy",
      },
    });
  }
}

async function migrateResources(family) {
  const textbooks = await prisma.textbook.findMany({ where: { familyId: family.id } });
  for (const textbook of textbooks) {
    const exists = await prisma.sourceDocument.findFirst({
      where: {
        familyId: family.id,
        title: textbook.title,
        subject: textbook.subject,
        grade: textbook.grade,
        publisher: textbook.publisher,
        version: textbook.version,
      },
      select: { id: true },
    });
    if (exists) continue;

    const source = await prisma.sourceDocument.create({
      data: {
        familyId: family.id,
        title: textbook.title,
        kind: "textbook",
        subject: textbook.subject,
        grade: textbook.grade,
        publisher: textbook.publisher,
        version: textbook.version,
        fileKey: textbook.fileKey,
        status: textbook.status === "ready" ? "ACTIVE" : "DRAFT",
      },
    });

    const nodes = Array.isArray(textbook.knowledgePoints)
      ? textbook.knowledgePoints
      : [];
    for (const point of nodes) {
      await prisma.knowledgeNode.create({
        data: {
          familyId: family.id,
          sourceDocumentId: source.id,
          type: "KNOWLEDGE_POINT",
          subject: textbook.subject,
          grade: textbook.grade,
          title: point,
          version: textbook.version || "1.0.0",
        },
      });
    }
  }

  const knowledge = await prisma.knowledgeItem.findMany({ where: { familyId: family.id } });
  for (const item of knowledge) {
    const sourceRef = `legacy-knowledge:${item.id}`;
    const exists = await prisma.knowledgeNode.findFirst({
      where: { familyId: family.id, title: item.title, sourcePage: sourceRef },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.knowledgeNode.create({
      data: {
        familyId: family.id,
        type: toKnowledgeType(item.kind),
        title: item.title,
        description: item.content,
        sourcePage: sourceRef,
        version: "1.0.0",
      },
    });
  }
}

async function main() {
  const families = await prisma.family.findMany({ where: { status: "active" } });
  let childCount = 0;
  let recordCount = 0;

  for (const family of families) {
    await migrateFamily(family);
    await migrateResources(family);
    const children = await prisma.child.findMany({
      where: { familyId: family.id, status: "active" },
    });
    for (const child of children) {
      childCount += 1;
      await migrateChild(child);
    }
  }

  recordCount = await prisma.evidenceRecord.count();
  console.log(
    `V2 migration completed: ${families.length} families, ${childCount} children, ${recordCount} evidence records. Legacy tables were left untouched.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
