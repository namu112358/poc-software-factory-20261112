import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { Alert, AlertDescription, AlertLead, AlertTitle } from "./alert";

/**
 * Stories は「意味のある状態」だけを置く。
 * 種類は色だけで伝えず、見出しか先頭の語でも書く。axe は全 Story に自動でかかる。
 */
const meta = {
  title: "部品/Alert",
  component: Alert,
  argTypes: {
    variant: { control: "inline-radio", options: ["note", "ok", "warn", "err"] },
  },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 補足の注記。落ち着いて読み上げられる（role="status"）。 */
export const Note: Story = {
  name: "注記",
  args: { variant: "note" },
  render: (args) => (
    <Alert {...args}>
      <AlertDescription>
        <AlertLead>注記:</AlertLead>
        金額は税抜で表示しています。
      </AlertDescription>
    </Alert>
  ),
  play: async ({ canvas }) => {
    const alert = canvas.getByRole("status");
    await expect(alert).toHaveClass("bg-surface-soft", "text-fg");
    await expect(alert).toHaveTextContent("注記:");
  },
};

/** 完了の知らせ。落ち着いて読み上げられる。 */
export const Ok: Story = {
  name: "完了",
  args: { variant: "ok" },
  render: (args) => (
    <Alert {...args}>
      <AlertDescription>
        <AlertLead>完了:</AlertLead>
        設定を保存しました。
      </AlertDescription>
    </Alert>
  ),
  play: async ({ canvas }) => {
    const alert = canvas.getByRole("status");
    await expect(alert).toHaveClass("bg-ok-soft");
    await expect(canvas.getByText("完了:")).toHaveClass("text-ok");
  },
};

/** 気をつけてほしいこと。落ち着いて読み上げられる。 */
export const Warn: Story = {
  name: "注意",
  args: { variant: "warn" },
  render: (args) => (
    <Alert {...args}>
      <AlertDescription>
        <AlertLead>注意:</AlertLead>
        この操作のあとは、内容を元に戻せません。
      </AlertDescription>
    </Alert>
  ),
  play: async ({ canvas }) => {
    const alert = canvas.getByRole("status");
    await expect(alert).toHaveClass("bg-warn-soft");
    await expect(canvas.getByText("注意:")).toHaveClass("text-warn");
  },
};

/** 誤りの知らせ。すぐ読み上げられる（role="alert"）。 */
export const Err: Story = {
  name: "誤り",
  args: { variant: "err" },
  render: (args) => (
    <Alert {...args}>
      <AlertDescription>
        <AlertLead>誤り:</AlertLead>
        保存できませんでした。もう一度お試しください。
      </AlertDescription>
    </Alert>
  ),
  play: async ({ canvas }) => {
    const alert = canvas.getByRole("alert");
    await expect(alert).toHaveClass("bg-err-soft");
    await expect(canvas.queryByRole("status")).toBeNull();
    await expect(canvas.getByText("誤り:")).toHaveClass("text-err");
  },
};

/** 見出しと本文に分ける。見出しは種類の色。 */
export const WithTitle: Story = {
  name: "見出しつき",
  args: { variant: "warn" },
  render: (args) => (
    <Alert {...args}>
      <AlertTitle>入力内容を確認してください</AlertTitle>
      <AlertDescription>期限が過ぎた項目が 2 件あります。</AlertDescription>
    </Alert>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("入力内容を確認してください");
    await expect(canvas.getByText("入力内容を確認してください")).toHaveClass("text-warn");
  },
};

/** 暗い表示。4 種類の文字と地のコントラストを axe で確かめるために置く。 */
export const Dark: Story = {
  name: "暗い表示",
  globals: { theme: "dark" },
  render: () => (
    <div className="flex flex-col gap-2">
      <Alert variant="note">
        <AlertTitle>注記</AlertTitle>
        <AlertDescription>金額は税抜で表示しています。</AlertDescription>
      </Alert>
      <Alert variant="ok">
        <AlertTitle>完了</AlertTitle>
        <AlertDescription>設定を保存しました。</AlertDescription>
      </Alert>
      <Alert variant="warn">
        <AlertTitle>注意</AlertTitle>
        <AlertDescription>この操作のあとは、内容を元に戻せません。</AlertDescription>
      </Alert>
      <Alert variant="err">
        <AlertTitle>誤り</AlertTitle>
        <AlertDescription>保存できませんでした。</AlertDescription>
      </Alert>
    </div>
  ),
};
