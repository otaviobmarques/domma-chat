/** Extrai texto de arquivos da base de conhecimento: PDF, Word, planilhas (CSV) e texto. */
export async function extrairTexto(buf: Buffer, mime: string, nome: string): Promise<string> {
  const ext = nome.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || ext === "pdf") {
    const { PDFParse } = await import("pdf-parse") as any;
    if (PDFParse) { const p = new PDFParse({ data: buf }); const r = await p.getText(); return r.text; }
    const pdf = (await import("pdf-parse") as any).default;
    return (await pdf(buf)).text;
  }
  if (ext === "docx" || mime.includes("wordprocessingml")) {
    const mammoth = (await import("mammoth")).default;
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  if (["txt", "md", "csv", "tsv", "json", "html"].includes(ext) || mime.startsWith("text/")) return buf.toString("utf8");
  throw new Error("Formato não suportado. Envie PDF, Word (.docx), CSV ou texto. Para planilhas Excel, salve como CSV.");
}
