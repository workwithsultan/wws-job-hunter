import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { hasPdfHeader, readableResume, resumeFileError, resumeLimits } from "../src/shared/resume";

export interface ResumeText {
  text: string;
  pages: number;
  emptyPages: number[];
}
export class ResumeReadError extends Error {}
export async function readResume(file: File, signal: AbortSignal): Promise<ResumeText> {
  signal.throwIfAborted();
  const invalid = resumeFileError(file);
  if (invalid) throw new ResumeReadError(invalid);
  const data = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfHeader(data))
    throw new ResumeReadError(
      "This file is not a valid PDF. Export your resume as a PDF and try again.",
    );
  const { getDocument, PDFWorker } = await import("pdfjs-dist");
  signal.throwIfAborted();
  const port = new Worker(workerUrl, { type: "module" });
  const worker = PDFWorker.create({ port });
  const task = getDocument({
    data,
    worker,
    cMapUrl: "/pdf/cmaps/",
    standardFontDataUrl: "/pdf/standard_fonts/",
    useWasm: false,
    disableFontFace: true,
    stopAtErrors: true,
  });
  let abort: () => void = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cleanupTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    try {
      return await Promise.race([
        new Promise<never>((_resolve, reject) => {
          abort = () => reject(new DOMException("Resume import cancelled.", "AbortError"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        }),
        (async () => {
          const pdf = await task.promise;
          if (pdf.numPages > resumeLimits.pages)
            throw new ResumeReadError("Choose a resume PDF with no more than 20 pages.");
          const pages: string[] = [];
          const emptyPages: number[] = [];
          for (let number = 1; number <= pdf.numPages; number++) {
            const page = await pdf.getPage(number);
            const content = await page.getTextContent();
            const text = content.items
              .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
              .join("")
              .replace(/[^\S\n]+/g, " ")
              .replace(/ *\n */g, "\n")
              .trim();
            if (!readableResume(text)) emptyPages.push(number);
            pages.push(text);
            page.cleanup();
            if (pages.join("\n\n").length > resumeLimits.characters)
              throw new ResumeReadError(
                "The extracted text exceeds the 12,000-character profile limit. Choose a shorter resume.",
              );
          }
          const text = pages.join("\n\n").trim();
          if (!readableResume(text))
            throw new ResumeReadError(
              "No readable text was found. Choose a PDF with selectable text. Scanned resumes need OCR before importing.",
            );
          return { text, pages: pdf.numPages, emptyPages };
        })(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new ResumeReadError(
                  "Reading this PDF took too long. Choose a smaller or newly exported copy.",
                ),
              ),
            15000,
          );
        }),
        new Promise<never>((_resolve, reject) => {
          port.addEventListener(
            "error",
            () =>
              reject(
                new ResumeReadError(
                  "The PDF reader could not start. Reload this page and try again.",
                ),
              ),
            { once: true },
          );
        }),
      ]);
    } finally {
      signal.removeEventListener("abort", abort);
      clearTimeout(timeout);
      try {
        await Promise.race([
          task.destroy(),
          new Promise<void>((resolve) => {
            cleanupTimeout = setTimeout(resolve, 300);
          }),
        ]);
      } finally {
        clearTimeout(cleanupTimeout);
        port.terminate();
        worker.destroy();
      }
    }
  } catch (error) {
    if (signal.aborted) throw new DOMException("Resume import cancelled.", "AbortError");
    if (error instanceof ResumeReadError) throw error;
    if (error instanceof Error && error.name === "PasswordException")
      throw new ResumeReadError(
        "This PDF is password-protected. Export an unlocked copy before importing.",
      );
    throw new ResumeReadError("This PDF could not be read. Choose another PDF.");
  }
}
