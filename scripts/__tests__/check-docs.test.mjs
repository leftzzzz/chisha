import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectMarkdownFiles,
  extractLocalLinks,
  hasArchiveMarker,
  validateMarkdownLinks,
} from "../check-docs.mjs";

const fixtureRoot = fileURLToPath(new URL("../fixtures/docs-check/", import.meta.url));

test("reports an ordinary Markdown link whose target is missing", () => {
  const fixture = path.join(fixtureRoot, "violating.md");
  const errors = validateMarkdownLinks(fixtureRoot, [fixture]);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /does-not-exist\.md/);
});

test("ignores link-shaped text in fenced code and accepts an archive marker", () => {
  const fixture = path.join(fixtureRoot, "safe-archive.md");
  const text = readFileSync(fixture, "utf8");

  assert.deepEqual(extractLocalLinks(text), []);
  assert.equal(hasArchiveMarker(text), true);
});

test("collects Markdown files without treating adjacent text files as documentation", () => {
  const files = collectMarkdownFiles(fixtureRoot).map((file) => path.basename(file));

  assert.deepEqual(files, ["safe-archive.md", "violating.md"]);
});
