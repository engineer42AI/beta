// app/api/regpdf/[doc]/route.ts
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

const DOC_PATHS: Record<string, string> = {
  // point to a PRIVATE location (outside /public)
  // update this path to where you keep the PDF on your server/container
  cs25: process.env.CS25_PDF_PATH || "src/app/data/CS-25 Amendment 27 (new).pdf",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doc: string }> }
) {
  const { doc } = await params;
  const docKey = doc.toLowerCase();
  const filePath = DOC_PATHS[docKey];
  if (!filePath || !fs.existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  // (Optional) auth check here if your app is gated:
  // if (!isUserAuthed(req)) return new Response("Unauthorized", { status: 401 });

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.get("range");

  // Byte-range support for smooth PDF viewing
  if (range) {
    const match = /bytes=(\d+)-(\d+)?/i.exec(range);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileSize}`,
          },
        });
      }

      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      return new Response(stream as any, {
        status: 206,
        headers: {
          "Content-Type": "application/pdf",
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Cache-Control": "private, max-age=0, no-store",
          "Content-Disposition": "inline; filename=\"cs25.pdf\"",
        },
      });
    }
  }

  // Full file
  const stream = fs.createReadStream(filePath);
  return new Response(stream as any, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Accept-Ranges": "bytes",
      "Content-Length": String(fileSize),
      "Cache-Control": "private, max-age=0, no-store",
      "Content-Disposition": "inline; filename=\"cs25.pdf\"",
    },
  });
}
