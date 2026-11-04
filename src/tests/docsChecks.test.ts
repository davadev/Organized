import { describe, expect, it } from "vitest";
import { readmePlaceholders } from "../../scripts/lib/docsChecks.mjs";

describe("README placeholder check", () => {
  it("finds template leftovers the plugin review flags", () => {
    const found = readmePlaceholders("<!-- hidden --> TODO write this [description] and <your vault>/x");
    expect(found).toEqual(["HTML comment: <!-- hidden -->", "placeholder word: TODO", "bracket slot: [description]", "angle-bracket slot: <your vault>"]);
    expect(readmePlaceholders("a comment `<!--organized:id-->` in prose")).toEqual(["HTML comment: <!--organized:id-->"]);
  });
  it("accepts real HTML, fenced code and ordinary prose", () => {
    expect(readmePlaceholders('<table><tr><td><img src="a.png" alt="x"><br><sub>Day</sub></td></tr></table>\n<a id="top"></a>\nA todo list.')).toEqual([]);
    expect(readmePlaceholders("```\n<!-- inside a fence --> <your vault>\n```\nplain")).toEqual([]);
  });
});
