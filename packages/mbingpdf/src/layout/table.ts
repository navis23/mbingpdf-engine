/** Table layout: column sizing, rows that stay whole, and headers repeated on every page. */
import type { Color } from "../core/index.ts";
import type { TextAlign } from "../text/index.ts";
import {
  type Area,
  type Box,
  type LayoutResult,
  type LayoutSink,
  layout,
  measure,
  normalize,
  RETRY,
} from "./engine.ts";
import { inherit, type TextContext, toColor, toPoints, toSides } from "./style.ts";
import type {
  BorderSide,
  CellProps,
  Child,
  LayoutNode,
  TableBorders,
  TableColumn,
  TableProps,
  TableRowInput,
  TableRowProps,
  TableSectionStyle,
} from "./types.ts";

interface Line {
  width: number;
  color: Color;
}

interface CellModel {
  node: LayoutNode;
  context: TextContext;
  column: number;
  span: number;
  verticalAlign: "top" | "middle" | "bottom";
}

interface RowModel {
  cells: CellModel[];
  background: Color | undefined;
  minHeight: number;
  keepWithNext: boolean;
}

interface TableModel {
  columns: TableColumn[];
  header: RowModel[];
  body: RowModel[];
  footer: RowModel[];
  lines: {
    outer: Line | undefined;
    horizontal: Line | undefined;
    vertical: Line | undefined;
    header: Line | undefined;
    footer: Line | undefined;
  };
}

const models: WeakMap<LayoutNode, Map<TextContext, TableModel>> = new WeakMap();

function textAlignOf(align: TextAlign | "start" | "end" | undefined): TextAlign | undefined {
  if (align === "start") return "left";
  if (align === "end") return "right";
  return align;
}

function rowsOf(input: TableRowInput | readonly TableRowInput[] | undefined): TableRowInput[] {
  if (input === undefined) return [];
  // One row is an array of cells or a TableRow; several rows are an array of those.
  if (!Array.isArray(input)) return [input as TableRowInput];
  const list = input as readonly unknown[];
  const isRow = (value: unknown): boolean =>
    Array.isArray(value) ||
    (typeof value === "object" && value !== null && (value as LayoutNode).type === "TableRow");
  return list.length > 0 && list.every(isRow)
    ? (list as TableRowInput[])
    : [input as TableRowInput];
}

