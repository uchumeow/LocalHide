# LocalHide Development

## Build

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest (pure-logic unit tests)
npm run build       # -> dist/LocalHide/{manifest.json,index.js}
```

The bundle is a Rollup IIFE mapped onto Kettu's runtime globals:

| import | runtime global |
|---|---|
| `@vendetta/*` | `vendetta.*` |
| `react` | `window.React` |
| `react-native` | `vendetta.metro.common.ReactNative` |

Output shape is the proven Kettu/Vendetta eval contract: `vendetta=>{return (function(o,…){…})({},vendetta.patcher,…);}` returning `{default: pluginInstance}`. Installable by directory URL (`<host>/LocalHide/` with `manifest.json` + `index.js`, polymanifest + sha256 `hash`).

Dependencies shipped inside the bundle: `@noble/ciphers` (XChaCha20-Poly1305) and `@noble/hashes` (scrypt, HKDF, HMAC, SHA-256, CSPRNG).

## Architecture

```
src/
├── index.tsx            entry: onLoad/onUnload orchestration, per-feature isolation
├── settings.tsx         plugin settings page (Forms-based)
├── lib/
│   ├── metro.ts         ALL Discord module lookups (centralized compat layer)
│   ├── logger.ts        diagnostics (ids/counts only)
│   ├── snapshot.ts      Discord message → archive snapshot conversion
│   └── modal.tsx        full-screen pushLazy modal helper
├── crypto/crypto.ts     scrypt+HKDF KDF, XChaCha20-Poly1305 AEAD, envelope wrap
├── storage/
│   ├── fs.ts            native file adapter + serialized write queue
│   ├── schema.ts        typed records, schemaVersion, validators
│   ├── migrate.ts       versioned migration pipeline (v1 → future)
│   ├── store.ts         plaintext index: conversation meta + hidden-id Sets
│   └── archives.ts      encrypted archives: create/unlock/hide/restore/reset API
├── state/selection.ts   bulk-selection mode + pending-hide staging
├── patches/
│   ├── actionSheet.ts   long-press sheet rows ("Hide Locally", "Select Messages")
│   ├── render.tsx       RowGenerator filter + message wrapper + selection banner
│   └── profile.ts       UserProfileSection LocalHide panel injection
├── components/          HideRows, SelectionBanner, ProfilePanel
└── screens/             PasswordSetup, Unlock, Archive, Manage
tests/                   unit tests for crypto/schema/migrations/storage consistency
```

### Storage design notes

- **state.json** holds plaintext hidden ids for fast filtering; readable snapshots live **only** inside AEAD-sealed blobs.
- All writes go through a single promise queue per manager; whole-file JSON writes mirror Kettu's own storage backend semantics.
- Consistency ordering:
  - hide → archive blob first, then filter/state (crash ⇒ orphan snapshot in blob only)
  - restore → filter/state first, then blob rewrite (crash ⇒ still-restorable snapshot)
  - reset → state first (chat restores instantly), then delete encrypted files
- Load path validates everything; corrupted state falls back to fresh (file kept untouched on disk for manual recovery), corrupted archive records refuse to open.

## Discord/Kettu patch points (verified on 305.1 build 88876)

Discord's Hermes bundle retains original module paths; Kettu annotates initialized modules with `__filePath`, so lookups by path survive numeric-id changes. Confirmed identifiers in this target:

| feature | primary lookup | fallback(s) |
|---|---|---|
| long-press sheet | `findByProps("openLazy","hideActionSheet")`, key `"MessageLongPressActionSheet"`, args carry `.message`; inject into `ActionSheetRowGroup` children | any array of labeled rows |
| message list filter | `modules/messages/native/renderer/RowGenerator.tsx` (`.generate()`) | `findByName("RowGenerator")`; plus render backstop on `modules/messages/native/renderer/MessageWithContent.tsx` |
| selection banner | `modules/chat/native/ChatView.tsx` after-render overlay | skipped if absent |
| profile panel | `UserProfileSection` via `findByName(…, false)` | tree-scan insertion or fragment wrap |
| full screens | `findByProps("pushLazy","popWithKey").pushLazy(promise, key)` | root nav `goBack()` to close |
| stores | `ChannelStore`, `UserStore`, `MessageStore` via `findByStoreName` | try/catch everywhere |

Note: `__filePath` annotations appear only after a module initializes (Kettu lazy metro). Lookups therefore use bounded retries (`resolveWithRetry`) - chat modules resolve once a DM/profile has been opened.

### Updating after a Discord update

1. Extract the new IPA, locate `main.jsbundle`.
2. Grep the Hermes string table for candidate paths/names:
   `strings main.jsbundle | grep -o "modules/messages/[A-Za-z0-9_/.-]*"` (or scan with Python over raw bytes).
3. Patch the corresponding entries **only** in `src/lib/metro.ts`; feature code never looks up Discord internals itself.
4. Rebuild and re-test per TESTING.md.

## References (studied during development)

- Kettu runtime source (`C0C0B01/Kettu`, Bunny lineage): plugin manifest spec 3, vendetta compat object, MMKV/file storage backends, metro finders incl. `byFilePath`
- fshinz/Revenge-Plugins `ValidUser`: current `ActionSheet.openLazy` + `MessageLongPressActionSheet` injection pattern
- MYSTRAVIL/vendetta-plugins `HideMessages`: action-sheet row injection; deliberately *not* copied its MESSAGE_DELETE-dispatch hiding approach because LocalHide must not mutate MessageStore
- shipwr3ckd/revengeplugin `HideBlockedAndIgnoredMessages` + `staff-tags`: `RowManager/RowGenerator.generate` patching, `getTagProperties`
- Rico040/bunny-plugins `userbg`: profile patching via function-property patch; `action-sheet-finder`
- Discovery-style `pushLazy(Promise.resolve({default: Screen}), key)` modal pattern from current Kettu-compatible plugins
