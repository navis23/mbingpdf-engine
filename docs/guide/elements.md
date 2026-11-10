# Element reference

Every element is called as `Element(properties?, ...children)`. Properties are optional unless marked **required**. Sizes are in points; `mm()`, `cm()` and `inch()` convert.

## Properties shared by most elements

### Box

| Property | Value | Meaning |
| --- | --- | --- |
| `margin`, `padding` | number, `[vertical, horizontal]`, `[top, right, bottom, left]`, or `{ top, right, bottom, left }` | Space outside and inside the border |
| `border` | `{ width, color }`, or `{ top, right, bottom, left }` of those | Lines around the box |
| `background` | colour | Fill behind the content |
| `radius` | number | Rounded corners |
| `width`, `height`, `minWidth`, `maxWidth`, `minHeight` | number or `"50%"` | Size; by default an element is as wide as its container and as tall as its content |
| `opacity` | 0–1 | Transparency of the element and everything in it |
| `id` | string | A name that `Link({ to })` can point to |

### In a tagged PDF

These say what an element is, for `render(document, { tagged: true })` and the standards built on it. They change nothing that is seen.

| Property | Meaning |
| --- | --- |
| `alt` | A description that stands in for a picture. `Image`, `Svg` and `Canvas` are left out of the structure without one (with a warning); a `QrCode` is described by its value unless you say otherwise |
| `decorative` | The element and everything in it is decoration and is skipped by screen readers. `alt: ""` does the same |
| `role` | What the element is, when it is not what it looks like: on a `Text`, `"Caption"`, `"BlockQuote"` or `"Note"` instead of a paragraph; on a `Stack` or `Box`, a grouping such as `"Sect"`, `"Div"` or `"Figure"` |

### In a `Row`

| Property | Meaning |
| --- | --- |
| `grow` | Share of the spare width this element takes |
| `shrink` | How readily it gives up width when space is short (default 1; 0 never shrinks) |
| `basis` | The width to start from before growing or shrinking |
| `alignSelf` | Overrides the row's `align` for this element |

### Page breaks

| Property | Meaning |
| --- | --- |
| `break` | `"before"`, `"after"` or `"avoid"` |
| `keepTogether` | Move the element to the next page rather than split it |
| `keepWithNext` | Keep it on the same page as the start of the next element |

### Text

Set on any element; inherited by everything inside it.

| Property | Value |
| --- | --- |
| `font` | a font, a list of fonts to fall back through, or a theme font name |
| `weight`, `italic` | with a theme font family: 100–900, and true for italic |
| `size` | font size |
| `color` | `"#RRGGBB"`, `rgb()`, `cmyk()`, `gray()`, `spot()`, or a theme colour name |
| `lineHeight` | distance between baselines as a multiple of the size |
| `letterSpacing`, `wordSpacing` | extra space in points |
| `textAlign` | `"left"`, `"center"`, `"right"`, `"justify"` |
| `transform` | `"uppercase"`, `"lowercase"`, `"capitalize"` |
| `features` | OpenType features: `{ tnum: true, liga: false }` |
| `hyphenate` | `hyphenateEnglish`, `hyphenateIndonesian`, or a function of your own |
| `underline`, `strikethrough` | true or false |
| `orphans`, `widows` | fewest lines left at the bottom or carried to the top of a page (default 2) |
| `style` | a text style from the theme |

## Structure

| Element | Notes |
| --- | --- |
| `Document(props, ...pages)` | `title`, `author`, `subject`, `keywords`, `creator`, `lang`, `theme`, `attachments` (files carried inside the PDF: `{ name, data, mimeType, description, relationship }`), `metadata`, and text properties as defaults. Children that are not pages are put on a default A4 page |
| `Page(props, ...children)` | `size` (`"A4"`, `"A5"`, `"Letter"`, … or `[width, height]`), `orientation`, `margin` (default 20 mm), `gap`, `header`, `footer`, `background`, `fill`, `bleed`, `marks`, `fontSize` |
| `PageBreak()` | Ends the page |

`header`, `footer` and `background` take content, or a function of `{ page, pages }`. The background is laid out across the whole sheet, behind everything.

## Layout

