import { generatePdfLayoutFromMarkdown } from "@/services/claude";
import { renderPdfLayoutToBytes } from "@/services/aiPdfLayoutToPdf";
import { requireMarkAPI } from "@/services/markApi";

export type AiPdfExportProgress = { progress: number; status: string };

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Generate AI layout PDF from markdown, prompt for save path, write file.
 * @returns true if written, false if user cancelled the save dialog.
 */
export async function exportCurrentDocToAiPdf(
  markdown: string,
  defaultPath?: string,
  onProgress?: (p: AiPdfExportProgress) => void,
): Promise<boolean> {
  const tick = (progress: number, status: string) => onProgress?.({ progress, status });

  tick(8, "Preparing document text…");
  tick(22, "Sending document to the AI to map structure and accent color (wording stays yours)…");
  const spec = await generatePdfLayoutFromMarkdown(markdown);
  tick(58, "Layout ready. Drawing PDF pages (typography, tables, accent band)…");
  const bytes = await renderPdfLayoutToBytes(spec);
  tick(78, "Opening the save dialog — choose where to store your PDF…");
  const api = requireMarkAPI();
  const path = await api.dialogSavePdf(defaultPath);
  if (!path) {
    tick(0, "Save cancelled — no file was written.");
    return false;
  }
  tick(92, "Writing PDF to disk…");
  const b64 = uint8ArrayToBase64(bytes);
  const w = await api.writeFileBinary(path, b64);
  if (!w.ok) throw new Error(w.error);
  tick(100, "Done.");
  return true;
}