function buildModel(node: LayoutNode<"Table">, context: TextContext): TableModel {
  const props = node.props as TableProps;
  const own = inherit(context, props);
  const columns: TableColumn[] =
    typeof props.columns === "number"
      ? Array.from({ length: props.columns }, () => ({}))
      : props.columns.map((column) => (typeof column === "object" ? column : { width: column }));
  if (columns.length === 0) throw new RangeError("A table needs at least one column");
  const padding = props.cellPadding ?? [4, 6];

  const line = (side: BorderSide | undefined): Line | undefined =>
    side && side.width > 0
      ? { width: side.width, color: side.color === undefined ? own.color : toColor(side.color) }
      : undefined;
  const hairline: BorderSide = { width: 0.5, color: "#D1D5DB" };
  const borders: TableBorders =
    props.borders === "none"
      ? {}
      : props.borders === "grid"
        ? { outer: hairline, horizontal: hairline, vertical: hairline }
        : props.borders === undefined || props.borders === "rows"
          ? { horizontal: hairline }
          : props.borders;

  const build = (
    inputs: TableRowInput[],
    style: TableSectionStyle | undefined,
    zebra: boolean,
  ): RowModel[] =>
    inputs.map((input, index) => {
      const rowProps: TableRowProps = Array.isArray(input)
        ? {}
        : ((input as LayoutNode<"TableRow">).props as TableRowProps);
      const children: readonly Child[] = Array.isArray(input)
        ? (input as readonly Child[])
        : (input as LayoutNode).children;
      const sectionContext = style ? inherit(own, style) : own;
      const cells: CellModel[] = [];
      let column = 0;
      for (const child of children) {
        if (column >= columns.length) break;
        const isCell =
          typeof child === "object" &&
          child !== null &&
          !Array.isArray(child) &&
          (child as LayoutNode).type === "Cell";
        const cellProps: CellProps = isCell
          ? ((child as LayoutNode<"Cell">).props as CellProps)
          : {};
        const span = Math.max(1, Math.min(cellProps.colSpan ?? 1, columns.length - column));
        const columnProps = columns[column] as TableColumn;
        const { width: _width, align: columnAlign, ...columnText } = columnProps;
        // A cell that spans several columns belongs to none of them in particular.
        const single = span === 1;
        let cellContext = inherit(
          single ? inherit(sectionContext, columnText) : sectionContext,
          rowProps,
        );
        const align = textAlignOf(cellProps.align ?? (single ? columnAlign : undefined));
        if (align) cellContext = { ...cellContext, textAlign: align };
        const { colSpan: _span, align: _align, verticalAlign, ...boxProps } = cellProps;
        cells.push({
          node: {
            type: "Stack",
            props: { padding, ...boxProps },
            children: isCell ? (child as LayoutNode).children : [child],
          },
          context: cellContext,
          column,
          span,
          verticalAlign: verticalAlign ?? "top",
        });
        column += span;
      }
      let background = rowProps.background ?? style?.background;
      if (background === undefined && zebra && props.zebra !== undefined && index % 2 === 1)
        background = props.zebra;
      return {
        cells,
        background: background === undefined ? undefined : toColor(background),
        minHeight: rowProps.height ?? 0,
        keepWithNext: rowProps.keepWithNext === true,
      };
    });

  return {
    columns,
    header: build(rowsOf(props.header), props.headerStyle, false),
    body: build([...props.rows], undefined, true),
    footer: build(rowsOf(props.footer), props.footerStyle, false),
    lines: {
      outer: line(borders.outer),
      horizontal: line(borders.horizontal),
      vertical: line(borders.vertical),
      header: line(borders.header ?? borders.horizontal),
      footer: line(borders.footer ?? borders.horizontal),
    },
  };
}

function modelOf(node: LayoutNode<"Table">, context: TextContext): TableModel {
  let byContext = models.get(node);
  if (!byContext) {
    byContext = new Map();
    models.set(node, byContext);
  }
  let model = byContext.get(context);
  if (!model) {
    model = buildModel(node, context);
    byContext.set(context, model);
  }
  return model;
}

/** The narrowest and natural width of each column, from the cells that cover only that column. */
function columnContent(model: TableModel): { min: number[]; max: number[] } {
  const min = model.columns.map(() => 0);
  const max = model.columns.map(() => 0);
  for (const row of [...model.header, ...model.body, ...model.footer]) {
    for (const cell of row.cells) {
      if (cell.span !== 1) continue;
      const size = measure(cell.node, cell.context);
      min[cell.column] = Math.max(min[cell.column] as number, size.min);
      max[cell.column] = Math.max(max[cell.column] as number, size.max);
    }
  }
  return { min, max };
}

