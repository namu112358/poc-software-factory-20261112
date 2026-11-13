import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TAG_MAX_LENGTH, formatTagLimitHint } from "../src/lib/tag-limits.ts";
import { TAG_MAX_LENGTH as FROM_TAGS, validateTagInput } from "../src/lib/tags.ts";
import { DUE_FILTER_LABELS } from "../src/lib/task-types.ts";
import { DUE_SOON_DAYS } from "../src/lib/task-dates.ts";

describe("タグの長さの上限", () => {
  it("保存の判定と入力欄は同じ値（TAG_MAX_LENGTH）で、境界の長さが一致する", () => {
    assert.equal(FROM_TAGS, TAG_MAX_LENGTH);
    assert.equal(validateTagInput({ name: "a".repeat(TAG_MAX_LENGTH) }).ok, true);
    assert.equal(validateTagInput({ name: "a".repeat(TAG_MAX_LENGTH + 1) }).ok, false);
  });
  it("案内の文に上限の数字が入る", () => {
    assert.ok(formatTagLimitHint().includes(`${TAG_MAX_LENGTH} 文字`));
  });
  it("入力欄の maxLength は直接の数字ではなく TAG_MAX_LENGTH から作られている", () => {
    const src = readFileSync(new URL("../src/app/tasks/[id]/tags.tsx", import.meta.url), "utf8");
    assert.match(src, /maxLength=\{TAG_MAX_LENGTH\}/);
  });
});

describe("期限の絞り込みの「N 日以内」", () => {
  it("N は DUE_SOON_DAYS から作られ、今の値では「3 日以内」", () => {
    assert.equal(DUE_FILTER_LABELS.soon, `${DUE_SOON_DAYS} 日以内`);
    assert.equal(DUE_FILTER_LABELS.soon, "3 日以内");
  });
});
