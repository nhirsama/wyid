import type { CSSProperties } from "react";

// 统一 1.5px 圆头描边的小型线条图案。
const motifs = {
  wave: ["0 0 48 16", <path key="p" d="M2 8c4-6 7-6 11 0s7 6 11 0 7-6 11 0 7 6 11 0" />],
  zigzag: ["0 0 30 14", <path key="p" d="M2 11 8 4l7 7 7-7 6 7" />],
  ring: ["0 0 18 18", <circle key="p" cx="9" cy="9" r="6.5" />],
  rings: ["0 0 26 26", <g key="p"><circle cx="13" cy="13" r="10.5" /><circle cx="13" cy="13" r="4.5" /></g>],
  plus: ["0 0 16 16", <path key="p" d="M8 2v12M2 8h12" />],
  triangle: ["0 0 24 22", <path key="p" d="M12 3 21 19H3Z" />],
  diamond: ["0 0 22 22", <path key="p" d="M11 2.5 19.5 11 11 19.5 2.5 11Z" />],
  arc: ["0 0 26 15", <path key="p" d="M3 13a10 10 0 0 1 20 0" />],
  sparkle: ["0 0 24 24", <path key="p" d="M12 3c.8 5 4 8.2 9 9-5 .8-8.2 4-9 9-.8-5-4-8.2-9-9 5-.8 8.2-4 9-9Z" />],
  dots: ["0 0 22 22", <g key="p" fill="currentColor" stroke="none">{[3, 11, 19].flatMap(y => [3, 11, 19].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />))}</g>],
} as const;

type Kind = keyof typeof motifs;
// [图案, 水平位置, 垂直位置(%), 宽度(px), 旋转(deg), 颜色, 额外类]
// 登录页水平位置为相对页面中线的 px；门户为视口宽度的 %。
type Item = [Kind, number, number, number, number, "blue" | "pink", string?];

const auth: Item[] = [
  ["wave", -560, 14, 46, -10, "blue", "outer"],
  ["ring", -385, 22, 16, 0, "pink"],
  ["dots", -620, 41, 22, 0, "blue", "outer"],
  ["plus", -335, 48, 14, 0, "blue"],
  ["triangle", -475, 63, 22, 8, "blue"],
  ["arc", -610, 79, 26, -15, "pink", "outer"],
  ["sparkle", -360, 87, 20, 0, "blue"],
  ["sparkle", 380, 15, 22, 0, "pink"],
  ["diamond", 565, 25, 20, 12, "blue", "outer"],
  ["wave", 350, 39, 40, 14, "blue"],
  ["rings", 615, 51, 26, 0, "blue", "outer"],
  ["zigzag", 440, 67, 28, -8, "pink"],
  ["dots", 575, 86, 22, 0, "blue", "outer"],
  ["plus", 335, 84, 14, 0, "blue"],
];

const authNarrow: Item[] = [
  ["ring", -140, 5, 14, 0, "pink"],
  ["wave", -60, 9, 34, -8, "blue"],
  ["sparkle", 130, 6, 18, 0, "blue"],
  ["plus", -130, 93, 12, 0, "blue"],
  ["zigzag", 40, 96, 24, -6, "pink"],
  ["dots", 140, 92, 18, 0, "blue"],
];

// 门户内容区较宽，只在边缘与留白处点缀少量图案，白色卡片会自然遮住其后的部分。
const portal: Item[] = [
  ["sparkle", 97.5, 9, 18, 0, "pink"],
  ["wave", 93, 4.5, 38, 10, "blue"],
  ["ring", 98, 46, 14, 0, "blue"],
  ["zigzag", 96, 74, 26, -8, "pink"],
  ["dots", 92, 93, 20, 0, "blue"],
  ["plus", 6, 95, 12, 0, "blue", "outer"],
  ["arc", 14, 97, 24, -10, "pink", "outer"],
];

function Motif({ item: [kind, x, y, width, rotate, color, extra], className, mode }: { item: Item; className: string; mode: "center" | "edge" }) {
  const [viewBox, shape] = motifs[kind];
  const style = { "--x": mode === "center" ? `${x}px` : `${x}%`, "--y": `${y}%`, "--w": `${width}px`, "--r": `${rotate}deg` } as CSSProperties;
  return <span className={["motif", color, extra, className].filter(Boolean).join(" ")} style={style}>
    <svg viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{shape}</svg>
  </span>;
}

export function PageBackdrop({ variant = "auth" }: { variant?: "auth" | "portal" }) {
  if (variant === "portal") {
    return <div className="page-backdrop portal-backdrop" aria-hidden="true">
      {portal.map((item, index) => <Motif key={index} item={item} className="motif-edge" mode="edge" />)}
    </div>;
  }
  return <div className="page-backdrop" aria-hidden="true">
    {auth.map((item, index) => <Motif key={index} item={item} className="motif-wide" mode="center" />)}
    {authNarrow.map((item, index) => <Motif key={`n${index}`} item={item} className="motif-narrow" mode="center" />)}
  </div>;
}
