import { seedIfEmpty } from "./store.js";
import { startApi } from "./api.js";

seedIfEmpty();
await startApi();