/** Works out the width of every column for a table that may be `available` wide. */
function columnWidths(model: TableModel, available: number): number[] {
  const count = model.columns.length;
  const between = (model.lines.vertical?.width ?? 0) * (count - 1);
  const room = Math.max(0, available - between);
  const widths = new Array<number>(count).fill(0);
  const content = columnContent(model);
  const shares = new Array<number>(count).fill(0);
  const auto: number[] = [];
  let used = 0;
  model.columns.forEach((column, i) => {
    const width = column.width ?? "1fr";
    if (typeof width === "number") widths[i] = width;
    else if (width === "auto") auto.push(i);
    else if (width.endsWith("fr")) shares[i] = Number.parseFloat(width) || 1;
    else widths[i] = toPoints(width as `${number}%`, room) ?? 0;
    used += widths[i] as number;
  });
  const totalShares = shares.reduce((sum, share) => sum + share, 0);

  // Auto columns get their natural width if there is room, otherwise they are squeezed
  // towards their narrowest in proportion to how much each can give.
  let left = room - used;
  if (totalShares > 0)
    left -= shares.reduce((sum, share, i) => sum + (share > 0 ? (content.min[i] as number) : 0), 0);
  const wanted = auto.reduce((sum, i) => sum + (content.max[i] as number), 0);
  const least = auto.reduce((sum, i) => sum + (content.min[i] as number), 0);
  for (const i of auto) {
    const min = content.min[i] as number;
    const max = content.max[i] as number;
    if (wanted <= left) widths[i] = max;
    else if (wanted > least)
      widths[i] = min + ((max - min) * Math.max(0, left - least)) / (wanted - least);
    else widths[i] = min;
    used += widths[i] as number;
  }

  const spare = room - used;
  if (totalShares > 0) {
    for (let i = 0; i < count; i++) {
      if ((shares[i] as number) > 0)
        widths[i] = Math.max(0, (spare * (shares[i] as number)) / totalShares);
    }
  } else if (spare > 0 && auto.length > 0 && wanted > 0) {
    // No flexible column: the auto columns share what is left, in proportion to their content.
    for (const i of auto)
      widths[i] = (widths[i] as number) + (spare * (content.max[i] as number)) / wanted;
  }
  return widths;
}

/** The narrowest and natural width of a table. */
export function measureTable(
  node: LayoutNode<"Table">,
  context: TextContext,
): { min: number; max: number } {
  const model = modelOf(node, context);
  const content = columnContent(model);
  const lines =
    (model.lines.vertical?.width ?? 0) * (model.columns.length - 1) +
    (model.lines.outer?.width ?? 0) * 2;
  let min = lines;
  let max = lines;
  model.columns.forEach((column, i) => {
    const fixed = typeof column.width === "number" ? column.width : undefined;
    min += fixed ?? (content.min[i] as number);
    max += fixed ?? (content.max[i] as number);
  });
  return { min, max };
}

interface TableState {
  widths: number[];
  /** The next body row to place. */
  row: number;
  /** Per-cell continuation of a row that was split because it is taller than a page. */
  cells: unknown[] | undefined;
}

interface PlacedRow {
  box: Box;
  height: number;
  /** Set when the row did not finish: what its cells need to continue. */
  rest: unknown[] | undefined;
}

