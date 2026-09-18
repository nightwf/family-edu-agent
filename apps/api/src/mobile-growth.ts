type TimelineItem = Record<string, any>;

type GrowthTimelineInput = {
  records?: TimelineItem[];
  reports?: TimelineItem[];
  evidenceRecords?: TimelineItem[];
  attempts?: TimelineItem[];
  wrongQuestions?: TimelineItem[];
  masteries?: TimelineItem[];
  stateSnapshots?: TimelineItem[];
};

const recordTypeLabels: Record<string, string> = {
  writing: "写作",
  reading: "阅读",
  homework: "作业",
  parent_note: "家长观察",
};

const evidenceTypeLabels: Record<string, string> = {
  WRITING: "写作观察",
  READING: "阅读观察",
  HOMEWORK_COMPLETION: "作业表现",
  QUESTION_ATTEMPT: "答题表现",
  RETEST: "复测结果",
  PARENT_NOTE: "家长观察",
};

const masteryLabels: Record<string, string> = {
  unassessed: "未评估",
  learning: "学习中",
  basic: "基本掌握",
  mastered: "已掌握",
  needs_review: "需复习",
};

const wrongLabels: Record<string, string> = {
  pending_correction: "待订正",
  strengthening: "巩固中",
  mastered: "已掌握",
  needs_review: "需复习",
  archived: "已归档",
};

