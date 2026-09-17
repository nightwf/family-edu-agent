import { listStudentMastery } from "./question-bank.js";
import { listWrongQuestions } from "./wrong-book.js";
import { getChildState } from "./v2/child-state.js";
import { getLatestRelationship } from "./v2/relationship.js";

export async function loadMobileHomeInsights(familyId: string, childId: string | null) {
  if (!childId) {
    return {
      child_state: null,
      relationship: null,
      wrong_questions: { items: [], total: 0 },
      mastery: { items: [], total: 0 },
    };
  }

  const [childState, relationship, wrongQuestions, mastery] = await Promise.allSettled([
    getChildState(familyId, childId),
    getLatestRelationship(familyId, childId),
    listWrongQuestions(familyId, { child_id: childId, limit: 5, offset: 0 }),
    listStudentMastery(familyId, { child_id: childId, limit: 20, offset: 0 }),
  ]);

  return {
    child_state: childState.status === "fulfilled" ? childState.value : null,
    relationship: relationship.status === "fulfilled" ? relationship.value : null,
    wrong_questions: wrongQuestions.status === "fulfilled" ? wrongQuestions.value : { items: [], total: 0 },
    mastery: mastery.status === "fulfilled" ? mastery.value : { items: [], total: 0 },
  };
}
