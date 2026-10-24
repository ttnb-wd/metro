import { test } from "node:test";
import { reviewInitialMigration } from "./review-initial-migration.mts";
test("initial migration contains only atomic authentication table/index/foreign-key creation", () => { reviewInitialMigration(); });
