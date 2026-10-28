import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Alert, Busy } from "./ui";

export function ResumePreview() {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const [failure, setFailure] = useState("");
  const [retry, setRetry] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [pageText, setPageText] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pagePosition = useRef<HTMLSpanElement>(null);
  const move = (value: number) => {
    setPage(value);
    requestAnimationFrame(() => pagePosition.current?.focus());
  };
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.getBoundingClientRect().width));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const cancellation = new AbortController();
    let task: PDFDocumentLoadingTask | null = null;
    let port: Worker | null = null;
    setPdf(null);
    setFailure("");
    setPage(1);
    setRendering(true);
    void (async () => {
      try {
        const response = await fetch("/api/resume", { signal: cancellation.signal });
        if (!response.ok)
          throw new Error("The PDF could not be loaded. Try again or replace your resume.");
        const data = new Uint8Array(await response.arrayBuffer());
        const { getDocument, PDFWorker } = await import("pdfjs-dist");
        cancellation.signal.throwIfAborted();
        port = new Worker(workerUrl, { type: "module" });
        task = getDocument({
          data,
          worker: PDFWorker.create({ port }),
          cMapUrl: "/pdf/cmaps/",
          standardFontDataUrl: "/pdf/standard_fonts/",
          useWasm: false,
          disableFontFace: true,
        });
        const document = await task.promise;
        if (!cancellation.signal.aborted) setPdf(document);
      } catch (error) {
        if (!cancellation.signal.aborted) {
          setFailure(
            error instanceof Error ? error.message : "The PDF preview could not be opened.",
          );
          setRendering(false);
        }
      }
    })();
    return () => {
      cancellation.abort();
      // Closing the preview intentionally cancels unfinished worker operations.
      void task?.destroy().catch(() => {});
      port?.terminate();
    };
  }, [retry]);
  useEffect(() => {
    const element = canvas.current;
    if (!pdf || !element || width <= 0) return;
    let disposed = false;
    let renderTask:
      ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    setRendering(true);
    setPageText("");
    void (async () => {
      try {
        const documentPage = await pdf.getPage(page);
        if (disposed) return;
        const base = documentPage.getViewport({ scale: 1 });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = documentPage.getViewport({ scale: (width / base.width) * ratio });
        element.width = Math.ceil(viewport.width);
        element.height = Math.ceil(viewport.height);
        renderTask = documentPage.render({ canvas: element, viewport });
        await renderTask.promise;
        const text = await documentPage.getTextContent();
        if (!disposed) {
          setPageText(text.items.map((item) => ("str" in item ? item.str : "")).join(" "));
          setRendering(false);
        }
      } catch (error) {
        if (!disposed) {
          setFailure(
            error instanceof Error ? error.message : "This PDF page could not be displayed.",
          );
          setRendering(false);
        }
      }
    })();
    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [pdf, page, width]);
  return (
    <div className="pdf-preview">
      <div className="pdf-toolbar">
        <div>
          <button
            type="button"
            className="icon-button"
            aria-label="Previous resume page"
            disabled={!pdf || rendering || page <= 1}
            onClick={() => move(page - 1)}
          >
            <ChevronLeft />
          </button>
          <span role="status" ref={pagePosition} tabIndex={-1}>
            {pdf ? `${page} / ${pdf.numPages}` : "Loading PDF…"}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Next resume page"
            disabled={!pdf || rendering || page >= pdf.numPages}
            onClick={() => move(page + 1)}
          >
            <ChevronRight />
          </button>
        </div>
        <a className="button ghost" href="/api/resume" download="resume.pdf">
          <Download />
          Download PDF
        </a>
      </div>
      {failure && <Alert onRetry={() => setRetry((value) => value + 1)}>{failure}</Alert>}
      <div ref={container} className="pdf-paper" aria-busy={rendering}>
        {!pdf && !failure && <Busy label="Loading PDF…" />}
        <canvas
          ref={canvas}
          hidden={!pdf || Boolean(failure)}
          role="img"
          aria-label={`Resume page ${page}`}
          aria-describedby="resume-page-text"
        />
        <p id="resume-page-text" className="sr-only">
          {pageText}
        </p>
      </div>
    </div>
  );
}
