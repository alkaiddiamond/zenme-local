import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";

import { parseDocxSections } from "./docx-parser";

describe("parseDocxSections", () => {
  it("converts DOCX headings, paragraphs and tables into fixed reading pages", async () => {
    const sections = await parseDocxSections(createDocxBuffer());

    expect(sections[0]).toMatchObject({ index: 0, title: "第一章" });
    const text = sections.map((section) => section.text).join("\n");
    expect(text).toContain("DOCX 正文");
    expect(text).toContain("重点内容");
    expect(sections.map((section) => section.html).join("\n")).toContain(
      "<table>",
    );
    expect(sections.every((section) => section.paginationVersion === 2)).toBe(
      true,
    );
  });
});

function createDocxBuffer() {
  const zip = new AdmZip();
  zip.addFile(
    "[Content_Types].xml",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
        <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
      </Types>`),
  );
  zip.addFile(
    "_rels/.rels",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`),
  );
  zip.addFile(
    "word/_rels/document.xml.rels",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      </Relationships>`),
  );
  zip.addFile(
    "word/styles.xml",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:style w:type="paragraph" w:styleId="Heading1">
          <w:name w:val="heading 1"/><w:qFormat/>
        </w:style>
      </w:styles>`),
  );
  zip.addFile(
    "word/document.xml",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章</w:t></w:r></w:p>
          <w:p><w:r><w:t>DOCX 正文</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>重点内容</w:t></w:r></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
          <w:sectPr/>
        </w:body>
      </w:document>`),
  );
  return zip.toBuffer();
}
