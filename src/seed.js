import { seedIfEmpty, getFamilySummary } from "./store.js";

seedIfEmpty();
console.log("Seed data ready.");
console.log(JSON.stringify(getFamilySummary("family_001"), null, 2));
