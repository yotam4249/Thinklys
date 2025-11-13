import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function reqEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

const REGION = reqEnv("AWS_REGION");
const BUCKET = reqEnv("S3_BUCKET");
const DEFAULT_TTL_SEC = Number(process.env.S3_URL_TTL_SECONDS ?? 900); // 15m

export const s3 = new S3Client({ region: REGION });

export async function getPresignedPutUrl(opts: {
  key: string;
  contentType: string;
  expiresIn?: number; // seconds
}) {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: opts.key,
    ContentType: opts.contentType,
  });
  const url = await getSignedUrl(s3, cmd, { expiresIn: opts.expiresIn ?? 300 }); // 5m
  return { url, key: opts.key, bucket: BUCKET };
}

export async function getPresignedGetUrl(key: string, ttlSec = DEFAULT_TTL_SEC) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: ttlSec });
}
