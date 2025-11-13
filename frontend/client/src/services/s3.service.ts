// src/services/s3.service.ts
import api from "./api";

/** Ask backend for a presigned PUT url (secured by your server) */
export async function presignUpload(
  contentType: string,
  opts?: { filename?: string; prefix?: string }
) {
  const { data } = await api.post<{ url: string; key: string }>("/files/s3/presign-upload", {
    contentType,
    filename: opts?.filename,
    prefix: opts?.prefix ?? "users/new",
  });
  return data; // { url, key }
}

/** Upload the file directly to S3 using the presigned URL */
export async function uploadViaPresignedPut(url: string, file: File, contentType: string) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`S3 upload failed (${res.status}): ${txt}`);
  }
}

/** Optional: get a new short-lived URL for any stored key */
export async function presignGet(key: string) {
  const { data } = await api.get<{ url: string }>("/files/s3/presign-get", { params: { key } });
  return data.url;
}
