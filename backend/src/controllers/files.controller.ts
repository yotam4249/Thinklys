import { Request, Response } from "express";
import { getPresignedPutUrl, getPresignedGetUrl } from "../services/s3.service";
import { randomUUID } from "crypto";
import mime from "mime";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export class FilesController {
  /**
   * POST /files/s3/presign-upload
   * body: { contentType: string; filename?: string; prefix?: string }
   * returns: { url, key }
   */
  static async presignUpload(req: Request, res: Response) {
    const { contentType, filename, prefix } = req.body ?? {};
    if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
      return res.status(400).json({ code: "INVALID_CONTENT_TYPE" });
    }

    const ext = mime.getExtension(contentType) || "bin";
    const folder =
      typeof prefix === "string" && /^[-/a-zA-Z0-9_]+$/.test(prefix)
        ? prefix.replace(/^\/+/, "").replace(/\/+$/, "")
        : "uploads";

    const base =
      typeof filename === "string" && filename.trim()
        ? filename.trim().replace(/\s+/g, "_").replace(/[^-_.a-zA-Z0-9]/g, "")
        : randomUUID();

    const key = `${folder}/${base}.${ext}`;
    const { url } = await getPresignedPutUrl({ key, contentType });
    return res.json({ url, key });
  }

  /**
   * GET /files/s3/presign-get?key=...
   * returns: { url }
   */
  static async presignGet(req: Request, res: Response) {
    const key = String(req.query.key ?? "");
    if (!key) return res.status(400).json({ code: "NO_KEY" });

    const url = await getPresignedGetUrl(key);
    return res.json({ url });
  }
}
