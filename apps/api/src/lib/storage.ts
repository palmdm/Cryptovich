import { S3StorageService, StorageService, type StorageBackend } from "@platform/integrations";
import { config } from "../config.js";

// The backends live in @platform/integrations so the worker stores files the
// same way (sticker imports write server emoji); see storage.ts there for
// why every backend returns a stream and never a URL.
export { S3StorageService, StorageService, type StorageBackend };

/**
 * One backend for the process. Local disk unless a bucket is configured,
 * so an operator who sets nothing keeps exactly the behaviour that
 * shipped before object storage existed.
 */
export const storageService: StorageBackend = config.s3Bucket
  ? new S3StorageService(config.s3Bucket, {
      region: config.s3Region,
      endpoint: config.s3Endpoint || undefined,
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    })
  : new StorageService(config.uploadDir);
