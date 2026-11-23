# Changelog

## Unreleased

- The corpus builder reports invalid project visibility, document titles, type
  counts, artifact references, and incomplete optional datasets before writing
  a bake.
- The re-bake report rejects missing required sections and reports changes to
  the relative order of curated projects.

- The release probe preserves equals signs in inline option values. For
  example, `--query=a=b` searches for `a=b`, and `--limit=1=x` raises a
  limit error.
