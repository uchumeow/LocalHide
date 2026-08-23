# LocalHide Security

## Threat model

LocalHide protects **locally stored copies** of Discord messages on a jailbreak-free, personally-controlled iPhone against:

- casual snooping by someone briefly holding your unlocked phone (the per-conversation password gate)
- accidental discovery of sensitive messages in chat (local rendering filter)
- data leakage to the network (there is none)

It does **not** protect against:

- an attacker with root/filesystem access to your device
- Discord itself (server-side copies always exist; hiding is cosmetic and local)
- someone who knows the conversation password

## What is never done

- No plaintext passwords stored, logged, or transmitted
- No analytics/telemetry/remote logging; the shipped bundle contains zero `fetch`/`XMLHttpRequest`/`WebSocket` usage and zero URLs (verifiable: `grep -c "fetch\|XMLHttpRequest\|WebSocket" dist/LocalHide/index.js` → 0)
- No access to, storage of, or transmission of your Discord token
- No Discord API mutations of any kind (no message delete/edit/send endpoints are referenced)
- Message contents are never written to console logs - diagnostics log ids/counts only

## How encryption works

Per-conversation archive (`Documents/localhide/archive.<channelId>.json`):

```
password ──PBKDF2-HMAC-SHA256(600k iters, salt=16B random)──► master secret
master secret ──HKDF-SHA256──► KEK (key-wrapping) + VER (password verifier)
```

- **VER** produces an HMAC-SHA256 verifier tag stored in the record. Wrong password ⇒ tag mismatch ⇒ unlock refused. The password itself is never persisted anywhere.
- **KEK** wraps/unwraps a random 32-byte archive master key (envelope encryption).
- All readable snapshots are sealed with **XChaCha20-Poly1305** (@noble/ciphers) under the master key:
  - fresh random 24-byte nonce per encryption (stored prefixed to ciphertext; nonces are never reused because they are random and volumes are tiny)
  - AEAD associated data binds each ciphertext to its channel and purpose (`localhide/data/<channel>/v1`, `localhide/wrap/<channel>`), so ciphertexts cannot be swapped between records
  - Poly1305 authentication makes tampering/corruption detectable

Cryptography is implemented exclusively with audited pure-JS libraries from the @noble family (`@noble/ciphers`, `@noble/hashes`). No homemade crypto, no XOR, no base64-as-encryption (base64 is transport encoding for JSON storage only). Hermes/Discord does not expose WebCrypto; @noble is the same family Discord's own bundle ships internally.

### The device-key tradeoff (important)

The runtime requires that hiding more messages must **never** prompt for a password - even immediately after an app restart, when no password has been entered yet. Pure password-derived encryption cannot satisfy that (nothing could re-seal without the key), so the archive master key is wrapped twice:

1. under the **password-derived KEK** (unlock path - real KDF work, per spec)
2. under a random **device key** stored at `Documents/localhide/device.json` inside the app sandbox (silent hide path)

Consequence: anyone who can read both files in the sandbox can recover the master key *offline*. This is equivalent to how browser "saved password" stores behave behind OS lock screens, and filesystem-level attackers already control the entire Discord session anyway. If you want content unrecoverable, use **Reset Archive**.

Session hygiene: unwrapped keys live only in plugin RAM, wiped on plugin stop/disable; decrypted message contents exist only while an archive screen is open.

## What is stored where

| File | Contents |
|---|---|
| `state.json` | schema version, conversation metadata (channel id, other user id, display name cache, counts) and hidden message ids (plaintext, needed for O(1) filtering) |
| `archive.<channel>.json` | KDF params/salt, password verifier tag, wrapped master key (×2), AEAD-sealed snapshot list |
| `device.json` | random 32-byte device key |

Snapshot payloads contain: id, channel id, author id/name, text content, timestamps, outgoing flag, reply preview (id/name/≤120 chars), attachment metadata (filename/type/size/url - binaries are never downloaded), reduced embed title/description.

## Security limitations

- iOS sandbox/keychain access is not available to plugins; the device key must live on disk (see above).
- Reply previews of hidden messages can still render if the source stays cached (documented v1 behavior).
- Hidden ids are necessarily unencrypted so filtering stays fast without decryption.
- Anyone physically using your phone while an archive screen is open can see that screen.
- Memory dumps of a running process can expose keys/content; true only of every client-side app.

## Reporting

Open an issue on this repository.
