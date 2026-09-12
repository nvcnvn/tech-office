package integration

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strings"
)

// Document fixtures are built in the test process rather than committed.
//
// Two reasons. scripts/check-tracked-files.sh allows a tracked `pdf` but not a `docx` or
// an `xlsx`, so committed office fixtures would fail the repository's own guard. More
// importantly, a builder lets each scenario inject its own unique marker phrase — and a
// phrase that appears in the content but not the filename is exactly what makes a content
// search test evidence rather than a filename search in disguise.

// pdfWithText builds a one-page PDF whose single text-showing operator draws phrase.
func pdfWithText(phrase string) []byte {
	return buildPDF(fmt.Sprintf("BT /F1 24 Tf 72 700 Td (%s) Tj ET", escapePDFString(phrase)))
}

// pdfWithoutText builds a one-page PDF that draws a filled rectangle and no text at all.
// To a text extractor this is indistinguishable from a scanned page: a valid document
// with nothing selectable in it.
func pdfWithoutText() []byte {
	return buildPDF("0.2 0.4 0.8 rg 72 600 200 120 re f")
}

// buildPDF assembles catalog → pages → page → content stream with a correct xref table.
func buildPDF(contentStream string) []byte {
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
			"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(contentStream), contentStream),
	}

	var buf bytes.Buffer
	buf.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objects))
	for i, body := range objects {
		offsets[i] = buf.Len()
		fmt.Fprintf(&buf, "%d 0 obj\n%s\nendobj\n", i+1, body)
	}

	xrefOffset := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, off := range offsets {
		fmt.Fprintf(&buf, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n",
		len(objects)+1, xrefOffset)

	return buf.Bytes()
}

// escapePDFString escapes the three characters that are syntax inside a PDF literal
// string. Marker phrases are alphanumeric today; escaping keeps a future one from
// silently producing a corrupt fixture that looks like an extractor bug.
func escapePDFString(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `(`, `\(`, `)`, `\)`)
	return r.Replace(s)
}

// docxWithText builds a minimal but valid .docx: three parts is all LibreOffice needs.
func docxWithText(phrase string) []byte {
	return zipParts(map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
		"word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>Method statement for confined space entry.</w:t></w:r></w:p>
<w:p><w:r><w:t>` + phrase + `</w:t></w:r></w:p></w:body>
</w:document>`,
	})
}

// xlsxWithText builds a minimal but valid .xlsx carrying phrase in one inline-string
// cell. Five parts, because a workbook needs its relationship chain to the sheet.
func xlsxWithText(phrase string) []byte {
	return zipParts(map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
		"xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
		"xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>` + phrase + `</t></is></c></row></sheetData>
</worksheet>`,
	})
}

// zipParts writes the named parts into a zip archive, which is what an OOXML file is.
func zipParts(parts map[string]string) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	// [Content_Types].xml conventionally comes first; the rest follow in any order.
	names := []string{"[Content_Types].xml"}
	for name := range parts {
		if name != "[Content_Types].xml" {
			names = append(names, name)
		}
	}
	for _, name := range names {
		w, err := zw.Create(name)
		if err != nil {
			panic("build OOXML fixture: " + err.Error())
		}
		if _, err := w.Write([]byte(parts[name])); err != nil {
			panic("build OOXML fixture: " + err.Error())
		}
	}
	if err := zw.Close(); err != nil {
		panic("build OOXML fixture: " + err.Error())
	}
	return buf.Bytes()
}
