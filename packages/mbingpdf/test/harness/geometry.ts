/** Helpers for tests that check where things are drawn. */
import type { DisplayItem } from "../../src/index.ts";

export type PathItem = Extract<DisplayItem, { type: "path" }>;
export type TextItem = Extract<DisplayItem, { type: "text" }>;

/** The box around every point of a path. */
export function pathBounds(item: PathItem): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const command of item.commands) {
    if (command[0] === "R") {
      xs.push(command[1], command[1] + command[3]);
      ys.push(command[2], command[2] + command[4]);
      continue;
    }
    for (let i = 1; i < command.length; i += 2) {
      xs.push(command[i] as number);
      ys.push(command[i + 1] as number);
    }
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
