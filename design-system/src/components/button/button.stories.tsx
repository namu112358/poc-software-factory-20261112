import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";

import { Button } from "./button";

/**
 * Stories は「意味のある状態」だけを置く（見た目の組み合わせを総当たりにしない）。
 * play の中の確かめは、利用者から見た振る舞い（押せる・押せない・キーボードで押せる）だけにする。
 * axe（アクセシビリティの検査）は、すべての Story に自動でかかる（.storybook/preview.tsx）。
 */
const meta = {
  title: "部品/Button",
  component: Button,
  args: {
    children: "保存する",
    onClick: fn(),
  },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "secondary", "quiet"] },
    size: { control: "inline-radio", options: ["md", "sm", "icon"] },
    asChild: { control: false },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 画面でいちばん大事な操作。クリックでも、キーボード（Enter・Space）でも押せる。 */
export const Primary: Story = {
  name: "主な操作",
  args: { variant: "primary", children: "計算する" },
  play: async ({ args, canvas }) => {
    const button = canvas.getByRole("button", { name: "計算する" });

    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    await expect(args.onClick).toHaveBeenCalledTimes(2);

    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(3);
  },
};

/** ふつうの操作。フォームの中に置いても、勝手に送信しない。 */
export const Secondary: Story = {
  name: "ふつうの操作",
  args: { variant: "secondary" },
  render: (args) => (
    <form
      aria-label="見本のフォーム"
      onSubmit={(event) => {
        event.preventDefault();
        event.currentTarget.dataset.submitted = "true";
      }}
    >
      <Button {...args} />
    </form>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "保存する" }));
    await expect(canvas.getByRole("form", { name: "見本のフォーム" })).not.toHaveAttribute("data-submitted");
  },
};

/** 目立たせない操作。 */
export const Quiet: Story = {
  name: "控えめな操作",
  args: { variant: "quiet", children: "詳しく見る" },
};

/** 表の行の中など、狭い場所に置く小さいボタン。 */
export const Small: Story = {
  name: "小さい",
  args: { size: "sm", children: "直す" },
};

/** 押せない状態。クリックしても何も起きず、Tab でも止まらない。 */
export const Disabled: Story = {
  name: "押せない",
  args: { variant: "primary", disabled: true, children: "計算する" },
  play: async ({ args, canvas }) => {
    const button = canvas.getByRole("button", { name: "計算する" });
    await expect(button).toBeDisabled();

    await userEvent.click(button, { pointerEventsCheck: 0 });
    await expect(args.onClick).not.toHaveBeenCalled();

    await userEvent.tab();
    await expect(button).not.toHaveFocus();
  },
};

/** アイコンだけのボタン。読み上げには aria-label の文言が使われる。 */
export const IconOnly: Story = {
  name: "アイコンだけ",
  args: {
    size: "icon",
    variant: "quiet",
    "aria-label": "お知らせ",
    children: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    ),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "お知らせ" })).toBeVisible();
  },
};

/** 別の画面へ移るときは、ボタンの見た目のリンクにする（asChild）。 */
export const AsLink: Story = {
  name: "リンクとして",
  args: { asChild: true, variant: "primary" },
  render: (args) => (
    <Button {...args}>
      <a href="#next">次の画面へ</a>
    </Button>
  ),
  play: async ({ canvas }) => {
    const link = canvas.getByRole("link", { name: "次の画面へ" });
    await expect(link).toHaveAttribute("href", "#next");
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

/** 暗い表示。文字と背景のコントラストを axe で確かめるために置く。 */
export const Dark: Story = {
  name: "暗い表示",
  globals: { theme: "dark" },
  render: (args) => (
    <div className="flex gap-2">
      <Button {...args} variant="primary">
        計算する
      </Button>
      <Button {...args} variant="secondary">
        保存する
      </Button>
      <Button {...args} variant="quiet">
        詳しく見る
      </Button>
    </div>
  ),
};
