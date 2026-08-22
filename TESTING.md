# LocalHide - iPhone Test Checklist

Prereq: KettuTweak 2.0.0, Discord iOS 305.1 (build 88876). Install LocalHide from your hosted URL, enable it in Settings → Plugins, restart Discord.

## Core flow

| # | Test | Expected |
|---|---|---|
| 1 | Open a one-to-one DM | Chat renders normally |
| 2 | Long-press a message | Action sheet shows Discord's usual rows **plus** "Hide Locally" and "Select Messages" |
| 3 | Tap Hide Locally on the first-ever message in this DM | Password setup screen appears ("Protect Hidden Messages") |
| 4 | Try short password / mismatched confirmation | Inline errors; archive not created |
| 5 | Create valid password | "Archive created", sheet/screen closes, message disappears from chat immediately |
| 6 | Check the other person still sees everything | Remote message untouched (verify on another device/account) |
| 7 | Kill + reopen Discord | Message stays hidden; no crash |
| 8 | Long-press another message → Hide Locally | Hides instantly, **no** password prompt |
| 9 | Long-press → Select Messages | Selection mode banner appears with counter and Cancel |
| 10 | Tap several messages | Selected rows get border/badge, counter updates |
| 11 | Cancel | Mode exits, nothing hidden |
| 12 | Re-enter selection, pick N messages → Hide N Messages | Banner disappears, all vanish, toast confirms count |
| 13 | Open the person's profile | LocalHide panel: "N hidden messages" |
| 14 | View Hidden Messages → wrong password | Clean error, no contents revealed; repeat 3× for lockout messaging |
| 15 | Correct password | Archive screen lists messages chronologically with author/time/content |
| 16 | Verify outgoing vs incoming distinction | Your messages styled differently ("· you") |
| 17 | Restore one message via selection | Returns to DM → message visible again |
| 18 | Restore All (confirm dialog) | All reappear; profile panel disappears when count reaches 0 |

## Content edge cases

- Empty-content message (attachment only)
- Emoji-only message; multiline message
- Reply to a visible message; reply to a hidden message (must not crash; preview may remain - documented v1 behavior)
- Image/file attachment metadata appears in archive (filename/type/size); expired/removed CDN URL handled gracefully
- Messages authored by you vs the other person
- Display-name changes: hide before/after a name change; archive must keep working (IDs internally)
- Deleted-remotely message that was hidden: archive snapshot remains viewable after unlock
- Many messages (~50+) hidden: chat stays smooth; archive list scrolls efficiently

## Persistence & state

- Restart Discord between each major phase; verify counts in Settings → LocalHide
- Disable LocalHide: Discord renders normally again (all remote messages return)
- Re-enable: hidden set reapplies
- Reset Archive from settings/manage: warning shown, then filter clears and encrypted file is deleted
- Wrong-password attempts never expose content or hint at record validity

## Regression checks

- No console/network activity attributable to LocalHide during normal use (Settings → Developer → debugger if desired)
- Sending/receiving new messages works normally while LocalHide enabled
- Pagination: scrolling up through history still loads older messages even with hidden ones present
