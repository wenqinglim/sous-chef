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

  test("returns a top-level JSON array intact (not truncated to first object)", () => {
    const arr = `[{"a":1},{"b":2}]`;
    expect(extractJsonText(arr)).toBe(arr);
    expect(JSON.parse(extractJsonText(arr))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("slices a prose-wrapped top-level array correctly", () => {
    const noisy = `Here you go:\n[{"a":1},{"b":2}]\nHope that helps!`;
    expect(JSON.parse(extractJsonText(noisy))).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
