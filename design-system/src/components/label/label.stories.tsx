import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";

import { Label } from "./label";

/**
 * Label は入力欄と組み合わせて使う。Input などの部品はまだ無いので、Story では素の <input> を使う。
 * axe（アクセシビリティの検査）は、すべての Story に自動でかかる（.storybook/preview.tsx）。
 */
const meta = {
  title: "部品/Label",
  component: Label,
  args: {
    children: "表示名",
    htmlFor: "field",
  },
  argTypes: {
    required: { control: "boolean" },
    disabled: { control: "boolean" },
  },
  render: (args) => (
    <div className="flex flex-col gap-1">
      <Label {...args} />
      <input id="field" type="text" className="rounded-md border border-border-strong bg-bg px-2.5 py-1.5 text-base text-fg" />
    </div>
  ),
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ふつうの名前。名前を押すと、結び付いた欄にフォーカスが移る。 */
export const Default: Story = {
  name: "ふつう",
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: "表示名" });
    await userEvent.click(canvas.getByText("表示名"));
    await expect(input).toHaveFocus();
  },
};

/** 必須の欄。見た目は「*」、読み上げでは「必須」と読まれる。 */
export const Required: Story = {
  name: "必須",
  args: { required: true },
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: /必須/ });
    await expect(input).toHaveAccessibleName("表示名 必須");
    await userEvent.click(canvas.getByText("表示名"));
    await expect(input).toHaveFocus();
  },
};

/** 押せない欄の名前。薄く表示する。 */
export const Disabled: Story = {
  name: "押せない欄の名前",
  args: { disabled: true },
  render: (args) => (
    <div className="flex flex-col gap-1">
      <Label {...args} />
      <input id="field" type="text" disabled className="rounded-md border border-border-strong bg-bg px-2.5 py-1.5 text-base text-fg" />
    </div>
  ),
  play: async ({ canvas }) => {
    const label = canvas.getByText("表示名");
    await expect(label).toHaveAttribute("data-disabled");
    await expect(canvas.getByRole("textbox", { name: "表示名" })).toBeDisabled();
  },
};

/** 暗い表示。文字と背景のコントラストを axe で確かめるために置く。 */
export const Dark: Story = {
  name: "暗い表示",
  globals: { theme: "dark" },
  args: { required: true },
};
