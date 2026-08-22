# LocalHide

**Locally hide and protect messages in Discord DMs.**

LocalHide is a plugin for [Kettu](https://github.com/C0C0B01/Kettu) (iOS, Vendetta/Bunny-style runtime) that lets you hide Discord messages **on your iPhone only**.

- Hiding does **not** delete, edit, or otherwise touch the real message
- Nobody else ever sees a difference - not even Discord's servers
- No self-botting, no automation, no API mutations
- Hidden messages are saved in an encrypted local archive, protected per-conversation by your password

Tested against: **Discord iOS 305.1 (build 88876) + KettuTweak 2.0.0**.

## What it does NOT do

- It never sends any Discord API request (no deletes, no edits, no sends)
- It never reads, stores, or transmits your Discord token
- It contains no analytics/telemetry and makes no network requests at all
- It cannot hide anything for anyone but you

## Installation (iPhone / Kettu)

1. Host this repository's `dist/` folder (GitHub Pages works: push and enable Pages on the repo root).
2. In Discord with Kettu: **Settings → Plugins**, paste the install URL:

   ```
   https://<your-host>/LocalHide/
   ```

3. Enable LocalHide and restart Discord.

The URL is a directory containing `manifest.json` and `index.js` (polymanifest format). If you build locally you can also serve `dist/` from your computer and use `http://<lan-ip>:<port>/LocalHide/`.

## Usage

### Hiding messages
- **Long-press any message in a 1-on-1 DM → Hide Locally.** The message disappears immediately.
- **Long-press → Select Messages** enters bulk-selection mode: tap messages to toggle them, watch the counter, then hit **Hide N Messages** (or **Cancel**).

### First-hide password
The first time you hide something in a particular person's DM, LocalHide asks you to create a password for that conversation's archive. After that, hiding more messages there **never** asks again.

Passwords are per-person: Person A's password doesn't unlock Person B's archive.

### Viewing hidden messages
Open the person's **profile** - LocalHide adds a panel ("N hidden messages" → **View Hidden Messages**). Enter that conversation's password to browse the encrypted archive. Closing the screen locks it again; restarting Discord also locks everything.

From inside the archive you can:
- **Restore Selected** - unhide specific messages (tap rows after entering selection mode)
- **Restore All** - confirmation required
- **Reset Archive** - permanently destroys the local encrypted archive for that DM (remote messages are untouched)

### Settings
Kettu's plugin settings shows protected-conversation count, total hidden count, **Manage Protected Conversations** (per-conversation open/reset), diagnostics toggles (ids/counts only - no content, ever), and About.

## Password behavior

| Action | Password needed? |
|---|---|
| First hide in a DM (archive creation) | You create one |
| Any later hides in that DM | No |
| Viewing/restoring archived messages | Yes, that DM's password |
| Resetting the archive | No (deliberately destructive & local-only) |

There is **no recovery**. Forgot it? Reset the archive (loses locally stored snapshots; Discord's copies remain untouched and visible again after reset).

## Compatibility notes

- v1 scope: **one-to-one DMs only**. Server/group-DM support is architecturally planned (storage keyed by channel id) but intentionally not exposed yet.
- Replies to a hidden message may still show their small reply preview if the referenced message stays cached; stability was prioritized over preview suppression.
- Module lookups are centralized (`src/lib/metro.ts`) with file-path + name + props strategies so Discord updates usually need only a small lookup patch.

See [SECURITY.md](SECURITY.md) for the threat model and encryption design, [TESTING.md](TESTING.md) for the device test checklist, and [DEVELOPMENT.md](DEVELOPMENT.md) for build internals.

## License

MIT.
