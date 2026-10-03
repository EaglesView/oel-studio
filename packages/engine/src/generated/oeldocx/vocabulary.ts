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
    "doc": [],
    "hardBreak": [],
    "image": [
      "alt",
      "cx",
      "cy",
      "floating",
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
      "field",
      "hidden",
      "label",
      "xml"
    ],
    "pageBreak": [],
    "paragraph": [
      "align",
      "checked",
      "css",
      "ilvl",
      "ind",
      "numId",
      "outline",
      "pPr",
      "sectionBreak",
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
      "grid",
      "styleId",
      "tblPr"
    ],
    "tableCell": [
      "background",
      "colspan",
      "colwidth",
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
