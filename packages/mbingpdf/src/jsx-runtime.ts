/**
 * `mbingpdf/jsx-runtime` — lets documents be written in JSX. It needs no React: set
 * `"jsx": "react-jsx"` and `"jsxImportSource": "mbingpdf"` in tsconfig (or put
 * `/** @jsxImportSource mbingpdf *​/` at the top of a file), and the element functions work as
 * tags:
 *
 * ```tsx
 * <Document title="Invoice">
 *   <Page size="A4">
 *     <Text size={22}>Invoice</Text>
 *   </Page>
 * </Document>
 * ```
 *
 * JSX produces exactly the data the function calls do; the two can be mixed freely.
 */
import type { Child, LayoutNode } from "./layout/types.ts";

/** Anything usable as a tag: an element function, or a function of your own returning elements. */
type Component<P> = (props: P) => LayoutNode | readonly Child[] | null;

/** `<>…</>`: children with no element of their own. */
export function Fragment(props: { children?: Child }): LayoutNode<"Fragment"> {
  return {
    type: "Fragment",
    props: {},
    children: props.children === undefined ? [] : [props.children],
  };
}

/** Called by the compiler for every JSX tag. */
export function jsx<P>(type: Component<P>, props: P): LayoutNode {
  const result = type(props);
  // A component may return a list, or nothing; wrap it so the result is always one node.
  if (result === null || Array.isArray(result)) {
    return { type: "Fragment", props: {}, children: (result ?? []) as Child[] };
  }
  return result as LayoutNode;
}

export const jsxs: typeof jsx = jsx;
export const jsxDEV: typeof jsx = jsx;

// The compiler looks these types up in a namespace called JSX.
// biome-ignore lint/style/noNamespace: required by the TypeScript JSX contract
export namespace JSX {
  export type Element = LayoutNode;
  /** What may be used as a tag: any function from properties to elements, a list, or nothing. */
  // biome-ignore lint/suspicious/noExplicitAny: components take properties of any shape
  export type ElementType = (props: any) => LayoutNode | readonly Child[] | null;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  /** Only function components: there are no lower-case intrinsic tags. */
  // biome-ignore lint/suspicious/noEmptyInterface: an empty set of intrinsic elements
  export interface IntrinsicElements {}
}
