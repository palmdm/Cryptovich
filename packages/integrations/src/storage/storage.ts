import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

/** A stored file as the nightly clean-up sees it. */
export interface StoredFile {
  key: string;
  size: number;
  modifiedAt: Date;
}

/**
 * Only names this code gives files — a UUID, with an extension or not —
 * are ever listed, so anything else in the folder or bucket (a README, an
 * operator's own directory) is never a candidate for deletion.
 */
export const STORAGE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,8})?$/;

/**
 * Where uploaded bytes live. Two implementations, chosen by configuration:
 * local disk (the default, and what a single-host deployment wants) and
 * any S3-compatible bucket.
 *
 * Every backend returns a *stream* rather than a URL, and that is
 * deliberate: gated downloads must keep flowing through the API so
 * EntitlementService stays the only thing deciding who may read a file.
 * Handing out a bucket URL — public or presigned — would move that
 * decision outside the application, where the platform's own access rules
 * no longer apply and a leaked link outlives the entitlement it came from.
 */
export interface StorageBackend {
  save(buffer: Buffer, extension?: string): Promise<string>;
  readStream(key: string): Readable;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Every file this code stored (see STORAGE_KEY). */
  list?(): AsyncIterable<StoredFile>;
}

/**
 * Local-disk file storage. Keys are always server-generated UUIDs, never
 * derived from a client-supplied filename — nothing ever builds a path
 * from user input, so there's no path-traversal surface to defend against
 * even though this doesn't sanitize its `key` argument.
 */
export class StorageService implements StorageBackend {
  private readonly root: string;

  constructor(root: string = process.env.UPLOAD_DIR ?? "./data/uploads") {
    this.root = path.resolve(root);
  }

  private pathFor(key: string): string {
    return path.join(this.root, key);
  }

  /**
   * `extension` is only ever passed a value from a small server-controlled
   * allowlist (never a client-supplied string) — see
   * `CreatorService.uploadAvatar` — so it can't be used to escape `root`.
   */
  async save(buffer: Buffer, extension?: string): Promise<string> {
    await mkdir(this.root, { recursive: true });
    const key = extension ? `${randomUUID()}.${extension}` : randomUUID();
    await writeFile(this.pathFor(key), buffer);
    return key;
  }

  readStream(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    return stat(this.pathFor(key))
      .then(() => true)
      .catch(() => false);
  }

  async delete(key: string): Promise<void> {
    await unlink(this.pathFor(key)).catch(() => {});
  }

  async *list(): AsyncIterable<StoredFile> {
    const names = await readdir(this.root).catch(() => [] as string[]);
    for (const key of names) {
      if (!STORAGE_KEY.test(key)) continue;
      const info = await stat(this.pathFor(key)).catch(() => null);
      if (info?.isFile()) yield { key, size: info.size, modifiedAt: info.mtime };
    }
  }
}

/**
 * Any S3-compatible bucket — AWS S3, Cloudflare R2, Backblaze B2, MinIO.
 * `forcePathStyle` is on because everything except AWS itself needs it,
 * and AWS accepts it.
 *
 * The bucket should stay private. Nothing here ever produces a public or
 * presigned URL: reads go back through the API, which is what keeps
 * EntitlementService in the path (see StorageBackend above).
 */
export class S3StorageService implements StorageBackend {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    options: { region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string },
  ) {
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint, forcePathStyle: true } : {}),
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async save(buffer: Buffer, extension?: string): Promise<string> {
    const key = extension ? `${randomUUID()}.${extension}` : randomUUID();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer }));
    return key;
  }

  /**
   * The SDK's body is fetched lazily, so this returns a PassThrough that
   * the object is piped into once the request resolves — the callers
   * (attachment and avatar routes) hand a stream straight to Fastify and
   * cannot await here.
   */
  readStream(key: string): Readable {
    const passthrough = new Readable({ read() {} });
    this.client
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      .then((res) => {
        const body = res.Body as Readable | undefined;
        if (!body) {
          passthrough.destroy(new Error(`Object ${key} had no body.`));
          return;
        }
        body.on("data", (chunk) => passthrough.push(chunk));
        body.on("end", () => passthrough.push(null));
        body.on("error", (err) => passthrough.destroy(err));
      })
      .catch((err) => passthrough.destroy(err));
    return passthrough;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
      .catch(() => {});
  }

  async *list(): AsyncIterable<StoredFile> {
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, ContinuationToken: token }));
      for (const item of page.Contents ?? []) {
        if (item.Key && STORAGE_KEY.test(item.Key)) {
          yield { key: item.Key, size: item.Size ?? 0, modifiedAt: item.LastModified ?? new Date() };
        }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
}

/**
 * The backend configured by the environment: an S3-compatible bucket when
 * `S3_BUCKET` is set, local disk (`UPLOAD_DIR`) otherwise. The API and the
 * worker both build theirs from here, so a file one of them stores is one
 * the other can read.
 */
export function storageFromEnv(env: Record<string, string | undefined> = process.env): StorageBackend {
  return env.S3_BUCKET
    ? new S3StorageService(env.S3_BUCKET, {
        region: env.S3_REGION || "auto",
        endpoint: env.S3_ENDPOINT || undefined,
        accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
      })
    : new StorageService(env.UPLOAD_DIR ?? "./data/uploads");
}
