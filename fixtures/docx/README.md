# .docx fixtures

Every `.docx` here is imported, exported and re-imported by `crates/oel-docx/tests/contract.rs`.
Reference renders: `node scripts/render-reference.mjs fixtures/docx/<name>.docx` (or `--all`)
→ `fixtures/reference/<name>/page-<n>.png` (LibreOffice, git-ignored).

| Fixture | Exercises |
|---|---|
| `tesxte.docx` | One long paragraph, French text, run language (`w:lang`) kept raw |
| `rich.docx` | Headings, lists, bold/italic, links, an inline picture, a table, footnotes |
| `basic_text.docx` | Plain paragraphs with direct formatting |
| `long.docx` | Many pages of text (pagination, performance) |
| `complex_template.docx` | Word "report" template: 5 sections (0.5" cover, 2" left margin chapters, `lowerRoman` + restarts), inherited footers, `titlePg`, floating shapes with theme colours and a picture fill, text boxes, frames, tables without borders, theme fonts in renamed parts (`theme11.xml`, `settings2.xml`) |
| `sections-margins.docx` | 3 sections: Letter portrait with 0.5" margins; Letter landscape; `continuous` landscape with a 2" left margin |
| `sections-headers.docx` | Header/footer inheritance: s1 has default/first/even headers + a default footer with `PAGE`, `titlePg`, `pgNumType lowerRoman start=1`; s2 inherits everything and restarts at 1 (decimal); s3 has its own footer; `evenAndOddHeaders` in settings |
| `anchors.docx` | Floating objects: behind-text rectangle relative to the page (`schemeClr tx1` + `lumMod`/`lumOff`), picture with square wrap aligned right in the column, text box in `mc:AlternateContent` with a VML fallback, group (ellipse + rectangle), ellipse with a picture fill (`a:blipFill` + `srcRect`) |
| `embedded-font.docx` | A font embedded and obfuscated like Word does (`w:embedRegular` + `w:fontKey`, `word/fonts/font1.odttf`): Comfortaa, SIL OFL 1.1 |
| `table-borders.docx` | Table borders: none (no style), `Table Grid` style, one cell's own `tcBorders`, banded style with `firstRow` / `band1Horz` conditional formatting at 100 % width |

The five single-feature fixtures are written from hand-made WordprocessingML by `src/make_fixtures.py`
(`python3 fixtures/docx/src/make_fixtures.py`), so each one isolates a single feature;
edit the script, not the files.

LibreOffice differences from Word to keep in mind when comparing:
- A `continuous` section with different margins keeps the previous margins in LibreOffice;
  Word (and the editor) apply the new text width from the section's first paragraph.
