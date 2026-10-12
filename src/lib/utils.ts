import {  clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type {ClassValue} from "clsx";

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs));
}

// Keeps hyphenated words whole when a line wraps ("T‑Shirt", never "T-" then "Shirt"): U+2011 is a
// hyphen that lines don't break at. For product names beside a price.
export function keepHyphens(text: string) {
  return text.replace(/-/gu, "\u2011");
}
