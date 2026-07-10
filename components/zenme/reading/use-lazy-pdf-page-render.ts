import { useEffect } from "react";
import type { RefObject } from "react";

export function useLazyPdfPageRender({
  pageRef,
  setShouldRender,
  shouldRender,
}: {
  pageRef: RefObject<HTMLElement | null>;
  setShouldRender: (shouldRender: boolean) => void;
  shouldRender: boolean;
}) {
  useEffect(() => {
    const element = pageRef.current;
    if (!element || shouldRender) {
      return;
    }

    const scrollRoot = element.closest("[data-reader-scroll]");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
        }
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
  }, [pageRef, setShouldRender, shouldRender]);
}
