import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Table, TableBody, TableCaption, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "./table";

/**
 * Stories は「意味のある状態」だけを置く。
 * play では、読み上げから見た構造（表の名前・見出し・案内の行）だけを確かめる。
 * axe は、すべての Story に自動でかかる（.storybook/preview.tsx）。
 */
const meta = {
  title: "部品/Table",
  component: Table,
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

const items = [
  { name: "サンプル A", kind: "見本", count: 1280, price: 12000 },
  { name: "サンプル B", kind: "見本", count: 96, price: 450 },
  { name: "サンプル C", kind: "試作", count: 15400, price: 980000 },
];

function Head() {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead>名前</TableHead>
        <TableHead>種別</TableHead>
        <TableHead align="right">件数</TableHead>
        <TableHead align="right">金額（円）</TableHead>
      </TableRow>
    </TableHeader>
  );
}

/** ふつうの表。見出しは小さく弱い色で、行の下に線が入る。 */
export const Default: Story = {
  name: "ふつう",
  render: () => (
    <Table aria-label="見本の一覧">
      <Head />
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.name}>
            <TableCell>{item.name}</TableCell>
            <TableCell>{item.kind}</TableCell>
            <TableCell align="right">{item.count.toLocaleString("ja-JP")}</TableCell>
            <TableCell align="right">{item.price.toLocaleString("ja-JP")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("table", { name: "見本の一覧" })).toBeVisible();
    const headers = canvas.getAllByRole("columnheader");
    await expect(headers).toHaveLength(4);
    for (const header of headers) await expect(header).toHaveAttribute("scope", "col");
  },
};

/** 数字の列は右寄せで、桁がそろう（tabular-nums）。 */
export const Numeric: Story = {
  name: "数字の列",
  render: () => (
    <Table>
      <TableCaption>数字の列の見本</TableCaption>
      <Head />
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.name}>
            <TableCell>{item.name}</TableCell>
            <TableCell>{item.kind}</TableCell>
            <TableCell align="right">{item.count.toLocaleString("ja-JP")}</TableCell>
            <TableCell align="right">{item.price.toLocaleString("ja-JP")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("table", { name: "数字の列の見本" })).toBeVisible();
    for (const cell of [canvas.getByRole("cell", { name: "1,280" }), canvas.getByRole("cell", { name: "12,000" })]) {
      await expect(cell).toHaveClass("tabular-nums");
      await expect(getComputedStyle(cell).textAlign).toBe("right");
    }
    await expect(getComputedStyle(canvas.getByRole("columnheader", { name: "件数" })).textAlign).toBe("right");
    await expect(getComputedStyle(canvas.getByRole("cell", { name: "サンプル A" })).textAlign).not.toBe("right");
  },
};

/** 行が無いときは、空の表ではなく案内を 1 行出す。 */
export const Empty: Story = {
  name: "行が無いとき",
  render: () => (
    <Table aria-label="空の一覧">
      <Head />
      <TableBody>
        <TableEmpty colSpan={4}>該当するものはありません</TableEmpty>
      </TableBody>
    </Table>
  ),
  play: async ({ canvas }) => {
    const table = canvas.getByRole("table", { name: "空の一覧" });
    await expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
    await expect(within(table).getByText("該当するものはありません")).toBeVisible();
    // 見出し行 + 案内の 1 行だけ
    await expect(within(table).getAllByRole("row")).toHaveLength(2);
  },
};

const many = Array.from({ length: 40 }, (_, i) => ({
  name: `サンプル ${i + 1}`,
  count: (i + 1) * 137,
}));

/** 縦に長い表。スクロールしても見出しが上に残る（sticky）。 */
export const Long: Story = {
  name: "長い表（見出しが残る）",
  render: () => (
    <div className="h-64 overflow-auto" role="region" aria-label="長い一覧のスクロール領域" tabIndex={0}>
      <Table aria-label="長い一覧">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>名前</TableHead>
            <TableHead align="right">件数</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {many.map((item) => (
            <TableRow key={item.name}>
              <TableCell>{item.name}</TableCell>
              <TableCell align="right">{item.count.toLocaleString("ja-JP")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
  play: async ({ canvas }) => {
    const table = canvas.getByRole("table", { name: "長い一覧" });
    const header = within(table).getByRole("columnheader", { name: "名前" });
    await expect(getComputedStyle(header).position).toBe("sticky");

    const scroller = table.parentElement as HTMLElement;
    scroller.scrollTop = 400;
    await expect(scroller.scrollTop).toBeGreaterThan(0);
    const top = scroller.getBoundingClientRect().top;
    await expect(header.getBoundingClientRect().top).toBeGreaterThanOrEqual(top - 1);
    await expect(header.getBoundingClientRect().top).toBeLessThanOrEqual(top + 1);
  },
};

/** 暗い表示。文字と背景のコントラストを axe で確かめるために置く。 */
export const Dark: Story = {
  name: "暗い表示",
  globals: { theme: "dark" },
  render: () => (
    <Table aria-label="暗い表示の一覧">
      <Head />
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.name}>
            <TableCell>{item.name}</TableCell>
            <TableCell>{item.kind}</TableCell>
            <TableCell align="right">{item.count.toLocaleString("ja-JP")}</TableCell>
            <TableCell align="right">{item.price.toLocaleString("ja-JP")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("table", { name: "暗い表示の一覧" })).toBeVisible();
  },
};
