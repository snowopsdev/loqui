import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The UI type ramp (text-ui, text-caption, …) is a font size. Without this,
// tailwind-merge files unknown text-* classes as colours and drops the size
// whenever a text colour follows it.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "title", "heading", "body", "ui", "caption", "micro"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
