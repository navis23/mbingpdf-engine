/**
 * The 14 standard fonts. Import as a namespace (`StandardFonts.Helvetica`); bundlers drop the
 * ones that are not used.
 */
import { StandardFont } from "./standard-font.ts";
import * as data from "./standard-font-data.ts";

export const Helvetica: StandardFont = /* @__PURE__ */ new StandardFont(data.HelveticaData);
export const HelveticaBold: StandardFont = /* @__PURE__ */ new StandardFont(data.HelveticaBoldData);
export const HelveticaOblique: StandardFont = /* @__PURE__ */ new StandardFont(
  data.HelveticaObliqueData,
);
export const HelveticaBoldOblique: StandardFont = /* @__PURE__ */ new StandardFont(
  data.HelveticaBoldObliqueData,
);
export const TimesRoman: StandardFont = /* @__PURE__ */ new StandardFont(data.TimesRomanData);
export const TimesBold: StandardFont = /* @__PURE__ */ new StandardFont(data.TimesBoldData);
export const TimesItalic: StandardFont = /* @__PURE__ */ new StandardFont(data.TimesItalicData);
export const TimesBoldItalic: StandardFont = /* @__PURE__ */ new StandardFont(
  data.TimesBoldItalicData,
);
export const Courier: StandardFont = /* @__PURE__ */ new StandardFont(data.CourierData);
export const CourierBold: StandardFont = /* @__PURE__ */ new StandardFont(data.CourierBoldData);
export const CourierOblique: StandardFont = /* @__PURE__ */ new StandardFont(
  data.CourierObliqueData,
);
export const CourierBoldOblique: StandardFont = /* @__PURE__ */ new StandardFont(
  data.CourierBoldObliqueData,
);
const SymbolFont: StandardFont = /* @__PURE__ */ new StandardFont(data.SymbolData);

export { SymbolFont as Symbol };
export const ZapfDingbats: StandardFont = /* @__PURE__ */ new StandardFont(data.ZapfDingbatsData);