export function layoutTable(
  node: LayoutNode<"Table">,
  context: TextContext,
  area: Area,
  state: TableState | undefined,
  sink: LayoutSink,
): LayoutResult {
  const props = node.props as TableProps;
  const model = modelOf(node, context);
  const outer = model.lines.outer?.width ?? 0;
  const explicit = toPoints(props.width, area.width);
  const widths = state?.widths ?? columnWidths(model, (explicit ?? area.width) - outer * 2);
  const vertical = model.lines.vertical;
  const tableWidth =
    widths.reduce((sum, width) => sum + width, 0) +
    (vertical?.width ?? 0) * (widths.length - 1) +
    outer * 2;

  /** Left edge of a column inside the table. */
  const columnX = (column: number): number => {
    let x = outer;
    for (let i = 0; i < column; i++) x += (widths[i] as number) + (vertical?.width ?? 0);
    return x;
  };
  const spanWidth = (cell: CellModel): number => {
    let width = 0;
    for (let i = cell.column; i < cell.column + cell.span; i++) width += widths[i] as number;
    return width + (vertical?.width ?? 0) * (cell.span - 1);
  };

  /** Lays out one row in at most `height`. `split` allows it to be cut if it does not fit. */
  const layoutRow = (
    row: RowModel,
    height: number,
    split: boolean,
    resume: unknown[] | undefined,
    header = false,
  ): PlacedRow | undefined => {
    const results = row.cells.map((cell, i) => {
      if (resume && resume[i] === undefined) return undefined;
      return layout(
        cell.node,
        cell.context,
        { width: spanWidth(cell), height: split ? height : Number.POSITIVE_INFINITY, fresh: true },
        resume?.[i],
        sink,
      );
    });
    let rowHeight = resume ? 0 : row.minHeight;
    for (const result of results)
      if (result?.box) rowHeight = Math.max(rowHeight, result.box.height);
    const unfinished = results.some((result) => result?.state !== undefined);
    if (!split && rowHeight > height + 1e-6) return undefined;
    if (unfinished) rowHeight = Math.max(rowHeight, height);

    const box: Box = {
      x: outer,
      y: 0,
      width: tableWidth - outer * 2,
      height: rowHeight,
      children: [],
    };
    if (row.background) box.background = row.background;
    if (sink.tagged) {
      box.tags = [{ role: "TR", key: row, ...(resume ? { continued: true } : {}) }];
    }
    row.cells.forEach((cell, i) => {
      const cellBox = results[i]?.box;
      if (!cellBox) return;
      if (sink.tagged) {
        cellBox.tags = [
          {
            role: header ? "TH" : "TD",
            key: cell,
            ...(resume?.[i] !== undefined ? { continued: true } : {}),
            ...(header ? { scope: "Column" as const } : {}),
            ...(cell.span > 1 ? { colSpan: cell.span } : {}),
          },
          ...(cellBox.tags ?? []),
        ];
      }
      // The cell fills the row; its content moves down inside it for middle and bottom.
      const slack = rowHeight - cellBox.height;
      const shift =
        cell.verticalAlign === "middle" ? slack / 2 : cell.verticalAlign === "bottom" ? slack : 0;
      if (shift > 0) {
        for (const child of cellBox.children) child.y += shift;
        if (cellBox.text) cellBox.text.y += shift;
      }
      cellBox.x = columnX(cell.column) - outer;
      cellBox.y = 0;
      cellBox.height = rowHeight;
      box.children.push(cellBox);
    });
    if (vertical) {
      // Lines between columns, except through cells that span them.
      for (const cell of row.cells) {
        if (cell.column === 0) continue;
        box.children.push({
          x: columnX(cell.column) - outer - vertical.width,
          y: 0,
          width: vertical.width,
          height: rowHeight,
          children: [],
          background: vertical.color,
        });
      }
    }
    return {
      box,
      height: rowHeight,
      rest: unfinished ? results.map((result) => result?.state) : undefined,
    };
  };

  const first = state === undefined;
  const table: Box = { x: 0, y: 0, width: tableWidth, height: 0, children: [] };
  let y = first ? outer : 0;
  const rule = (line: Line | undefined): void => {
    if (!line) return;
    table.children.push({
      x: outer,
      y,
      width: tableWidth - outer * 2,
      height: line.width,
      children: [],
      background: line.color,
    });
    y += line.width;
  };
  const place = (placed: PlacedRow): void => {
    placed.box.y = y;
    table.children.push(placed.box);
    y += placed.height;
  };

  // Header and footer rows are laid out first: they never split, and their height decides
  // how much room the body has.
  const withHeader = model.header.length > 0 && (first || props.repeatHeader !== false);
  const headerRows = withHeader
    ? model.header.map(
        (row) => layoutRow(row, Number.POSITIVE_INFINITY, false, undefined, true) as PlacedRow,
      )
    : [];
  // A header repeated on a later page is there for the eye; the table has it once.
  if (!first) for (const row of headerRows) row.box.tags &&= [{ role: "Artifact" }];
  const footerRows = model.footer.map(
    (row) => layoutRow(row, Number.POSITIVE_INFINITY, false, undefined) as PlacedRow,
  );
  const lineWidth = model.lines.horizontal?.width ?? 0;
  const headerHeight =
    headerRows.reduce((sum, row) => sum + row.height, 0) +
    lineWidth * Math.max(0, headerRows.length - 1) +
    (headerRows.length > 0 ? (model.lines.header?.width ?? 0) : 0);
  const footerHeight =
    footerRows.reduce((sum, row) => sum + row.height, 0) +
    lineWidth * Math.max(0, footerRows.length - 1) +
    (footerRows.length > 0 ? (model.lines.footer?.width ?? 0) : 0);
  const repeatFooter = props.repeatFooter === true && footerRows.length > 0;

  headerRows.forEach((row, i) => {
    if (i > 0) rule(model.lines.horizontal);
    place(row);
  });
  if (headerRows.length > 0) rule(model.lines.header);

  const bottom = area.height - outer;
  const bodyStart = y;
  const placedRows: { index: number; y: number; children: number }[] = [];
  let index = state?.row ?? 0;
  let cells = state?.cells;
  let next: TableState | undefined;
  while (index < model.body.length) {
    const row = model.body[index] as RowModel;
    const lineBefore = placedRows.length > 0 ? lineWidth : 0;
    // Hold back room for the footer if it repeats, or if this could be the last row.
    const reserve = repeatFooter || index === model.body.length - 1 ? footerHeight : 0;
    const room = bottom - y - lineBefore - reserve;
    const alone = placedRows.length === 0 && area.fresh;
    let placed = layoutRow(row, room, cells !== undefined, cells);
    if (!placed && alone) {
      // Taller than a whole page: nothing for it but to cut the row.
      placed = layoutRow(row, Math.max(room, 1), true, undefined);
    }
    if (!placed) {
      next = { widths, row: index, cells: undefined };
      // A row marked keepWithNext must not be the last on the page.
      while (placedRows.length > 1) {
        const last = placedRows.at(-1) as (typeof placedRows)[number];
        if (!(model.body[last.index] as RowModel).keepWithNext) break;
        placedRows.pop();
        table.children.length = last.children;
        y = last.y;
        next = { widths, row: last.index, cells: undefined };
      }
      break;
    }
    const before = { index, y, children: table.children.length };
    if (placedRows.length > 0) rule(model.lines.horizontal);
    place(placed);
    placedRows.push(before);
    if (placed.rest) {
      next = { widths, row: index, cells: placed.rest };
      break;
    }
    cells = undefined;
    index++;
  }

  const finished = next === undefined;
  // A header with nothing under it is worse than starting the table on the next page.
  if (!finished && placedRows.length === 0 && !area.fresh) return { state: state ?? RETRY };
  void bodyStart;

  if (finished || repeatFooter) {
    if (
      finished &&
      bottom - y < footerHeight - 1e-6 &&
      footerRows.length > 0 &&
      !(placedRows.length === 0 && area.fresh)
    ) {
      // The rows are done but the footer does not fit: it goes on the next page.
      next = { widths, row: model.body.length, cells: undefined };
    } else if (footerRows.length > 0) {
      // Likewise a footer repeated before the table's end.
      if (!finished) for (const row of footerRows) row.box.tags &&= [{ role: "Artifact" }];
      rule(model.lines.footer);
      footerRows.forEach((row, i) => {
        if (i > 0) rule(model.lines.horizontal);
        place(row);
      });
    }
  }

  const done = next === undefined;
  table.height = y + (done ? outer : 0);
  if (model.lines.outer) {
    const side = model.lines.outer;
    table.border = {
      left: side,
      right: side,
      ...(first ? { top: side } : {}),
      ...(done ? { bottom: side } : {}),
    };
  }
  if (props.background !== undefined) table.background = toColor(props.background);
  if (props.opacity !== undefined && props.opacity < 1) table.opacity = props.opacity;
  void toSides;
  return done ? { box: table } : { box: table, state: next };
}
