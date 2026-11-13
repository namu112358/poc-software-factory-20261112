import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";

import { Input } from "./input";

/**
 * Input は 1 行の入力欄。名前は Label で付ける。
 * 欄の `id` は Story ごとに自動で別の値になる（Docs のページで並んでも、名前を押すと同じ Story の欄にフォーカスが移る）。
 * axe（アクセシビリティの検査）は、すべての Story に自動でかかる（.storybook/preview.tsx）。
 */
const meta = {
  title: "部品/Input",
  component: Input,
  args: {
    label: "表示名",
  },
  argTypes: {
    disabled: { control: "boolean" },
    required: { control: "boolean" },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ふつうの入力欄。Tab でフォーカスが入り、文字を入れられる。 */
export const Default: Story = {
  name: "ふつう",
  play: async ({ canvas }) => {
    await userEvent.tab();
    const input = canvas.getByRole("textbox", { name: "表示名" });
    await expect(input).toHaveFocus();
    await userEvent.type(input, "見本の入力");
    await expect(input).toHaveValue("見本の入力");
  },
};

/** 補足つき。補足は欄の説明として読み上げられる。 */
export const WithDescription: Story = {
  name: "補足つき",
  args: { description: "一覧に表示される名前です。" },
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: "表示名" });
    await expect(input).toHaveAccessibleDescription("一覧に表示される名前です。");
  },
};

/** 誤りのある欄。赤い枠になり、誤りの文言が欄の説明として読み上げられる。 */
export const Invalid: Story = {
  name: "誤り",
  args: { defaultValue: "", error: "表示名を入力してください。" },
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: "表示名" });
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription("表示名を入力してください。");
  },
};

/** 押せない欄。入力できない。 */
export const Disabled: Story = {
  name: "押せない",
  args: { disabled: true },
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: "表示名" });
    await expect(input).toBeDisabled();
    await userEvent.type(input, "入力できない");
    await expect(input).toHaveValue("");
  },
};

/** 暗い表示。文字と背景のコントラストを axe で確かめるために置く。補足と誤りの両方を出す。 */
export const Dark: Story = {
  name: "暗い表示",
  globals: { theme: "dark" },
  args: { description: "一覧に表示される名前です。", error: "表示名を入力してください。" },
};