function compact(value: unknown, fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function isoDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function toneForStatus(status: string) {
  if (["mastered", "CONFIRMED", "CORRECTED"].includes(status)) return "positive";
  if (["needs_review", "pending_correction"].includes(status)) return "attention";
  return "neutral";
}

function snapshotSummary(snapshot: TimelineItem) {
  const summary = snapshot.summary && typeof snapshot.summary === "object" ? snapshot.summary : {};
  const indicators = snapshot.indicators && typeof snapshot.indicators === "object" ? snapshot.indicators : {};
  return compact(
    summary.headline || summary.judgment || summary.summary || indicators.headline || indicators.judgment,
    "系统已根据近期证据更新孩子状态",
  );
}

export function buildGrowthTimeline(input: GrowthTimelineInput) {
  const records = input.records || [];
  const reports = input.reports || [];
  const recordIds = new Set(records.map((item) => String(item.id)));
  const evidenceRecords = (input.evidenceRecords || []).filter((item) => {
    const sourceRef = String(item.sourceRef || "");
    if (!sourceRef) return true;
    if (recordIds.has(sourceRef)) return false;
    return !sourceRef.startsWith("legacy-record:") || !recordIds.has(sourceRef.slice("legacy-record:".length));
  });
  const attempts = input.attempts || [];
  const wrongQuestions = input.wrongQuestions || [];
  const masteries = input.masteries || [];
  const stateSnapshots = input.stateSnapshots || [];
  const events: TimelineItem[] = [];

  for (const record of records) {
    const typeLabel = recordTypeLabels[record.type] || "成长记录";
    events.push({
      id: `record:${record.id}`,
      date: isoDate(record.date || record.createdAt),
      category: "record",
      category_label: typeLabel,
      title: compact(record.title, `${typeLabel}记录`),
      summary: compact(record.content || record.notes, "已保存一条学习成长记录"),
      score: record.score ?? null,
      status_label: record.score === null || record.score === undefined ? "已记录" : `${record.score} 分`,
      tone: record.score !== null && record.score !== undefined && Number(record.score) >= 80 ? "positive" : "neutral",
    });
  }

  for (const evidence of evidenceRecords) {
    const label = evidenceTypeLabels[evidence.type] || "学习观察";
    events.push({
      id: `evidence:${evidence.id}`,
      date: isoDate(evidence.observedAt || evidence.createdAt),
      category: "evidence",
      category_label: "学习证据",
      title: compact(evidence.taskDescription, label),
      summary: compact(evidence.observedBehavior || evidence.effectiveStrategy || evidence.counterEvidence, "已记录一次可回溯的学习表现"),
      score: null,
      status_label: evidence.reviewStatus === "CONFIRMED" ? "已确认" : evidence.reviewStatus === "CORRECTED" ? "已修正" : "待确认",
      tone: toneForStatus(evidence.reviewStatus || ""),
    });
  }

  for (const attempt of attempts) {
    const subject = attempt.questionType?.subject || "综合";
    const typeName = attempt.questionType?.name || "题目练习";
    const result = attempt.isCorrect === true ? "答对" : attempt.isCorrect === false ? "待巩固" : "已作答";
    events.push({
      id: `attempt:${attempt.id}`,
      date: isoDate(attempt.attemptedAt || attempt.createdAt),
      category: "attempt",
      category_label: `${subject}练习`,
      title: typeName,
      summary: compact(attempt.evaluation || attempt.errorReason || attempt.question?.stem, attempt.isCorrect === true ? "本次作答正确" : "已保存本次作答结果"),
      score: attempt.score ?? null,
      status_label: result,
      tone: attempt.isCorrect === true ? "positive" : attempt.isCorrect === false ? "attention" : "neutral",
    });
  }

  for (const wrong of wrongQuestions) {
    const typeName = wrong.questionType?.name || "未分类题型";
    events.push({
      id: `wrong:${wrong.id}`,
      date: isoDate(wrong.firstWrongAt || wrong.createdAt),
      category: "wrong_question",
      category_label: `${wrong.subject || "综合"}错题`,
      title: `发现薄弱点 · ${typeName}`,
      summary: compact(wrong.errorReason || wrong.keyLearningPoint || wrong.question?.stem, "错题已进入针对性巩固流程"),
      score: null,
      status_label: wrongLabels[wrong.status] || "已收录",
      tone: toneForStatus(wrong.status || ""),
    });
    if (wrong.masteredAt) {
      events.push({
        id: `wrong-mastered:${wrong.id}`,
        date: isoDate(wrong.masteredAt),
        category: "milestone",
        category_label: "掌握里程碑",
        title: `已掌握 · ${typeName}`,
        summary: compact(wrong.keyLearningPoint || wrong.correctionMethod, "已通过订正、变式练习和复测验证"),
        score: wrong.masteryScore ?? null,
        status_label: "已掌握",
        tone: "positive",
      });
    }
  }

  for (const mastery of masteries) {
    const status = mastery.status || mastery.calculatedStatus || "unassessed";
    const correctRate = Math.round(Number(mastery.correctRate || 0) * 100);
    events.push({
      id: `mastery:${mastery.id}`,
      date: isoDate(mastery.lastAssessedAt || mastery.updatedAt || mastery.lastPracticedAt),
      category: "mastery",
      category_label: `${mastery.questionType?.subject || "综合"}掌握度`,
      title: mastery.questionType?.name || "题型掌握更新",
      summary: `累计练习 ${mastery.totalAttempts || 0} 次，正确率 ${correctRate}%，覆盖 ${mastery.variationCount || 0} 种变式`,
      score: mastery.masteryScore ?? null,
      status_label: masteryLabels[status] || status,
      tone: toneForStatus(status),
    });
  }

  for (const report of reports) {
    const typeLabel = report.type === "weekly" ? "周报" : report.type === "monthly" ? "月报" : "阶段报告";
    events.push({
      id: `report:${report.id}`,
      date: isoDate(report.createdAt || report.periodEnd),
      category: "report",
      category_label: typeLabel,
      title: compact(report.title, typeLabel),
      summary: compact(report.summary || report.content, "已形成阶段性学习总结"),
      score: null,
      status_label: "已生成",
      tone: "neutral",
    });
  }

  for (const snapshot of stateSnapshots) {
    events.push({
      id: `state:${snapshot.id}`,
      date: isoDate(snapshot.asOf || snapshot.generatedAt),
      category: "state",
      category_label: "状态更新",
      title: "孩子阶段状态已更新",
      summary: snapshotSummary(snapshot),
      score: null,
      status_label: snapshot.periodWindow || "阶段观察",
      tone: "neutral",
    });
  }

  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const masteredWrong = wrongQuestions.filter((item) => item.status === "mastered").length;
  const openWrong = wrongQuestions.filter((item) => ["pending_correction", "strengthening", "needs_review"].includes(item.status)).length;
  const masteredTypes = masteries.filter((item) => item.status === "mastered").length;

  return {
    events: events.slice(0, 100),
    summary: {
      evidence_count: records.length + evidenceRecords.length + attempts.length,
      open_wrong: openWrong,
      mastered_wrong: masteredWrong,
      mastered_types: masteredTypes,
      tracked_types: masteries.length,
      last_activity_at: events[0]?.date || null,
    },
  };
}
