import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";

import { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger } from "./tabs";

/**
 * Stories は「意味のある状態」だけを置く。
 * play の中の確かめは、利用者から見た振る舞い（矢印キーで移る・中身に移る・読み上げの名前）だけにする。
 * axe は、すべての Story に自動でかかる（.storybook/preview.tsx）。
 */
const meta = {
  title: "部品/Tabs",
  component: Tabs,
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ふつうの使い方。左右の矢印キーでタブを移り、Tab キーで中身に移る。 */
export const Default: Story = {
  name: "ふつう",
  render: () => (
    <Tabs defaultValue="overview">
      <TabsList aria-label="表示の切り替え">
        <TabsTrigger value="overview">概要</TabsTrigger>
        <TabsTrigger value="detail">詳細</TabsTrigger>
        <TabsTrigger value="history">履歴</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <p className="text-base text-fg">全体のようすをまとめて見られます。</p>
        <button type="button">中身の操作</button>
      </TabsContent>
      <TabsContent value="detail">
        <p className="text-base text-fg">項目ごとの細かい内容を見られます。</p>
      </TabsContent>
      <TabsContent value="history">
        <p className="text-base text-fg">これまでの変更を見られます。</p>
      </TabsContent>
    </Tabs>
  ),
  play: async ({ canvas }) => {
    const overview = canvas.getByRole("tab", { name: "概要" });
    const detail = canvas.getByRole("tab", { name: "詳細" });
    await expect(overview).toHaveAttribute("aria-selected", "true");
    await expect(detail).toHaveAttribute("aria-selected", "false");

    await userEvent.tab();
    await expect(overview).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}");
    await expect(detail).toHaveFocus();
    await expect(detail).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByRole("tabpanel", { name: "詳細" })).toBeVisible();
    await expect(canvas.queryByRole("tabpanel", { name: "概要" })).toBeNull();

    await userEvent.keyboard("{ArrowLeft}");
    await expect(overview).toHaveFocus();
    await expect(canvas.getByRole("tabpanel", { name: "概要" })).toBeVisible();

    // Tab キーで、選んだタブの中身に移る。
    await userEvent.tab();
    const panel = canvas.getByRole("tabpanel", { name: "概要" });
    await expect(panel).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "中身の操作" })).toHaveFocus();
  },
};

/** 件数つき。件数はタブの名前の読み上げに含まれる。 */
export const WithCount: Story = {
  name: "件数つき",
  render: () => (
    <Tabs defaultValue="open">
      <TabsList aria-label="状態の切り替え">
        <TabsTrigger value="open">
          未対応
          <TabsCount>3</TabsCount>
        </TabsTrigger>
        <TabsTrigger value="done">完了</TabsTrigger>
      </TabsList>
      <TabsContent value="open">
        <p className="text-base text-fg">対応が必要な項目の一覧です。</p>
      </TabsContent>
      <TabsContent value="done">
        <p className="text-base text-fg">対応が済んだ項目の一覧です。</p>
      </TabsContent>
    </Tabs>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /未対応\s*3/ })).toBeVisible();
    await expect(canvas.getByRole("tab", { name: "完了" })).toBeVisible();
  },
};

/** 押せないタブがある。矢印キーで飛ばされ、クリックしても選ばれない。 */
export const WithDisabled: Story = {
  name: "押せないタブがある",
  render: () => (
    <Tabs defaultValue="first">
      <TabsList aria-label="表示の切り替え">
        <TabsTrigger value="first">最初</TabsTrigger>
        <TabsTrigger value="second" disabled>
          準備中
        </TabsTrigger>
        <TabsTrigger value="third">最後</TabsTrigger>
      </TabsList>
      <TabsContent value="first">
        <p className="text-base text-fg">最初の中身です。</p>
      </TabsContent>
      <TabsContent value="second">
        <p className="text-base text-fg">まだ使えません。</p>
      </TabsContent>
      <TabsContent value="third">
        <p className="text-base text-fg">最後の中身です。</p>
      </TabsContent>
    </Tabs>
  ),
  play: async ({ canvas }) => {
    const first = canvas.getByRole("tab", { name: "最初" });
    const disabled = canvas.getByRole("tab", { name: "準備中" });
    const last = canvas.getByRole("tab", { name: "最後" });
    await expect(disabled).toBeDisabled();

    await userEvent.tab();
    await expect(first).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(last).toHaveFocus();
    await expect(last).toHaveAttribute("aria-selected", "true");
    await expect(disabled).toHaveAttribute("aria-selected", "false");
  },
};

/** 暗い表示。文字と背景のコントラストを axe で確かめるために置く。 */
export const Dark: Story = {
  name: "暗い表示",
  globals: { theme: "dark" },
  render: () => (
    <Tabs defaultValue="open">
      <TabsList aria-label="状態の切り替え">
        <TabsTrigger value="open">
          未対応
          <TabsCount>3</TabsCount>
        </TabsTrigger>
        <TabsTrigger value="done">完了</TabsTrigger>
        <TabsTrigger value="hold" disabled>
          保留
        </TabsTrigger>
      </TabsList>
      <TabsContent value="open">
        <p className="text-base text-fg">対応が必要な項目の一覧です。</p>
      </TabsContent>
      <TabsContent value="done">
        <p className="text-base text-fg">対応が済んだ項目の一覧です。</p>
      </TabsContent>
    </Tabs>
  ),
};
