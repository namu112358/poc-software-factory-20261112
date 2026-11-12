import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { buildCheckboxOptions, filterConditionsFromForm } from "../src/lib/task-filter-form.ts";

describe("buildCheckboxOptions", () => {
  it("checks only selected values and keeps unselected options (including the 'none' option)", () => {
    const opts = buildCheckboxOptions([{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "none", label: "担当者なし" }], ["none", "a"]);
    assert.deepEqual(opts.map((o) => o.checked), [true, false, true]);
    assert.deepEqual(opts.map((o) => o.label), ["A", "B", "担当者なし"]);
  });
});

describe("filterConditionsFromForm", () => {
  it("collects every checked assignee and tag, ignoring invalid ones", () => {
    const db = openDb();
    const form = new URLSearchParams("assignee=sato&assignee=none&assignee=bogus&tag=__no_such_tag__");
    const { assignees, tags } = filterConditionsFromForm(form, db);
    assert.deepEqual(assignees, ["sato", "none"]);
    assert.deepEqual(tags, []);
  });

  it("returns empty conditions when nothing is checked", () => {
    assert.deepEqual(filterConditionsFromForm(new URLSearchParams(""), openDb()), { assignees: [], tags: [] });
  });
});
