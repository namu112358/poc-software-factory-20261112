import type { Decorator, Preview } from "@storybook/react-vite";

import "../src/styles/globals.css";

/**
 * ツールバーの「表示」で、明るい・暗い・OS に合わせる、を切り替える。
 * Story ごとの枠に data-theme を付ける（Docs のページで、1 つの Story の表示がほかの Story に移らないように）。
 */
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme as string | undefined;
  return (
    <div
      data-theme={theme === "light" || theme === "dark" ? theme : undefined}
      className="bg-bg p-4 font-sans text-base text-fg"
    >
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: "表示",
      toolbar: {
        title: "表示",
        icon: "mirror",
        items: [
          { value: "light", title: "明るい" },
          { value: "dark", title: "暗い" },
          { value: "system", title: "OS に合わせる" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "light",
  },
  parameters: {
    layout: "padded",
    controls: { expanded: true },
    backgrounds: { disable: true },
    a11y: {
      // axe の違反があれば、Storybook のテスト（Vitest）を落とす。
      test: "error",
    },
  },
  tags: ["autodocs"],
};

export default preview;
