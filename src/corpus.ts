// The baked corpus + small typed accessors. corpus.generated.ts is produced by
// scripts/build-corpus.mjs from the public portfolio-index artifacts; a tiny
// placeholder is committed so the project type-checks before the first build.

import generated from "./corpus.generated";
import type { Corpus, FullDoc, IndexRecord } from "./types";

export const corpus: Corpus = generated;

export const allDocuments = (): FullDoc[] => Object.values(corpus.documents);
export const documentById = (id: string): FullDoc | undefined =>
	corpus.documents[id];
export const indexRecords = (): IndexRecord[] => corpus.index.documents;

export * from "./types";
