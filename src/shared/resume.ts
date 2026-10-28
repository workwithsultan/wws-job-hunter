import { z } from "zod";
export const resumeLimits = { bytes: 10 * 1024 * 1024, pages: 20, characters: 12000 } as const;
export function resumeFileError(file: { name: string; size: number }): string {
  if (!/\.pdf$/i.test(file.name)) return "Choose a PDF file.";
  if (file.name.length > 255) return "Choose a PDF with a filename of no more than 255 characters.";
  if (!file.size) return "This PDF is empty. Choose another file.";
  if (file.size > resumeLimits.bytes) return "Choose a PDF no larger than 10 MB.";
  return "";
}
export function hasPdfHeader(data: Uint8Array): boolean {
  return new TextDecoder("latin1").decode(data.subarray(0, 1024)).includes("%PDF-");
}
export function readableResume(text: string): boolean {
  return (
    text.trim().length >= 10 &&
    /\p{L}/u.test(text) &&
    (text.match(/\uFFFD/g)?.length ?? 0) / Math.max(1, text.length) < 0.05
  );
}

export const resumeMetadataSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/\.pdf$/i),
    pages: z.number().int().min(1).max(resumeLimits.pages),
  })
  .strict();
export type ResumeMetadata = z.infer<typeof resumeMetadataSchema>;
