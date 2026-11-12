# Static runtime generation

The editable native ESM source stays in `src/`. The published HTML uses generated,
content-hashed ESM entries and shared chunks. Vercel installs and builds nothing.

Install the isolated, pinned release tool once:

```sh
npm ci --prefix tools/runtime
```

After changing any runtime source or its import query version:

```sh
node tools/runtime/build.mjs
node tools/runtime/build.mjs --check
```

`--check` does not write files. It rebuilds in memory and rejects stale output,
manifest, HTML references, source hashes, and leftover generated chunks. A release
must include the generated files and manifest together with the source change.

All generated modules remain directly under `src/` so existing `import.meta.url`
paths to `../tokens.json` and `../assets/` keep their meaning. WalletConnect, QR,
and chart vendors remain external dynamic imports. Early quote and UI entries
share service, clock and balance modules; their original cache deadlines remain
unchanged. Only generated hash assets receive immutable HTTP caching.

`compatibility.json` approves the exact runtime files from the previous public
release, with its commit and frontend-manifest SHA256. Keep those original bytes
in `src/`: an already-open tab may still need a delayed dynamic import after a
new deployment. The generator rejects missing or modified approved files, while
removing unapproved intermediate chunks. The current manifest records this list
as `compatibilityAssets`; current HTML, preloads and imports use only the new
`files` graph. Update the one previous-release list deliberately after confirming
which release was actually public; do not populate it from an unpublished build.

The manifest also records byte-identical, content-addressed copies of the three
stylesheets and ethers vendor. Original source URLs remain available for compatibility;
only the hash copies use immutable caching. Their relative directory is preserved.
