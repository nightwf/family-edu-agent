import { readDB, saveDB } from "../store.js";

const db = readDB();
const childIds = new Set(db.children.map((child) => child.id));

function removeOrphans(collectionName) {
  const before = db[collectionName].length;
  db[collectionName] = db[collectionName].filter((item) => childIds.has(item.child_id));
  return { before, after: db[collectionName].length, removed: before - db[collectionName].length };
}

const summary = {
  children: db.children.length,
  records: removeOrphans("records"),
  reports: removeOrphans("reports"),
  textbooks: removeOrphans("textbooks"),
  tasks: removeOrphans("tasks"),
  knowledge: removeOrphans("knowledge"),
};

saveDB();
console.log(JSON.stringify(summary, null, 2));