| Element | Notes |
| --- | --- |
| `Stack(props, ...children)` | One below another. `gap`; `align`: `"stretch"` (default), `"start"`, `"center"`, `"end"` |
| `Box(props, ...children)` | The same as `Stack`, for when the point is the padding, border or background |
| `Row(props, ...children)` | Side by side. `gap`; `align` across the height; `justify`: `"start"`, `"center"`, `"end"`, `"space-between"`, `"space-around"` |
| `Spacer(size?)` | A fixed gap, or in a row all the spare width |
| `Columns(props, ...children)` | Newspaper columns. `count` (default 2), `gap`, `rowGap`, `rule`, `balance` |
| `Grid(props, ...children)` | Cells of a fixed size. `columns` **required**, `cell: { width?, height }` **required**, `gap`, `rows` |
| `Absolute(props, ...children)` | Out of the flow. `top`, `right`, `bottom`, `left`, `rotate` (degrees), `anchor`: `"parent"` or `"page"` |

## Text

| Element | Notes |
| --- | --- |
| `Text(props, ...content)` | A paragraph of strings, `Span`s and `Link`s. `align`; `fit`: true or `{ min, max }` keeps it on one line and sizes it to the width |
| `Span(props, ...content)` | A stretch of text with its own style |
| `Link({ href }, ...)` / `Link({ to }, ...)` | A link to a web address, or to the element with that `id` |
| `Heading({ level }, ...)` | Levels 1–6. Sized by level (or by the theme's `h1`–`h6`), kept with what follows, bookmarked. `bookmark: false` to leave it out, or a string for a shorter title |
| `List(props, ...items)` | `marker`: `"disc"`, `"dash"`, `"decimal"`, `"lower-alpha"`, `"upper-alpha"`, `"lower-roman"`, `"upper-roman"`, any string, or a function of the number. `start`, `gap`, `splitItems` |
| `TableOfContents(props?)` | `levels` (default `[1, 3]`), `indent`, `gap`, `leaders` |

## Tables

`Table(props)`:

| Property | Meaning |
| --- | --- |
| `columns` **required** | A count, or a list of `{ width, align, ...text }`. Width: points, `"30%"`, `"1fr"` (default), or `"auto"` |
| `rows` **required** | A list of rows; a row is a list of cells |
| `header`, `footer` | One row or several |
| `repeatHeader` | Repeat the header on every page (default true) |
| `repeatFooter` | Repeat the footer on every page (default false) |
| `cellPadding` | Default `[4, 6]` |
| `borders` | `"rows"` (default), `"grid"`, `"none"`, or `{ outer, horizontal, vertical, header, footer }` |
| `zebra` | Background of every second row |
| `headerStyle`, `footerStyle` | Text properties and `background` |

A cell is any child. `Cell({ colSpan, align, verticalAlign, ...box }, ...)` is for cells that need properties, `TableRow({ background, height, keepWithNext, ...text }, ...cells)` for rows that do.

## Media

| Element | Notes |
| --- | --- |
| `Image({ src })` | JPEG or PNG bytes. `width`, `height`; `fit`: `"contain"` (default), `"cover"`, `"fill"` |
| `Svg({ src })` | SVG markup or bytes, drawn as vectors. Paths, shapes, groups, transforms, solid fills and strokes, opacity. No gradients, text, clipping or masks. The same artwork used many times (a logo on every page) is stored once in the file |
| `QrCode({ value })` | `size` (default 72), `level`: `"L"`, `"M"`, `"Q"`, `"H"`; `quiet` (default 4 modules); `color` |
| `Barcode({ value })` | `type`: `"code128"` (default; any ASCII text), `"ean13"`, `"ean8"`, `"upca"`, `"code39"`, `"itf"`, `"itf14"`. `moduleWidth` (narrowest bar, default 1), `barHeight` (default 36), `showText` (default true), `textSize`, `quiet` (margin in modules, default 10), `color`. Check digits are added when left out and refused when wrong |
| `Canvas({ width, height, draw })` | `draw(g, { width, height })` with `g.rect`, `roundedRect`, `circle`, `ellipse`, `line`, `moveTo`, `lineTo`, `curveTo`, `closePath`, then `fill(color)`, `stroke({ color, width, dash, cap, join })` or `fillAndStroke(color, stroke)`. Text: `g.text(text, x, y, { size, color, font, align, baseline, rotate })` draws one line; `g.measureText(text, { size, font })` gives its width |

## Charts

Each chart is a `Canvas` that draws itself, and takes the box properties of any element.

| Element | Notes |
| --- | --- |
| `BarChart({ labels, values })` | Or `series: [{ name, values, color }]` for several sets of bars. `stacked`, `horizontal` |
| `LineChart({ labels, values })` | Or `series`. `area`, `smooth`, `points` (default true). A `null` value leaves a gap |
| `PieChart({ data })` | `data: [{ label, value, color }]`. `donut` (true, or the hole's share of the radius), `valueLabels`: `"percent"` (default), `"value"` or `false` |

Shared: `width` (default `"100%"`), `height` (default 180), `title`, `colors` (the palette; the default stays distinct for colour-blind readers), `legend`, `labelSize` (default 8), `format` (how a value is written). Bar and line charts also take `min`, `max`, `grid` and `valueLabels`. The value axis starts at zero unless the data goes below it or `min` says otherwise. In a tagged PDF a chart is a figure described by its `title`; give it an `alt` that says what the chart shows.

## Rendering

| Function | Returns |
| --- | --- |
| `render(document, options?)` | `Promise<Uint8Array>` |
| `render.sync(document, options?)` | `Uint8Array` |
| `render.stream(document, options?)` | `ReadableStream<Uint8Array>` |
| `renderSvg(document)` from `mbingpdf/svg` | `string[]`, one SVG per page |
| `inspect(document)` | every box on every page, as plain data |

Options: `deterministic`, `compress`, `onWarning`, `strict`, `debug`, `minImageDpi`, `tagged`, `conformance`, `outputIntent: { profile, identifier }`, `encryption: { userPassword, ownerPassword, permissions }`.

`permissions` (all allowed unless set to `false`): `print` (or `"low"` for a degraded print only), `modify`, `copy`, `annotate`, `fillForms`, `assemble`.

### Standards

`conformance` takes one standard or a list, such as `["PDF/A-2a", "PDF/UA-1"]`. The file is checked as it is written, and what cannot be met is an error.

| Standard | For | Needs |
| --- | --- | --- |
| `"PDF/X-4"` | Commercial printing | An `outputIntent`; every font embedded |
| `"PDF/A-2b"`, `"PDF/A-2u"` | Archiving | Every font embedded. Colours are declared as sRGB unless an `outputIntent` says otherwise; CMYK and spot colours need a CMYK one |
| `"PDF/A-2a"` | Archiving, with structure | The same, and the file is tagged |
| `"PDF/A-3b"`, `"PDF/A-3u"`, `"PDF/A-3a"` | As PDF/A-2, for files that carry attachments | The same |
| `"PDF/UA-1"` | Accessibility | A `title` and a `lang` on the `Document`; every font embedded; the file is tagged |

### A tagged PDF

With `tagged: true` the file carries the document's structure and reading order, which screen readers and reflowing viewers work from. It comes from the elements:

| Element | In the structure |
| --- | --- |
| `Text` | A paragraph (`P`) |
| `Heading` | `H1` to `H6`, by its `level` |
| `Link` | A `Link`, with the address as its description |
| `List` | A list (`L`) of items (`LI`), each a label (`Lbl`) and a body (`LBody`) |
| `Table` | A `Table` of rows (`TR`) of header cells (`TH`, for the `header` rows) and data cells (`TD`). A header repeated on later pages counts once |
| `TableOfContents` | A `TOC` of entries (`TOCI`) |
| `Image`, `Svg`, `QrCode`, `Canvas` | A `Figure` with its `alt` |
| `Stack`, `Row`, `Box`, `Grid`, `Columns` | Nothing, unless given a `role`; their children are read in the order they are written |
| Page `header`, `footer`, `background`, `fill`; borders, backgrounds, rules | Artifacts: drawn, but not part of the text |

An element that runs over several pages is one element. Words hyphenated at a line end are read with their hyphen.
