/**
 * The colours of code on the site: light type on ink, as on a press operator's screen.
 * A TextMate theme, which is what the highlighter reads.
 */
export const codeTheme = {
  name: "mbing-ink",
  type: "dark" as const,
  colors: {
    "editor.background": "#14110F",
    "editor.foreground": "#EDE8DC",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#8A8478" } },
    {
      scope: ["string", "string.template", "punctuation.definition.string"],
      settings: { foreground: "#F0C674" },
    },
    {
      scope: ["constant.numeric", "constant.language", "constant.character"],
      settings: { foreground: "#FF9E80" },
    },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.operator.new"],
      settings: { foreground: "#93A4FF" },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call entity.name"],
      settings: { foreground: "#FFFFFF" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.class", "support.type"],
      settings: { foreground: "#7FD7C4" },
    },
    {
      scope: ["entity.name.tag", "support.class.component"],
      settings: { foreground: "#93A4FF" },
    },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#C9C3B5" } },
    {
      scope: ["meta.object-literal.key", "variable.other.property", "support.type.property-name"],
      settings: { foreground: "#C9C3B5" },
    },
    {
      scope: ["punctuation", "keyword.operator", "meta.brace"],
      settings: { foreground: "#A39D90" },
    },
    { scope: ["variable", "variable.other"], settings: { foreground: "#EDE8DC" } },
    { scope: ["markup.heading"], settings: { foreground: "#FFFFFF" } },
  ],
};
