import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * `cn` joins class names with `clsx` and resolves Tailwind utility
 * conflicts with `tailwind-merge`. Use it anywhere a component accepts
 * an externally-supplied className and may need to override the
 * default Tailwind classes.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
