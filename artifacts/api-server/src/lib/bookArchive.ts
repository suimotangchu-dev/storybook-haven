import * as yauzl from "yauzl";
import { objectStorageClient, ObjectStorageService } from "./objectStorage";

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 120 * 1024 * 1024;
const MAX_ENTRY_BYTES = 24 * 1024 * 1024;
const MAX_ENTRIES = 2500;
const storage = new ObjectStorageService();

export class ArchiveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveValidationError";
  }
}

type ExtractedEntry = {
  name: string;
  contentType: string;
  data: Buffer;
};

export type StoredBookPackage = {
  packagePrefix: string;
  packageFiles: string[];
  coverPath: string | null;
};

export async function storeBookPackage(
  archiveObjectPath: string,
  bookId: string,
): Promise<StoredBookPackage> {
  if (
    !archiveObjectPath.startsWith("/objects/uploads/") ||
    archiveObjectPath.includes("..") ||
    archiveObjectPath.includes("\\")
  ) {
    throw new ArchiveValidationError("Choose a valid uploaded ZIP file.");
  }

  let archiveFile;
  const savedFiles: string[] = [];
  const packagePrefix = `/objects/storybooks/${bookId}`;

  try {
    archiveFile = await storage.getObjectEntityFile(archiveObjectPath);
    const [metadata] = await archiveFile.getMetadata();
    if (Number(metadata.size ?? 0) > MAX_ARCHIVE_BYTES) {
      throw new ArchiveValidationError("ZIP files must be 50 MB or smaller.");
    }

    const [archiveBuffer] = await archiveFile.download();
    if (archiveBuffer.byteLength > MAX_ARCHIVE_BYTES) {
      throw new ArchiveValidationError("ZIP files must be 50 MB or smaller.");
    }

    const entries = await readArchive(archiveBuffer);
    if (!entries.some((entry) => entry.name === "index.html")) {
      throw new ArchiveValidationError(
        "The ZIP must contain index.html at its top level.",
      );
    }

    const privateDir = storage.getPrivateObjectDir().replace(/\/+$/, "");
    const pathParts = `${privateDir}/storybooks/${bookId}`
      .replace(/^\/+/, "")
      .split("/");
    const bucketName = pathParts.shift();
    if (!bucketName || pathParts.length === 0) {
      throw new Error("Private object storage path is invalid.");
    }
    const objectPrefix = pathParts.join("/");
    const bucket = objectStorageClient.bucket(bucketName);

    try {
      for (const entry of entries) {
        const objectName = `${objectPrefix}/${entry.name}`;
        await bucket.file(objectName).save(entry.data, {
          resumable: false,
          metadata: {
            contentType: entry.contentType,
            cacheControl: "private, max-age=300",
          },
        });
        savedFiles.push(entry.name);
      }
    } catch (error) {
      await deletePackageFiles(packagePrefix, savedFiles);
      throw error;
    }

    const cover = entries.find((entry) =>
      /^cover\.(png|jpe?g|webp|svg)$/i.test(entry.name),
    );

    return {
      packagePrefix,
      packageFiles: entries.map((entry) => entry.name),
      coverPath: cover?.name ?? null,
    };
  } finally {
    if (archiveFile) {
      await archiveFile.delete().catch(() => undefined);
    }
  }
}

export async function deletePackageFiles(
  packagePrefix: string,
  packageFiles: string[],
): Promise<void> {
  await Promise.all(
    packageFiles.map(async (name) => {
      const file = await storage
        .getObjectEntityFile(`${packagePrefix}/${name}`)
        .catch(() => null);
      if (file) await file.delete().catch(() => undefined);
    }),
  );
}

function readArchive(buffer: Buffer): Promise<ExtractedEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      {
        lazyEntries: true,
        autoClose: true,
        validateEntrySizes: true,
      },
      (openError, zipFile) => {
        if (openError || !zipFile) {
          reject(
            new ArchiveValidationError(
              "This file is not a readable ZIP storybook.",
            ),
          );
          return;
        }

        const entries: ExtractedEntry[] = [];
        let unpackedBytes = 0;
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          zipFile.close();
          reject(error);
        };

        zipFile.on("error", () => {
          fail(
            new ArchiveValidationError(
              "This file is not a readable ZIP storybook.",
            ),
          );
        });
        zipFile.on("entry", (entry) => {
          if (entry.fileName.endsWith("/")) {
            zipFile.readEntry();
            return;
          }

          if (!isSafeEntryPath(entry.fileName)) {
            fail(
              new ArchiveValidationError(
                "The ZIP contains an unsafe or unsupported file path.",
              ),
            );
            return;
          }
          if (entries.length >= MAX_ENTRIES) {
            fail(
              new ArchiveValidationError(
                "A ZIP may contain up to 2,500 files.",
              ),
            );
            return;
          }
          if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
            fail(
              new ArchiveValidationError(
                "Each storybook asset must be 24 MB or smaller.",
              ),
            );
            return;
          }

          zipFile.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail(
                new ArchiveValidationError(
                  "A file in this ZIP could not be read.",
                ),
              );
              return;
            }

            const chunks: Buffer[] = [];
            let entryBytes = 0;
            stream.on("data", (chunk: Buffer) => {
              entryBytes += chunk.length;
              unpackedBytes += chunk.length;
              if (unpackedBytes > MAX_UNPACKED_BYTES) {
                stream.destroy();
                fail(
                  new ArchiveValidationError(
                    "The unpacked storybook must be 120 MB or smaller.",
                  ),
                );
                return;
              }
              chunks.push(Buffer.from(chunk));
            });
            stream.once("error", () => {
              if (!settled) {
                fail(
                  new ArchiveValidationError(
                    "A file in this ZIP could not be read.",
                  ),
                );
              }
            });
            stream.once("end", () => {
              if (settled) return;
              if (entryBytes !== entry.uncompressedSize) {
                fail(
                  new ArchiveValidationError(
                    "A file in this ZIP has an invalid size.",
                  ),
                );
                return;
              }
              entries.push({
                name: entry.fileName,
                contentType: contentTypeFor(entry.fileName),
                data: Buffer.concat(chunks, entryBytes),
              });
              zipFile.readEntry();
            });
          });
        });
        zipFile.once("end", () => {
          if (settled) return;
          settled = true;
          resolve(entries);
        });
        zipFile.readEntry();
      },
    );
  });
}

function isSafeEntryPath(name: string): boolean {
  if (
    !name ||
    name.length > 500 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    /^[A-Za-z]:/.test(name)
  ) {
    return false;
  }
  return name.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function contentTypeFor(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    xml: "application/xml; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    mp4: "video/mp4",
    webm: "video/webm",
    wasm: "application/wasm",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    txt: "text/plain; charset=utf-8",
  };
  return (extension && types[extension]) || "application/octet-stream";
}
