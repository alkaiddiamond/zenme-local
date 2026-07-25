import type { PdfDocumentProxyLike, PdfOutlineSection } from "./types";

export async function resolvePdfOutlineSections(
  pdf: PdfDocumentProxyLike,
): Promise<PdfOutlineSection[]> {
  const outline = await pdf.getOutline();
  if (!outline?.length) return [];

  const sections: PdfOutlineSection[] = [];
  await appendOutlineItems(pdf, outline, sections);
  return sections;
}

async function appendOutlineItems(
  pdf: PdfDocumentProxyLike,
  items: Awaited<ReturnType<PdfDocumentProxyLike["getOutline"]>>,
  sections: PdfOutlineSection[],
) {
  if (!items) return;

  for (const item of items) {
    const index = await resolveOutlinePageIndex(pdf, item.dest);
    const title = item.title.trim();
    if (
      index !== null &&
      title &&
      !sections.some(
        (section) => section.index === index && section.title === title,
      )
    ) {
      sections.push({ index, title });
    }
    await appendOutlineItems(pdf, item.items, sections);
  }
}

async function resolveOutlinePageIndex(
  pdf: PdfDocumentProxyLike,
  destination: string | unknown[] | null,
) {
  try {
    const resolvedDestination =
      typeof destination === "string"
        ? await pdf.getDestination(destination)
        : destination;
    const pageReference = resolvedDestination?.[0];
    if (pageReference === undefined || pageReference === null) return null;
    return await pdf.getPageIndex(pageReference);
  } catch {
    return null;
  }
}
