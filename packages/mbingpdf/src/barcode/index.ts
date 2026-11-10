/**
 * `mbingpdf/barcode` — one-dimensional barcodes: from a value to the pattern of bars.
 *
 * A code is returned as a row of modules (the narrowest unit of width), dark or light, with
 * no quiet zone. Drawing it is the caller's business; the `Barcode` element does that.
 */

export type BarcodeType =
  /** Any ASCII text, compactly; the usual choice for labels, tickets and parcels. */
  | "code128"
  /** The 13-digit number on retail goods. Give 12 digits and the check digit is added. */
  | "ean13"
  /** The 8-digit short form for small packages (7 digits plus check digit). */
  | "ean8"
  /** The 12-digit North American retail code (11 digits plus check digit). */
  | "upca"
  /** Capitals, digits and `-. $/+%`; old, wide, and read by everything. */
  | "code39"
  /** Interleaved 2 of 5: an even number of digits, densely packed. */
  | "itf"
  /** The 14-digit code on shipping cartons, in ITF (13 digits plus check digit). */
  | "itf14";

export interface BarcodeModules {
  /** The bars and spaces, one entry per module: true is dark. Starts and ends dark. */
  readonly modules: readonly boolean[];
  /** The value as people read it under the bars, with any check digit added. */
  readonly text: string;
}

// Each symbol of Code 128 is three bars and three spaces, eleven modules in all. The digits
// are the widths: bar, space, bar, space, bar, space.
const CODE128 =
  "212222222122222221121223121322131222122213122312132212221213221312231212112232122132122231113222123122123221223211221132221231213212223112312131311222321122321221312212322112322211212123212321232121111323131123131321112313132113132311211313231113231311112133112331132131113123113321133121313121211331231131213113213311213131311123311321331121312113312311332111314111221411431111111224111422121124121421141122141221112214112412122114122411142112142211241211221114413111241112134111111242121142121241114212124112124211411212421112421211212141214121412121111143111341131141114113114311411113411311113141114131311141411131211412211214211232";
const CODE128_STOP = "2331112";
const START_A = 103;
const START_B = 104;
const START_C = 105;
const TO_C = 99;
const TO_B = 100;
const TO_A = 101;

/** The code values of a text in Code 128, switching between its three character sets. */
function code128Values(text: string): number[] {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      throw new RangeError(`Code 128 holds ASCII only; "${text.charAt(i)}" is not`);
    }
  }
  /** How many digits follow from `at`. */
  const digitsFrom = (at: number): number => {
    let count = 0;
    while (at + count < text.length && /\d/.test(text.charAt(at + count))) count++;
    return count;
  };
  /** Set A has the control characters, set B the lower-case letters; either has the rest. */
  const letterSet = (at: number): "A" | "B" => {
    for (let i = at; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 32) return "A";
      if (code >= 96) return "B";
    }
    return "B";
  };
  // Set C packs two digits into one symbol: worth entering for four digits or more, or when
  // digits are all there is.
  const worthC = (at: number): boolean => {
    const digits = digitsFrom(at);
    return digits >= 4 || (digits >= 2 && digits === text.length);
  };

  const values: number[] = [];
  let set: "A" | "B" | "C";
  let at = 0;
  if (worthC(0) && digitsFrom(0) % 2 === 0) set = "C";
  else set = letterSet(0);
  values.push(set === "C" ? START_C : set === "A" ? START_A : START_B);
  while (at < text.length) {
    if (set === "C") {
      if (digitsFrom(at) >= 2) {
        values.push(Number(text.slice(at, at + 2)));
        at += 2;
        continue;
      }
      set = letterSet(at);
      values.push(set === "A" ? TO_A : TO_B);
      continue;
    }
    // An odd run of digits gives its first digit to the current set, so the rest pair up.
    if (worthC(at) && digitsFrom(at) % 2 === 0) {
      set = "C";
      values.push(TO_C);
      continue;
    }
    const code = text.charCodeAt(at);
    if (set === "B" && code < 32) {
      set = "A";
      values.push(TO_A);
      continue;
    }
    if (set === "A" && code >= 96) {
      set = "B";
      values.push(TO_B);
      continue;
    }
    values.push(code < 32 ? code + 64 : code - 32);
    at++;
  }
  let sum = values[0] as number;
  for (let i = 1; i < values.length; i++) sum += i * (values[i] as number);
  values.push(sum % 103);
  return values;
}

function code128(text: string): BarcodeModules {
  if (text === "") throw new RangeError("A barcode needs a value");
  const modules: boolean[] = [];
  const add = (widths: string): void => {
    for (let i = 0; i < widths.length; i++) {
      for (let n = Number(widths.charAt(i)); n > 0; n--) modules.push(i % 2 === 0);
    }
  };
  for (const value of code128Values(text)) add(CODE128.slice(value * 6, value * 6 + 6));
  add(CODE128_STOP);
  // Control characters have nothing to show for themselves under the bars.
  const printable = Array.from(text).filter((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  });
  return { modules, text: printable.join("") };
}

