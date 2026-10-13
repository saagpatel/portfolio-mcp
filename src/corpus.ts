// The baked corpus + small typed accessors. corpus.generated.ts is produced by
// scripts/build-corpus.mjs from the public portfolio-index artifacts.

import generated from "./corpus.generated";
import type { Corpus } from "./types";

export const corpus: Corpus = generated;

export * from "./types";
