import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canRequestExtension,
  extensionResultLabel,
  pendingExtensionLabel,
  recentExtensionResults,
  submitExtensionRequest,
  validateExtensionRequestForm,
  type PanelExtension,
} from "../src/lib/task-extension-panel.ts";

const ext = (id: number, status: PanelExtension["status"], createdAt: string): PanelExtension => ({
  id,
  newDueDate: "2026-11-20",
  status,
  createdAt,
});

describe("canRequestExtension", () => {
  it("is true only for the assignee when nothing is pending", () => {
    assert.equal(canRequestExtension("sato", "sato", []), true);
    assert.equal(canRequestExtension("sato", "sato", [ext(1, "approved", "2026-11-01T00:00:00Z")]), true);
    assert.equal(canRequestExtension("sato", "sato", [ext(1, "pending", "2026-11-01T00:00:00Z")]), false);
    assert.equal(canRequestExtension("sato", "suzuki", []), false);
  });
});

describe("labels", () => {
  it("shows pending with the desired date as M/D", () => {
    assert.equal(pendingExtensionLabel("2026-11-05"), "承認待ち（希望の期限 11/5）");
    assert.equal(extensionResultLabel(ext(1, "rejected", "2026-11-01T00:00:00Z")), "却下（希望の期限 11/20）");
  });
});

describe("recentExtensionResults", () => {
  it("returns decided ones, newest first, at most 5", () => {
    const list = [
      ext(1, "approved", "2026-11-01T00:00:00Z"),
      ext(2, "rejected", "2026-11-02T00:00:00Z"),
      ext(3, "approved", "2026-11-03T00:00:00Z"),
      ext(4, "rejected", "2026-11-04T00:00:00Z"),
      ext(5, "approved", "2026-11-05T00:00:00Z"),
      ext(6, "approved", "2026-11-06T00:00:00Z"),
      ext(7, "pending", "2026-11-07T00:00:00Z"),
    ];
    assert.deepEqual(recentExtensionResults(list).map((e) => e.id), [6, 5, 4, 3, 2]);
  });
});

describe("validateExtensionRequestForm", () => {
  it("rejects empty or not-later dates and an empty reason", () => {
    assert.equal(validateExtensionRequestForm({ newDueDate: "2026-11-20", reason: "x" }, "2026-11-15").length, 0);
    assert.equal(validateExtensionRequestForm({ newDueDate: "", reason: "x" }, "2026-11-15").length, 1);
    assert.equal(validateExtensionRequestForm({ newDueDate: "2026-11-15", reason: "x" }, "2026-11-15").length, 1);
    assert.equal(validateExtensionRequestForm({ newDueDate: "2026-11-10", reason: "x" }, "2026-11-15").length, 1);
    assert.equal(validateExtensionRequestForm({ newDueDate: "2026-11-20", reason: "  " }, "2026-11-15").length, 1);
  });
});

describe("submitExtensionRequest", () => {
  it("does not send an invalid request", async () => {
    let called = false;
    const r = await submitExtensionRequest(3, { newDueDate: "2026-11-10", reason: "x" }, "2026-11-15", {
      fetch: async () => {
        called = true;
        return { ok: true, status: 201, json: async () => ({}) };
      },
    });
    assert.equal(called, false);
    assert.equal(r.status, "error");
  });

  it("posts the trimmed reason and reports success", async () => {
    let sent: { url: string; body: string } | undefined;
    const r = await submitExtensionRequest(3, { newDueDate: "2026-11-20", reason: " 待ち " }, "2026-11-15", {
      fetch: async (url, init) => {
        sent = { url, body: init.body };
        return { ok: true, status: 201, json: async () => ({}) };
      },
    });
    assert.equal(r.status, "created");
    assert.equal(sent?.url, "/api/tasks/3/extensions");
    assert.deepEqual(JSON.parse(sent!.body), { newDueDate: "2026-11-20", reason: "待ち" });
  });

  it("shows API errors in Japanese (409 and details)", async () => {
    const conflict = await submitExtensionRequest(3, { newDueDate: "2026-11-20", reason: "x" }, "2026-11-15", {
      fetch: async () => ({ ok: false, status: 409, json: async () => ({ error: "保留中の延長申請がすでにあります" }) }),
    });
    assert.equal(conflict.status, "error");
    const bad = await submitExtensionRequest(3, { newDueDate: "2026-11-20", reason: "x" }, "2026-11-15", {
      fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: "e", details: ["誤り"] }) }),
    });
    assert.deepEqual(bad, { status: "error", message: "誤り" });
  });
});
