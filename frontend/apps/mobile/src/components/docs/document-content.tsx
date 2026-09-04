/**
 * Read-only rendering of a TipTap/ProseMirror document body on mobile.
 *
 * Extracted from the doc viewer screen for feature 043, which needs the same rendering in
 * a modal over a ritual instance. It is an extraction rather than a copy on purpose: two
 * renderers would drift, and a worker reading a procedure would see a document formatted
 * differently from the same document opened in Docs.
 *
 * Editing stays on the web. There is no editable mode here and there should not be one.
 */

import React from "react";
import { StyleSheet, Text } from "react-native";
import { lightPalette, mobileTypography } from "@tech-office/theme-tokens";

/**
 * Plain text from TipTap/ProseMirror JSON. Block-level nodes get a trailing newline so a
 * document reads as paragraphs rather than one run-on line.
 */
export function extractDocumentText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) {
    const childText = node.content.map(extractDocumentText).join("");
    if (
      node.type === "paragraph" ||
      node.type === "heading" ||
      node.type === "listItem"
    ) {
      return childText + "\n";
    }
    return childText;
  }
  return "";
}

/**
 * Parses stored content — a JSON string or an already-parsed object — into display text.
 * Content that will not parse is shown verbatim rather than swallowed: a document that
 * renders as blank looks to the reader like a document nobody wrote.
 */
export function documentContentToText(content: unknown): string {
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    return extractDocumentText(parsed);
  } catch {
    return typeof content === "string" ? content : "";
  }
}

export function DocumentContent({ text, testID }: { text: string; testID?: string }) {
  return (
    <Text selectable style={styles.body} testID={testID}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    lineHeight: 24,
    color: lightPalette.text.primary,
  },
});
