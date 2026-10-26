import {
  DeleteBookParams,
  GetAdminSummaryResponse,
  GetBookParams,
  GetBookReaderAssetParams,
  GetBookResponse,
  ImportBookBody,
  ImportBookResponse,
  ListAdminBooksResponse,
  ListBookCategoriesResponse,
  ListBooksQueryParams,
  ListBooksResponse,
  UpdateBookBody,
  UpdateBookParams,
  UpdateBookResponse,
} from "@workspace/api-zod";
import { db, storybookBooksTable } from "@workspace/db";
import { and, arrayContains, desc, eq, ilike, or } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { deletePackageFiles, storeBookPackage, ArchiveValidationError } from "../lib/bookArchive";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();
const storage = new ObjectStorageService();

router.get("/books", async (req: Request, res: Response): Promise<void> => {
  const query = ListBooksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Search filters are invalid." });
    return;
  }

  const conditions = [eq(storybookBooksTable.published, true)];
  const search = query.data.search?.trim();
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(
        ilike(storybookBooksTable.title, term),
        ilike(storybookBooksTable.author, term),
        ilike(storybookBooksTable.description, term),
      )!,
    );
  }
  if (query.data.category) {
    conditions.push(
      arrayContains(storybookBooksTable.categories, [query.data.category]),
    );
  }

  const books = await db
    .select()
    .from(storybookBooksTable)
    .where(and(...conditions))
    .orderBy(desc(storybookBooksTable.createdAt));

  res.json(ListBooksResponse.parse(books.map(toApiBook)));
});

router.get(
  "/books/categories",
  async (_req: Request, res: Response): Promise<void> => {
    const rows = await db
      .select({ categories: storybookBooksTable.categories })
      .from(storybookBooksTable)
      .where(eq(storybookBooksTable.published, true));
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const category of row.categories) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
    const categories = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(ListBookCategoriesResponse.parse(categories));
  },
);

router.get(
  "/books/:bookId",
  async (req: Request, res: Response): Promise<void> => {
    const params = GetBookParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Book identifier is invalid." });
      return;
    }
    const [book] = await db
      .select()
      .from(storybookBooksTable)
      .where(
        and(
          eq(storybookBooksTable.id, params.data.bookId),
          eq(storybookBooksTable.published, true),
        ),
      );
    if (!book) {
      res.status(404).json({ error: "Storybook not found." });
      return;
    }
    res.json(GetBookResponse.parse(toApiBook(book)));
  },
);

router.get(
  "/books/:bookId/reader/*assetPath",
  async (req: Request, res: Response): Promise<void> => {
    const assetPath = Array.isArray(req.params.assetPath)
      ? req.params.assetPath.join("/")
      : req.params.assetPath;
    const params = GetBookReaderAssetParams.safeParse({
      bookId: req.params.bookId,
      assetPath,
    });
    if (!params.success || !isSafeAssetPath(assetPath)) {
      res.status(404).json({ error: "Storybook asset not found." });
      return;
    }

    const [book] = await db
      .select()
      .from(storybookBooksTable)
      .where(
        and(
          eq(storybookBooksTable.id, params.data.bookId),
          eq(storybookBooksTable.published, true),
          eq(storybookBooksTable.readerType, "html5"),
        ),
      );
    if (!book?.packagePrefix || !book.packageFiles.includes(assetPath)) {
      res.status(404).json({ error: "Storybook asset not found." });
      return;
    }

    try {
      const file = await storage.getObjectEntityFile(
        `${book.packagePrefix}/${assetPath}`,
      );
      const response = await storage.downloadObject(file, 300);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=300");

      const contentType = String(response.headers.get("content-type") ?? "");
      if (contentType.toLowerCase().includes("text/html")) {
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'",
        );
      }

      if (response.body) {
        Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        ).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Storybook asset not found." });
        return;
      }
      req.log.error({ err: error }, "Failed to serve storybook asset");
      res.status(500).json({ error: "Could not load this storybook asset." });
    }
  },
);

router.get(
  "/admin/summary",
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    const books = await db
      .select({
        published: storybookBooksTable.published,
        categories: storybookBooksTable.categories,
      })
      .from(storybookBooksTable);
    const publishedBooks = books.filter((book) => book.published).length;
    const categories = new Set(
      books.flatMap((book) => book.categories),
    ).size;
    res.json(
      GetAdminSummaryResponse.parse({
        totalBooks: books.length,
        publishedBooks,
        draftBooks: books.length - publishedBooks,
        categories,
      }),
    );
  },
);