/** The check digit shared by EAN, UPC and ITF-14: weights 3 and 1 from the right. */
function checkDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits.charAt(digits.length - 1 - i)) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** Checks a number given with or without its check digit, and returns it with. */
function withCheckDigit(value: string, length: number, name: string): string {
  if (!/^\d+$/.test(value) || (value.length !== length && value.length !== length - 1)) {
    throw new RangeError(`${name} takes ${length - 1} digits, or ${length} with the check digit`);
  }
  const body = value.slice(0, length - 1);
  const check = checkDigit(body);
  if (value.length === length && Number(value.charAt(length - 1)) !== check) {
    throw new RangeError(
      `The check digit of ${name} ${value} is wrong: it should be ${check}. ` +
        "Leave the last digit out to have it worked out.",
    );
  }
  return body + check;
}

// EAN digits, seven modules each, as drawn left of the centre with odd parity ("L"). Right of
// the centre the colours are swapped ("R"); the even-parity form ("G") is R read backwards.
const EAN_L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
/** Which of the six left digits of EAN-13 are in the G form; this encodes the first digit. */
const EAN_PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

function eanDigit(digit: string, form: string): string {
  const left = EAN_L[Number(digit)] as string;
  if (form === "L") return left;
  const right = left.replace(/[01]/g, (bit) => (bit === "0" ? "1" : "0"));
  return form === "R" ? right : [...right].reverse().join("");
}

function ean(left: string, forms: string, right: string, text: string): BarcodeModules {
  let bits = "101";
  for (let i = 0; i < left.length; i++) bits += eanDigit(left.charAt(i), forms.charAt(i));
  bits += "01010";
  for (const digit of right) bits += eanDigit(digit, "R");
  bits += "101";
  return { modules: Array.from(bits, (bit) => bit === "1"), text };
}

// Code 39: nine elements per character, bars and spaces in turn, three of them wide.
const CODE39_CHARACTERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*";
const CODE39 =
  "000110100100100001001100001101100000000110001100110000001110000000100101100100100001100100100001001001001001101001000000011001100011000001011000000001101100001100001001100000011100100000011001000011101000010000010011100010010001010010000000111100000110001000110000010110110000001011000001111000000010010001110010000011010000010000101110000100011000100010101000010100010010001010000101010010010100";
/** A wide element is this many modules; a narrow one is one. */
const WIDE = 3;

function code39(text: string): BarcodeModules {
  if (text === "") throw new RangeError("A barcode needs a value");
  if (text.includes("*")) {
    throw new RangeError('Code 39 uses "*" to mark its ends; it cannot be part of the value');
  }
  const modules: boolean[] = [];
  for (const character of `*${text}*`) {
    const index = CODE39_CHARACTERS.indexOf(character);
    if (index < 0) {
      throw new RangeError(
        `Code 39 holds capitals, digits and "-. $/+%" only; "${character}" is not one of them`,
      );
    }
    // A narrow gap separates one character from the next.
    if (modules.length > 0) modules.push(false);
    for (let i = 0; i < 9; i++) {
      const wide = CODE39.charAt(index * 9 + i) === "1";
      for (let n = wide ? WIDE : 1; n > 0; n--) modules.push(i % 2 === 0);
    }
  }
  return { modules, text };
}

// Interleaved 2 of 5: five elements per digit, two of them wide. One digit is drawn in the
// bars and the next in the spaces between them.
const ITF = [
  "00110",
  "10001",
  "01001",
  "11000",
  "00101",
  "10100",
  "01100",
  "00011",
  "10010",
  "01010",
];

function itf(digits: string): BarcodeModules {
  if (!/^\d+$/.test(digits) || digits.length % 2 !== 0) {
    throw new RangeError("ITF takes an even number of digits");
  }
  const modules: boolean[] = [];
  const add = (dark: boolean, wide: boolean): void => {
    for (let n = wide ? WIDE : 1; n > 0; n--) modules.push(dark);
  };
  for (const dark of [true, false, true, false]) add(dark, false);
  for (let at = 0; at < digits.length; at += 2) {
    const bars = ITF[Number(digits.charAt(at))] as string;
    const spaces = ITF[Number(digits.charAt(at + 1))] as string;
    for (let i = 0; i < 5; i++) {
      add(true, bars.charAt(i) === "1");
      add(false, spaces.charAt(i) === "1");
    }
  }
  add(true, true);
  add(false, false);
  add(true, false);
  return { modules, text: digits };
}

/**
 * Encodes a value as a barcode.
 *
 * @throws RangeError when the value does not fit the kind of code: wrong characters, wrong
 *   length, or a check digit that does not match
 */
export function barcode(type: BarcodeType, value: string): BarcodeModules {
  switch (type) {
    case "code128":
      return code128(value);
    case "ean13": {
      const digits = withCheckDigit(value, 13, "EAN-13");
      return ean(
        digits.slice(1, 7),
        EAN_PARITY[Number(digits.charAt(0))] as string,
        digits.slice(7),
        digits,
      );
    }
    case "upca": {
      // UPC-A is EAN-13 with a leading zero that is not printed.
      const digits = withCheckDigit(value, 12, "UPC-A");
      return ean(digits.slice(0, 6), "LLLLLL", digits.slice(6), digits);
    }
    case "ean8": {
      const digits = withCheckDigit(value, 8, "EAN-8");
      return ean(digits.slice(0, 4), "LLLL", digits.slice(4), digits);
    }
    case "code39":
      return code39(value);
    case "itf":
      return itf(value);
    case "itf14":
      return itf(withCheckDigit(value, 14, "ITF-14"));
    default:
      throw new RangeError(`Unknown barcode type: ${String(type)}`);
  }
}
