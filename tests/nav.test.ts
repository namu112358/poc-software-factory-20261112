import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HEADER_NAV_LINKS, SETTINGS_NAV_LINKS } from "../src/lib/nav.ts";

const hrefs = (links: readonly { href: string }[]) => links.map((l) => l.href);

describe("移動先の並び", () => {
  it("画面の上には、タスクに関わる 8 つの移動先と「設定」がある", () => {
    assert.deepEqual(hrefs(HEADER_NAV_LINKS), [
      "/tasks", "/tasks/new", "/overdue", "/board", "/members", "/tags", "/extensions", "/tasks/deleted", "/settings",
    ]);
  });
  it("自分の設定の 3 つは設定に置き、画面の上には無い", () => {
    assert.deepEqual(hrefs(SETTINGS_NAV_LINKS), ["/settings/password", "/settings/sessions", "/settings/absence"]);
    for (const h of hrefs(SETTINGS_NAV_LINKS)) assert.ok(!hrefs(HEADER_NAV_LINKS).includes(h));
  });
});
