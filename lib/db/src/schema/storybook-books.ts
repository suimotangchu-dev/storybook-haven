import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type SampleBookPage = {
  title: string;
  text: string;
  imageAlt: string | null;
};

export const storybookBooksTable = pgTable("storybook_books", {
  id: varchar("id", { length: 80 }).primaryKey(),
  title: varchar("title", { length: 120 }).notNull(),
  author: varchar("author", { length: 120 }).notNull(),
  description: varchar("description", { length: 1000 }).notNull(),
  categories: text("categories").array().notNull().default(sql`'{}'::text[]`),
  minAge: integer("min_age").notNull(),
  maxAge: integer("max_age").notNull(),
  readingMinutes: integer("reading_minutes").notNull(),
  readerType: varchar("reader_type", { length: 16 }).notNull(),
  published: boolean("published").notNull().default(false),
  coverStyle: varchar("cover_style", { length: 40 }).notNull().default("story"),
  coverPath: text("cover_path"),
  packagePrefix: text("package_prefix"),
  packageFiles: jsonb("package_files").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  samplePages: jsonb("sample_pages").$type<SampleBookPage[] | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStorybookSchema = createInsertSchema(storybookBooksTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertStorybook = z.infer<typeof insertStorybookSchema>;
export type Storybook = typeof storybookBooksTable.$inferSelect;
