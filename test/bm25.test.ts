import { describe, expect, it } from "vitest";
import { Bm25, snippet, tokenize } from "../src/bm25";

describe("tokenize", () => {
	it("lowercases and splits on non-alphanumerics", () => {
		expect(tokenize("Hello, World! v2")).toEqual(["hello", "world", "v2"]);
	});
	it("returns [] for empty input", () => {
		expect(tokenize("")).toEqual([]);
	});
});

describe("Bm25", () => {
	const docs = [
		{
			id: "a",
			title: "Verification capital",
			text: "the scarce resource is verification not production",
		},
		{ id: "b", title: "The flywheel", text: "a flywheel of builds and checks" },
		{ id: "c", title: "Rust memory", text: "ownership and borrowing in rust" },
	];
	const idx = new Bm25(docs);

	it("ranks the title match first", () => {
		const hits = idx.search("verification");
		expect(hits[0]?.id).toBe("a");
	});
	it("returns nothing for an out-of-corpus term", () => {
		expect(idx.search("kubernetes")).toEqual([]);
	});
	it("respects the limit", () => {
		expect(idx.search("the", 1).length).toBeLessThanOrEqual(1);
	});
});

describe("snippet", () => {
	it("centers on the query term with ellipses", () => {
		const s = snippet("alpha beta gamma delta epsilon", "gamma", 5);
		expect(s).toContain("gamma");
		expect(s.startsWith("…")).toBe(true);
	});
	it("falls back to the head when no term matches", () => {
		expect(snippet("alpha beta", "zeta")).toBe("alpha beta");
	});
	it("returns '' for empty body", () => {
		expect(snippet("", "x")).toBe("");
	});
});
