import { v } from "convex/values";

// What remixable parts are edited on: a design in the studio (before publishing) or a published work.
export const remixTarget = v.union(v.object({ workId: v.id("works") }), v.object({ generationId: v.id("generations") }));

