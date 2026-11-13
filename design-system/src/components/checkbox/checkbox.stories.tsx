import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";

import { Label } from "../label/label";
import { Checkbox } from "./checkbox";

/**
 * 名前は Label で付ける。箱の `id` は Story ごとに `useId` で変えるので、
 * Docs のページに Story が並んでも、名前を押すと同じ Story の箱が切り替わる。
 * axe（アクセシビリティの検査）は、すべての Story に自動でかかる（.storybook/preview.tsx）。
 */
function Field({ name, ...props }: React.ComponentProps<typeof Checkbox> & { name: string }) {
  const id = React.useId();
  return (
    <div className="flex min-h-6 items-center gap-1.5">
      <Checkbox id={id} {...props} />
      <Label htmlFor={id} disabled={props.disabled} className="min-h-6">
        {name}
      </Label>
    </div>
  );
}

const meta = {
  title: "部品/Checkbox",
  component: Checkbox,
  args: { defaultChecked: false },
  argTypes: {
    disabled: { control: "boolean" },
  },
  render: (args) => <Field name="通知を受け取る" {...args} />,
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** オフ。箱・名前・Space キーのどれでもオンになる。 */
export const Off: Story = {
  name: "オフ",
  play: async ({ canvas }) => {
    const box = canvas.getByRole("checkbox", { name: "通知を受け取る" });
    await expect(box).not.toBeChecked();
    await userEvent.click(canvas.getByText("通知を受け取る"));
    await expect(box).toBeChecked();
    await userEvent.click(canvas.getByText("通知を受け取る"));
    await expect(box).not.toBeChecked();
    await userEvent.click(box);
    await expect(box).toBeChecked();
    await userEvent.click(box);
    await expect(box).not.toBeChecked();
    box.focus();
    await userEvent.keyboard(" ");
    await expect(box).toBeChecked();
    await userEvent.keyboard(" ");
    await expect(box).not.toBeChecked();
  },
};

/** オン。 */
export const On: Story = {
  name: "オン",
  args: { defaultChecked: true },
  play: async ({ canvas }) => {
    const box = canvas.getByRole("checkbox", { name: "通知を受け取る" });
    await expect(box).toBeChecked();
    await userEvent.click(canvas.getByText("通知を受け取る"));
    await expect(box).not.toBeChecked();
  },
};

/** 一部だけ選ばれている状態。見た目は横線、読み上げは「一部」（aria-checked="mixed"）。 */
export const Mixed: Story = {
  name: "一部だけ",
  args: { checked: "indeterminate" },
  render: (args) => <Field name="すべての項目を選ぶ" {...args} />,
  play: async ({ canvas }) => {
    const box = canvas.getByRole("checkbox", { name: "すべての項目を選ぶ" });
    await expect(box).toHaveAttribute("aria-checked", "mixed");
  },
};

/** 押せない状態。クリックしても Space キーでも切り替わらない。 */
export const Disabled: Story = {
  name: "押せない",
  args: { disabled: true },
  play: async ({ canvas }) => {
    const box = canvas.getByRole("checkbox", { name: "通知を受け取る" });
    await expect(box).toBeDisabled();
    await userEvent.click(canvas.getByText("通知を受け取る"));
    await expect(box).not.toBeChecked();
    await userEvent.click(box);
    await expect(box).not.toBeChecked();
    box.focus();
    await userEvent.keyboard(" ");
    await expect(box).not.toBeChecked();
  },
};

/** 暗い表示。オンの状態で、文字と背景のコントラストを axe で確かめる。 */
export const Dark: Story = {
  name: "暗い表示",
  globals: { theme: "dark" },
  args: { defaultChecked: true },
};
