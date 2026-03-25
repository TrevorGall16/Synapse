import type { ReactNode } from "react";

/**
 * Split text into plain strings and interactive hashtag buttons.
 * Tokens matching /^#\w+/ become clickable buttons that call `onTag`.
 */
export function parseHashtags(text: string, onTag: (tag: string) => void): ReactNode[] {
  return text.split(/(\s+)/).map((token, i) => {
    if (/^#\w+/.test(token)) {
      return (
        <button
          key={i}
          type="button"
          onClick={(e) => { e.stopPropagation(); onTag(token); }}
          className="text-purple-300 hover:text-purple-200 hover:underline underline-offset-2 transition-colors"
        >
          {token}
        </button>
      );
    }
    return token;
  });
}
