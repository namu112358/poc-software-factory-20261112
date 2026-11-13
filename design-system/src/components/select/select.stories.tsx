import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";

import { Select } from "./select";

/**
 * Select は、決まった選択肢から 1 つ選ぶ欄。ブラウザ標準の `<select>` を使う。名前は Label で付ける。
 * 欄の `id` は Story ごとに自動で別の値になる（Docs のページで並んでも、名前を押すと同じ Story の欄にフォーカスが移る）。
 * axe（アクセシビリティの検査）は、すべての Story に自動でかかる（.storybook/preview.tsx）。
 */
const meta = {
  title: "部品/Select",
  component: Select,
  args: {
    label: "表示順",
  },
  argTypes: {
    disabled: { control: "boolean" },
    required: { control: "boolean" },
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const options = [
  <option key="new" value="new">
    新しい順
  </option>,
  <option key="old" value="old">
    古い順
  </option>,
  <option key="name" value="name">
    名前順
  </option>,
];

/** ふつうの選択欄。選択肢を選ぶと値が変わる。 */
export const Default: Story = {
  name: "ふつう",
  args: { defaultValue: "new", children: options },
  play: async ({ canvas }) => {
    const select = canvas.getByRole("combobox", { name: "表示順" });
    await expect(select).toHaveValue("new");
    await userEvent.selectOptions(select, "old");
    await expect(select).toHaveValue("old");
  },
};

/** 未選択。はじめは案内の選択肢が出ていて、選ぶと値が入る。 */
export const Placeholder: Story = {
  name: "未選択（はじめの案内）",
  args: {
    defaultValue: "",
    children: [
      <option key="" value="">
        選んでください
      </option>,
      ...options,
    ],
  },
  play: async ({ canvas }) => {
    const select = canvas.getByRole("combobox", { name: "表示順" });
    await expect(select).toHaveValue("");
    await userEvent.selectOptions(select, "name");
    await expect(select).toHaveValue("name");
  },
};

/** 誤りのある欄。赤い枠になり、誤りの文言が欄の説明として読み上げられる。 */
export const Invalid: Story = {
  name: "誤り",
  args: {
    defaultValue: "",
    error: "表示順を選んでください。",
    children: [
      <option key="" value="">
        選んでください
      </option>,
      ...options,
    ],
  },
  play: async ({ canvas }) => {
    const select = canvas.getByRole("combobox", { name: "表示順" });
    await expect(select).toHaveAttribute("aria-invalid", "true");
    await expect(select).toHaveAccessibleDescription("表示順を選んでください。");
  },
};

/** 押せない欄。選べない。 */
export const Disabled: Story = {
  name: "押せない",
  args: { disabled: true, defaultValue: "new", children: options },
  play: async ({ canvas }) => {
    const select = canvas.getByRole("combobox", { name: "表示順" });
    await expect(select).toBeDisabled();
    await userEvent.selectOptions(select, "old");
    await expect(select).toHaveValue("new");
  },
};

/** 暗い表示。選択肢の地と文字がトークンの色で決まっていて、読めることを axe で確かめるために置く。補足と誤りの両方を出す。 */
export const Dark: Story = {
  name: "暗い表示",
  globals: { theme: "dark" },
  args: {
    defaultValue: "",
    description: "一覧の並べ方を決めます。",
    error: "表示順を選んでください。",
    children: [
      <option key="" value="">
        選んでください
      </option>,
      ...options,
    ],
  },
};
