import { Marked, type Token, type Tokens } from "@earendil-works/pi-tui";

export interface CodeBlock {
  language: string;
  code: string;
}

// Marked expands tabs while dedenting list items. Protect code-body tabs first,
// but leave the surrounding Markdown indentation available to its parser.
function protectTabs(source: string, marker: string): string {
  let fence: { character: string; length: number; indent: number } | undefined;
  return source.split("\n").map((line) => {
    const prefix = /^(?: {0,3}>[ \t]?)*/.exec(line)![0];
    const body = line.slice(prefix.length);
    if (!fence) {
      const opening = /^([ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?)(`{3,}|~{3,})(.*)$/.exec(body);
      if (opening && !(opening[2][0] === "`" && opening[3].includes("`"))) {
        fence = { character: opening[2][0], length: opening[2].length, indent: opening[1].length };
      }
      return line;
    }
    const closing = /^[ \t]*(`+|~+)[ \t]*$/.exec(body);
    if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
      fence = undefined;
      return line;
    }
    const indentation = /^ */.exec(body)![0].length;
    const keep = Math.min(fence.indent, indentation);
    return prefix + body.slice(0, keep) + body.slice(keep).replaceAll("\t", marker);
  }).join("\n");
}

export function sourceBlocks(source: string): CodeBlock[] {
  let marker = "\uE000";
  while (source.includes(marker)) marker += "\uE000";
  const tokens = new Marked().lexer(protectTabs(source, marker));
  const blocks: CodeBlock[] = [];
  function visit(tokens: Token[]): void {
    for (const token of tokens) {
      if (token.type === "code") {
        const code = token as Tokens.Code;
        const opening = /^ {0,3}(`{3,}|~{3,})/.exec(code.raw);
        if (!opening) continue;
        let text = code.text.replaceAll(marker, "\t");
        const lastLine = code.raw.split("\n").at(-1) ?? "";
        if (lastLine.length > 0 && lastLine.length < opening[1].length && lastLine === opening[1][0].repeat(lastLine.length)) {
          text = text.slice(0, -lastLine.length).replace(/\n$/, "");
        }
        blocks.push({ language: code.lang ?? "", code: text });
      } else if (token.type === "list") {
        for (const item of (token as Tokens.List).items) visit(item.tokens);
      } else if (token.type === "blockquote") {
        visit((token as Tokens.Blockquote).tokens);
      }
    }
  }
  visit(tokens);
  return blocks;
}
