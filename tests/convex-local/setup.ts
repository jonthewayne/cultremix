/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../../convex/schema";

// Every Convex module, loaded lazily: convex-test imports only the files a test calls. Node actions
// ("use node" files) can't run here; test their pure helpers in tests/unit instead.
export const modules = import.meta.glob("../../convex/**/!(*.*.*)*.*s");

export function newTest() {
  return convexTest(schema, modules);
}
