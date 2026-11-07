import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RichTextContent } from "@/components/ui/rich-text-content";
import { sanitizeRichText } from "@/lib/rich-text-sanitize";
import { extractMentionedTeamMemberIds } from "@/lib/text-format";

// Real output shapes from the Tiptap extensions RichTextEditor loads
// (StarterKit, TaskList/TaskItem, TextStyle + Color, Highlight multicolor,
// Mention), copied from each extension's renderHTML in node_modules/@tiptap.
const MENTION =
  '<span class="mention" data-type="mention" data-id="cm1abc2def3ghi" data-label="Jordan Avery" data-mention-suggestion-char="@">@Jordan Avery</span>';
const LINK = '<a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/path?a=1&amp;b=2">the brief</a>';

function expectNoScriptSurface(html: string) {
  const lower = html.toLowerCase();
  expect(lower).not.toMatch(/<script|<img|<svg|<iframe|<object|<embed|<style|<form|<base|<meta|<link/);
  expect(lower).not.toMatch(/\son[a-z]+\s*=/);
  expect(lower).not.toContain("javascript:");
  expect(lower).not.toContain("data:");
  expect(lower).not.toContain("expression(");
  expect(lower).not.toContain("url(");
}

describe("sanitizeRichText: keeps what the editor makes", () => {
  it.each([
    ["plain paragraph", "<p>Call the client back about the invoice.</p>"],
    ["inline marks", "<p><strong>bold</strong> <em>italic</em> <u>underline</u> <s>strike</s> <code>inline code</code></p>"],
    ["headings", "<h1>One</h1><h2>Two</h2><h3>Three</h3>"],
    ["bulleted and numbered lists", '<ul><li><p>one</p></li><li><p>two</p></li></ul><ol start="3"><li><p>three</p></li></ol>'],
    ["quote", "<blockquote><p>As discussed on the call</p></blockquote>"],
    ["code block with a language", '<pre><code class="language-js">const ok = 1 &lt; 2 &amp;&amp; true;</code></pre>'],
    ["link", `<p>See ${LINK}</p>`],
    ["mailto link", '<p><a target="_blank" rel="noopener noreferrer nofollow" href="mailto:team@example.com">email us</a></p>'],
    ["relative app link", '<p><a target="_blank" rel="noopener noreferrer nofollow" href="/clients/abc/tasks?taskId=t1">task</a></p>'],
    ["mention", `<p>Thanks ${MENTION}!</p>`],
    ["escaped text that looks like tags", "<p>1 &lt; 2 and &lt;script&gt; is just text</p>"],
    ["legacy plain-text comment", "Call Jordan re: the invoice\nThen close it out"],
    ["empty paragraph", "<p></p>"],
  ])("keeps %s exactly", (_label, html) => {
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("keeps text colour and highlight colour exactly", () => {
    const html =
      '<p><span style="color: #dc2626">red</span> <span style="color: rgb(37, 99, 235)">blue</span> <mark data-color="#fef08a" style="background-color: #fef08a; color: inherit">marked</mark></p>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("keeps checklists, line breaks and rules (void tags come back as the equivalent <br /> form)", () => {
    const html =
      '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done</p></div></li><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>to do</p></div></li></ul><p>line one<br>line two</p><hr>';
    expect(sanitizeRichText(html)).toBe(
      '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked" /><span></span></label><div><p>done</p></div></li><li data-checked="false" data-type="taskItem"><label><input type="checkbox" /><span></span></label><div><p>to do</p></div></li></ul><p>line one<br />line two</p><hr />'
    );
  });

  it("still lets mention notifications find the mentioned person", () => {
    const html = `<p>${MENTION} please review</p>`;
    expect(extractMentionedTeamMemberIds(sanitizeRichText(html))).toEqual(["cm1abc2def3ghi"]);
  });
});

describe("sanitizeRichText: strips script and other dangerous markup", () => {
  it.each([
    ["img onerror", "<p>hi</p><img src=x onerror=alert(document.cookie)>", "<p>hi</p>"],
    ["script tag", "<p>hi<script>alert(1)</script></p>", "<p>hi</p>"],
    ["svg onload", '<svg onload="alert(1)"><circle r="5"></circle></svg><p>ok</p>', "<p>ok</p>"],
    ["iframe", '<iframe src="https://evil.example"></iframe><p>ok</p>', "<p>ok</p>"],
    ["object and embed", '<object data="x.swf"></object><embed src="x.swf"><p>ok</p>', "<p>ok</p>"],
    ["style tag", "<style>body{display:none}</style><p>ok</p>", "<p>ok</p>"],
    ["form and text input", '<form action="https://evil.example"><input type="text" name="password"></form><p>ok</p>', "<p>ok</p>"],
    ["base and meta", '<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"><p>ok</p>', "<p>ok</p>"],
  ])("removes %s", (_label, input, expected) => {
    const out = sanitizeRichText(input);
    expect(out).toBe(expected);
    expectNoScriptSurface(out);
  });

  it.each([
    ["javascript:", '<a href="javascript:alert(1)">x</a>'],
    ["mixed-case javascript:", '<a href="JaVaScRiPt:alert(1)">x</a>'],
    ["javascript: behind leading spaces", '<a href="   javascript:alert(1)">x</a>'],
    ["javascript: split by a tab entity", '<a href="java&#x09;script:alert(1)">x</a>'],
    ["entity-encoded javascript:", '<a href="&#106;avascript:alert(1)">x</a>'],
    ["data: html", '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>'],
    ["vbscript:", '<a href="vbscript:msgbox(1)">x</a>'],
  ])("drops a %s link target but keeps the link text", (_label, input) => {
    const out = sanitizeRichText(input);
    expect(out).toBe('<a target="_blank" rel="noopener noreferrer nofollow">x</a>');
    expectNoScriptSurface(out);
  });

  it("removes event handlers from tags that are otherwise allowed", () => {
    const input =
      '<p onclick="alert(1)">a</p><a href="https://ok.example" onmouseover="alert(1)">b</a>' +
      '<span class="mention" data-type="mention" data-id="x" data-label="X" data-mention-suggestion-char="@" onfocus="alert(1)" tabindex="0" autofocus>@X</span>' +
      '<input type="checkbox" onchange="alert(1)" autofocus onfocus="alert(1)">';
    const out = sanitizeRichText(input);
    expect(out).toBe(
      '<p>a</p><a target="_blank" rel="noopener noreferrer nofollow" href="https://ok.example">b</a>' +
        '<span class="mention" data-type="mention" data-id="x" data-label="X" data-mention-suggestion-char="@">@X</span>' +
        '<input type="checkbox" />'
    );
    expectNoScriptSurface(out);
  });

  it("drops any style that is not exactly the editor's colour style, including expression() and url()", () => {
    const input =
      '<span style="color: expression(alert(1))">a</span>' +
      '<span style="background-image: url(javascript:alert(1)); color: #16a34a">b</span>' +
      '<span style="position: fixed; inset: 0; color: red">c</span>' +
      '<p style="color: red">d</p>' +
      '<mark data-color="red; position: fixed; inset: 0" style="background-color: #fef08a; color: inherit; position: fixed">e</mark>';
    const out = sanitizeRichText(input);
    expect(out).toBe("<span>a</span><span>b</span><span>c</span><p>d</p><mark>e</mark>");
    expectNoScriptSurface(out);
  });

  it("forces a new-tab link to carry noopener noreferrer, whatever was sent", () => {
    const out = sanitizeRichText('<a href="https://ok.example" target="_self" rel="opener">x</a>');
    expect(out).toBe('<a target="_blank" rel="noopener noreferrer nofollow" href="https://ok.example">x</a>');
  });

  it("drops classes and attributes the editor never makes", () => {
    const out = sanitizeRichText(
      '<p class="fixed inset-0" id="x" title="t" data-foo="1">a</p><span class="mention fixed inset-0" data-type="mention" data-id="m1">@M</span><pre><code class="language-ts hidden">b</code></pre>'
    );
    expect(out).toBe(
      '<p>a</p><span class="mention" data-type="mention" data-id="m1">@M</span><pre><code class="language-ts">b</code></pre>'
    );
  });

  it("keeps escaped text escaped when a tag is unwrapped (no tag can be rebuilt from text)", () => {
    const out = sanitizeRichText('<div><noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript></div>');
    expectNoScriptSurface(out);
  });
});

describe("RichTextContent", () => {
  it("cleans stored HTML again at render, so rows saved before the fix are safe too", () => {
    const markup = renderToStaticMarkup(
      createElement(RichTextContent, { html: `<p>hi ${MENTION}</p><img src=x onerror="alert(1)"><script>alert(2)</script>` })
    );
    expect(markup).toContain(`<p>hi ${MENTION}</p>`);
    expectNoScriptSurface(markup);
  });
});
