import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { Badge } from "./badge";

/**
 * Stories は「意味のある状態」だけを置く。
 * axe（アクセシビリティの検査）は、すべての Story に自動でかかる（.storybook/preview.tsx）。
 */
const meta = {
  title: "部品/Badge",
  component: Badge,
  args: {
    children: "下書き",
  },
  argTypes: {
    variant: { control: "inline-radio", options: ["neutral", "ok", "warn", "err"] },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 状態の良し悪しを言わない札。押せる要素ではない。 */
export const Neutral: Story = {
  name: "中立",
  args: { variant: "neutral", children: "下書き" },
  play: async ({ canvas }) => {
    const badge = canvas.getByText("下書き");
    await expect(badge.tagName).toBe("SPAN");
    await expect(badge).toHaveClass("bg-surface", "text-fg-2");
    await expect(canvas.queryByRole("button")).toBeNull();
    await expect(canvas.queryByRole("link")).toBeNull();
  },
};

/** 問題の無い状態。 */
export const Ok: Story = {
  name: "済み",
  args: { variant: "ok", children: "確定" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("確定")).toHaveClass("bg-ok-soft", "text-ok");
  },
};

/** 気にかけたい状態。 */
export const Warn: Story = {
  name: "注意",
  args: { variant: "warn", children: "見込み" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("見込み")).toHaveClass("bg-warn-soft", "text-warn");
  },
};

/** 直す必要がある状態。 */
export const Err: Story = {
  name: "誤り",
  args: { variant: "err", children: "遅れ" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("遅れ")).toHaveClass("bg-err-soft", "text-err");
  },
};

/** 並べても、間隔があり、読み上げで 1 つの文字列につながらない。 */
export const Side: Story = {
  name: "並べたとき",
  render: () => (
    <ul aria-label="状態の一覧" className="flex list-none gap-2 p-0">
      <li>
        <Badge variant="ok">確定</Badge>
      </li>
      <li>
        <Badge variant="warn">見込み</Badge>
      </li>
      <li>
        <Badge variant="err">遅れ</Badge>
      </li>
    </ul>
  ),
  play: async ({ canvas }) => {
    const items = canvas.getAllByRole("listitem");
    await expect(items).toHaveLength(3);
    await expect(items.map((item) => item.textContent)).toEqual(["確定", "見込み", "遅れ"]);

    const list = canvas.getByRole("list", { name: "状態の一覧" });
    await expect(parseFloat(getComputedStyle(list).columnGap)).toBeGreaterThan(0);

    const first = canvas.getByText("確定").getBoundingClientRect();
    const second = canvas.getByText("見込み").getBoundingClientRect();
    await expect(second.left).toBeGreaterThan(first.right);
  },
};

/** 暗い表示。文字と背景のコントラストを axe で確かめるために置く。 */
export const Dark: Story = {
  name: "暗い表示",
  globals: { theme: "dark" },
  render: () => (
    <ul aria-label="状態の一覧" className="flex list-none gap-2 p-0">
      <li>
        <Badge variant="neutral">下書き</Badge>
      </li>
      <li>
        <Badge variant="ok">確定</Badge>
      </li>
      <li>
        <Badge variant="warn">見込み</Badge>
      </li>
      <li>
        <Badge variant="err">遅れ</Badge>
      </li>
    </ul>
  ),
};
