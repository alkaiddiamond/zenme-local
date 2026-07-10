import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";

import { parseEpubSections, readEpubTitle } from "./epub-parser";

function createMinimalEpub() {
  const zip = new AdmZip();

  zip.addFile(
    "META-INF/container.xml",
    Buffer.from(
      `<?xml version="1.0"?>
      <container version="1.0">
        <rootfiles>
          <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
        </rootfiles>
      </container>`,
    ),
  );
  zip.addFile(
    "OPS/content.opf",
    Buffer.from(
      `<?xml version="1.0"?>
      <package>
        <metadata>
          <dc:title>地师</dc:title>
        </metadata>
        <manifest>
          <item id="chapter-1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
          <item id="chapter-2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine>
          <itemref idref="chapter-1"/>
          <itemref idref="chapter-2"/>
        </spine>
      </package>`,
    ),
  );
  zip.addFile(
    "OPS/chapter1.xhtml",
    Buffer.from(
      `<html>
        <head><title>第一章</title></head>
        <body>
          <h1>第一章 山中</h1>
          <p onclick="alert(1)">正文 <a href="chapter2.xhtml">下一章</a></p>
          <img src="images/cover.png" onerror="alert(1)">
          <script>alert(1)</script>
        </body>
      </html>`,
    ),
  );
  zip.addFile(
    "OPS/chapter2.xhtml",
    Buffer.from(
      `<html>
        <body><h1>第二章 城中</h1><p>后续正文</p></body>
      </html>`,
    ),
  );

  return zip.toBuffer();
}

describe("epub parser", () => {
  it("reads the EPUB title from OPF metadata", () => {
    expect(readEpubTitle(createMinimalEpub())).toBe("地师");
  });

  it("parses spine sections and rewrites local asset URLs", () => {
    const sections = parseEpubSections("asset-1", createMinimalEpub());

    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections[0].title).toBe("第一章 山中");
    expect(sections[0].text).toContain("正文");
    expect(sections[0].html).toContain(
      "/api/reading/assets/asset-1/epub-asset?path=OPS%2Fchapter2.xhtml",
    );
    expect(sections[0].html).toContain(
      "/api/reading/assets/asset-1/epub-asset?path=OPS%2Fimages%2Fcover.png",
    );
    expect(sections[0].html).not.toContain("onclick");
    expect(sections[0].html).not.toContain("<script>");
  });

  it("returns no sections when the EPUB has no OPF manifest", () => {
    const zip = new AdmZip();
    zip.addFile("mimetype", Buffer.from("application/epub+zip"));

    expect(parseEpubSections("asset-1", zip.toBuffer())).toEqual([]);
  });

  it("returns null title for invalid EPUB bytes", () => {
    expect(readEpubTitle(Buffer.from("not an epub"))).toBeNull();
  });
});
