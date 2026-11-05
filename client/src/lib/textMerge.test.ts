import { describe, expect, it } from "vitest";
import { apply, diff, merge, transformIndex } from "./textMerge";

describe("diff/apply", () => {
  it("round-trips arbitrary edits", () => {
    const cases: [string, string][] = [
      ["", "hello"],
      ["hello", ""],
      ["hello world", "hello brave world"],
      ["abc", "abXc"],
      ["aaaa", "aaa"],
      ["same", "same"]
    ];
    for (const [a, b] of cases) {
      expect(apply(a, diff(a, b))).toBe(b);
    }
  });
});

describe("merge", () => {
  it("keeps both edits when they touch different regions", () => {
    const base = "hello world";
    const local = "hello brave world"; // insert in middle
    const remote = "hello world!"; // append
    expect(merge(base, local, remote).text).toBe("hello brave world!");
  });

  it("keeps both edits when the remote one comes first", () => {
    const base = "one two three";
    const local = "one two three four";
    const remote = "zero one two three";
    expect(merge(base, local, remote).text).toBe("zero one two three four");
  });

  it("takes the remote text when there are no local edits", () => {
    expect(merge("a", "a", "ab").text).toBe("ab");
  });

  it("keeps local text when the remote did not change", () => {
    expect(merge("a", "ab", "a").text).toBe("ab");
  });

  it("does not drop local typing when edits overlap", () => {
    const base = "abc";
    const local = "aXc"; // replace b with X
    const remote = "aYc"; // replace b with Y
    const { text } = merge(base, local, remote);
    expect(text).toContain("X");
    expect(text).toContain("Y");
  });

  it("models two users typing at the same spot", () => {
    const { text } = merge("", "hi", "yo");
    expect(text).toBe("yohi");
  });
});

describe("transformIndex", () => {
  it("shifts positions after an insertion", () => {
    const splice = diff("hello", "XXhello");
    expect(transformIndex(0, splice)).toBe(0);
    expect(transformIndex(3, splice)).toBe(5);
  });

  it("leaves positions before the edit alone", () => {
    const splice = diff("hello", "hello world");
    expect(transformIndex(2, splice)).toBe(2);
  });
});
