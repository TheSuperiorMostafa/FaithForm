import JSZip from "jszip";
import { Readable } from "node:stream";
import { google } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleAuthClient } from "@/lib/integrations/google-oauth";
import type { MailAttachment } from "@/lib/integrations/mime-message";

export const EMAIL_DOCUMENT_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
function xml(value: string): string {
  // A pasted control character must not make the Word/Google document invalid.
  const safe = Array.from(value).filter((character) => {
    const code = character.codePointAt(0)!;
    return code === 9 || code === 10 || code === 13 ||
      (code >= 0x20 && code <= 0xD7FF) ||
      (code >= 0xE000 && code <= 0xFFFD) ||
      (code >= 0x10000 && code <= 0x10FFFF);
  }).join("");
  return safe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A complete message copy, readable in Word and importable into Google Docs. */
export async function buildEmailDocument(subject: string, bodyText: string): Promise<MailAttachment> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paragraphs = [subject, "", ...bodyText.split(/\r?\n/)].map((line) => `<w:p><w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
  return { fileName: "weekly-events.docx", mimeType: EMAIL_DOCUMENT_MIME, content: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) };
}

/** Drive imports our document as a native Google Doc; access stays private. */
export async function createEmailGoogleDoc(churchId: string, subject: string, attachment: MailAttachment, supabase?: SupabaseClient): Promise<string> {
  const auth = await getGoogleAuthClient(churchId, supabase);
  const drive = google.drive({ version: "v3", auth });
  const { data } = await drive.files.create({
    requestBody: { name: subject, mimeType: "application/vnd.google-apps.document" },
    media: { mimeType: attachment.mimeType, body: Readable.from(attachment.content) },
    fields: "id,webViewLink",
  });
  if (!data.id) throw new Error("Google did not create the document.");
  return data.webViewLink || `https://docs.google.com/document/d/${data.id}/edit`;
}
