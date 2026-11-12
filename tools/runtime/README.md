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