router.get(
  "/admin/books",
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    const books = await db
      .select()
      .from(storybookBooksTable)
      .orderBy(desc(storybookBooksTable.createdAt));
    res.json(ListAdminBooksResponse.parse(books.map(toApiBook)));
  },
);

router.post(
  "/admin/books/import",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ImportBookBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Book details are incomplete or invalid." });
      return;
    }
    if (parsed.data.minAge > parsed.data.maxAge) {
      res.status(400).json({ error: "The maximum age must be at least the minimum age." });
      return;
    }

    const bookId = `book_${randomUUID()}`;
    let storedPackage;
    try {
      storedPackage = await storeBookPackage(
        parsed.data.archiveObjectPath,
        bookId,
      );
      const categories = [
        ...new Set(parsed.data.categories.map((item) => item.trim()).filter(Boolean)),
      ];
      const [book] = await db
        .insert(storybookBooksTable)
        .values({
          id: bookId,
          title: parsed.data.title.trim(),
          author: parsed.data.author.trim(),
          description: parsed.data.description.trim(),
          categories,
          minAge: parsed.data.minAge,
          maxAge: parsed.data.maxAge,
          readingMinutes: parsed.data.readingMinutes,
          readerType: "html5",
          published: false,
          coverStyle: categories[0]?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "story",
          packagePrefix: storedPackage.packagePrefix,
          packageFiles: storedPackage.packageFiles,
          coverPath: storedPackage.coverPath,
          samplePages: null,
        })
        .returning();
      res
        .status(201)
        .json(ImportBookResponse.parse(toApiBook(book)));
    } catch (error) {
      if (storedPackage) {
        await deletePackageFiles(
          storedPackage.packagePrefix,
          storedPackage.packageFiles,
        );
      }
      if (error instanceof ArchiveValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Failed to import storybook");
      res.status(500).json({ error: "Could not import this storybook. Please try again." });
    }
  },
);

router.patch(
  "/admin/books/:bookId",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const params = UpdateBookParams.safeParse(req.params);
    const parsed = UpdateBookBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Book details are invalid." });
      return;
    }
    const [current] = await db
      .select()
      .from(storybookBooksTable)
      .where(eq(storybookBooksTable.id, params.data.bookId));
    if (!current) {
      res.status(404).json({ error: "Storybook not found." });
      return;
    }
    const nextMin = parsed.data.minAge ?? current.minAge;
    const nextMax = parsed.data.maxAge ?? current.maxAge;
    if (nextMin > nextMax) {
      res.status(400).json({ error: "The maximum age must be at least the minimum age." });
      return;
    }

    const updates = {
      ...parsed.data,
      ...(parsed.data.title === undefined ? {} : { title: parsed.data.title.trim() }),
      ...(parsed.data.author === undefined ? {} : { author: parsed.data.author.trim() }),
      ...(parsed.data.description === undefined ? {} : { description: parsed.data.description.trim() }),
      ...(parsed.data.categories === undefined
        ? {}
        : {
            categories: [
              ...new Set(parsed.data.categories.map((item) => item.trim()).filter(Boolean)),
            ],
          }),
      updatedAt: new Date(),
    };
    const [book] = await db
      .update(storybookBooksTable)
      .set(updates)
      .where(eq(storybookBooksTable.id, params.data.bookId))
      .returning();
    res.json(UpdateBookResponse.parse(toApiBook(book)));
  },
);

router.delete(
  "/admin/books/:bookId",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const params = DeleteBookParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Book identifier is invalid." });
      return;
    }
    const [book] = await db
      .delete(storybookBooksTable)
      .where(eq(storybookBooksTable.id, params.data.bookId))
      .returning();
    if (!book) {
      res.status(404).json({ error: "Storybook not found." });
      return;
    }
    if (book.packagePrefix && book.packageFiles.length) {
      await deletePackageFiles(book.packagePrefix, book.packageFiles);
    }
    res.sendStatus(204);
  },
);

function toApiBook(book: typeof storybookBooksTable.$inferSelect) {
  const coverUrl = book.coverPath
    ? `/api/books/${encodeURIComponent(book.id)}/reader/${book.coverPath
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`
    : null;
  return {
    ...book,
    coverUrl,
    createdAt: book.createdAt.toISOString(),
    updatedAt: book.updatedAt.toISOString(),
  };
}

function isSafeAssetPath(assetPath: string): boolean {
  return (
    assetPath.length > 0 &&
    assetPath.length <= 500 &&
    !assetPath.startsWith("/") &&
    !assetPath.includes("\\") &&
    !assetPath.includes("\0") &&
    assetPath.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export default router;
