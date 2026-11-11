import { test } from "node:test";
import assert from "node:assert/strict";
import { convert, AXES } from "./import-grades.mjs";

const base = { version: 1, kind: "perfectman-human-grades", exported_at: "2026-11-11T00:00:00.000Z", grades: [] };
const scores = Object.fromEntries(AXES.map((a, i) => [a, (i % 5) + 1]));
const done = { clip_id: "c03", run_id: 62, window_s: [300, 600], complete: true, scores, note: "n", climax_reached: "yes", climax_time_s: 390, updated_at: "2026-11-11T01:00:00.000Z" };

test("complete clip becomes a label with six axis scores and climax", () => {
  const { labels, skipped } = convert({ ...base, grades: [done] });
  assert.equal(skipped.length, 0);
  assert.deepEqual(Object.keys(labels[0].scores), AXES);
  assert.equal(labels[0].scores.narrative_arc.score, 1);
  assert.deepEqual(labels[0].climax, { reached: "yes", time_s: 390 });
  assert.equal(labels[0].run, 62);
});

test("incomplete clips are skipped, never filled in", () => {
  const empty = { clip_id: "c01", run_id: 61, window_s: null, complete: false, scores: Object.fromEntries(AXES.map(a => [a, null])), climax_reached: null };
  const { labels, skipped } = convert({ ...base, grades: [empty, done] });
  assert.equal(labels.length, 1);
  assert.deepEqual(skipped, [{ clip_id: "c01", why: "incomplete" }]);
});

test("rejects bad scores and wrong files", () => {
  assert.throws(() => convert({ ...base, grades: [{ ...done, scores: { ...scores, entertainment: 6 } }] }), /entertainment/);
  assert.throws(() => convert({ nope: 1 }), /not a perfectman/);
  assert.throws(() => convert({ ...base, grades: [{ ...done, climax_time_s: null }] }), /climax time/);
});

test("no climax time for a no answer", () => {
  const { labels } = convert({ ...base, grades: [{ ...done, climax_reached: "no", climax_time_s: null }] });
  assert.deepEqual(labels[0].climax, { reached: "no", time_s: null });
});
