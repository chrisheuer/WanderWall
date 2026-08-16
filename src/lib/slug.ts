import { customAlphabet } from "nanoid";

const suffix = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6);

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "gallery";
}

export function uniqueSlug(title: string): string {
  return `${slugify(title)}-${suffix()}`;
}
