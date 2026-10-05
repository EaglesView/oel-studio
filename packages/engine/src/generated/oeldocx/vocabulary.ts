// Generated from crates/oel-docx/src/contract.rs. Do not edit.

/** Nodes and marks the codec reads and writes, with their attr names. */
export const CODEC_VOCABULARY: { nodes: Record<string, string[]>; marks: Record<string, string[]> } = {
  "marks": {
    "bold": [],
    "highlight": [
      "color"
    ],
    "italic": [],
    "link": [
      "href"
    ],
    "strike": [],
    "subscript": [],
    "superscript": [],
    "textStyle": [
      "color",
      "fontFamily",
      "fontSize",
      "rPr",
      "rStyle"
    ],
    "underline": []
  },
  "nodes": {
    "anchor": [
      "alt",
      "behindDoc",
      "children",
      "cx",
      "cy",
      "dist",
      "kind",
      "position",
      "shape",
      "title",
      "wrap",
      "wrapSide",
      "xml",
      "z"
    ],
    "doc": [],
    "hardBreak": [],
    "image": [
      "alt",
      "cx",
      "cy",
      "floating",
      "oid",
      "path",
      "rid",
      "src",
      "title",
      "xml"
    ],
    "noteRef": [
      "id",
      "kind",
      "rPr"
    ],
    "ooxmlBlock": [
      "label",
      "xml"
    ],
    "ooxmlInline": [
      "chart",
      "cx",
      "cy",
      "field",
      "floating",
      "hidden",
      "label",
      "oid",
      "xml"
    ],
    "pageBreak": [],
    "paragraph": [
      "align",
      "checked",
      "css",
      "frame",
      "ilvl",
      "ind",
      "numId",
      "outline",
      "pPr",
      "section",
      "spacing",
      "styleId"
    ],
    "sdtBlock": [
      "gallery",
      "sdtEndPr",
      "sdtPr"
    ],
    "tab": [],
    "table": [
      "css",
      "grid",
      "styleId",
      "tblPr"
    ],
    "tableCell": [
      "background",
      "colspan",
      "colwidth",
      "css",
      "rowspan",
      "tcPr",
      "valign"
    ],
    "tableRow": [
      "header",
      "tblPrEx",
      "trPr"
    ],
    "text": []
  }
};
