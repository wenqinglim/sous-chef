import { extractJsonText } from "@/lib/extractors/llm-fallback";

// extractJsonText pulls the JSON object out of an LLM response, tolerating the
// markdown code fence / prose Claude sometimes adds despite being told not to.

describe("extractJsonText", () => {
  const obj = `{\n  "title": "Garlic Noodles",\n  "base_servings": 2\n}`;

  test("returns clean JSON unchanged", () => {
    expect(extractJsonText(obj)).toBe(obj);
    expect(() => JSON.parse(extractJsonText(obj))).not.toThrow();
  });

  test("strips a ```json fenced response (the reported failure)", () => {
    const fenced = "```json\n" + obj + "\n```";
    expect(JSON.parse(extractJsonText(fenced))).toEqual({
      title: "Garlic Noodles",
      base_servings: 2,
    });
  });

  test("strips a bare ``` fence with no language tag", () => {
    const fenced = "```\n" + obj + "\n```";
    expect(JSON.parse(extractJsonText(fenced))).toEqual({
      title: "Garlic Noodles",
      base_servings: 2,
    });
  });

  test("drops leading/trailing prose around the object", () => {
    const noisy = `Sure! Here is the recipe:\n${obj}\nLet me know if you need more.`;
    expect(JSON.parse(extractJsonText(noisy))).toEqual({
      title: "Garlic Noodles",
      base_servings: 2,
    });
  });

  test("handles a fence wrapped in extra whitespace", () => {
    const fenced = "   ```json\n" + obj + "\n```   ";
    expect(JSON.parse(extractJsonText(fenced))).toEqual({
      title: "Garlic Noodles",
      base_servings: 2,
    });
  });

  test("returns trimmed input when there is no object", () => {
    expect(extractJsonText("  no json here  ")).toBe("no json here");
  });
});
