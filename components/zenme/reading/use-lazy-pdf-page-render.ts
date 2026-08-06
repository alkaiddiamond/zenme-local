import { useEffect } from "react";
import type { RefObject } from "react";

export function useLazyPdfPageRender({
  pageRef,
  setShouldRender,
}: {
  pageRef: RefObject<HTMLElement | null>;
  setShouldRender: (shouldRender: boolean) => void;
}) {
  useEffect(() => {
    const element = pageRef.current;
    if (!element) {
      return;
    }

    const scrollRoot = element.closest("[data-reader-scroll]");
    const observer = new IntersectionObserver(
      (entries) => {
        setShouldRender(entries.some((entry) => entry.isIntersecting));
      },
      {
        root: scrollRoot instanceof Element ? scrollRoot : null,
        rootMargin: "900px 0px",
      },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [pageRef, setShouldRender]);
}
