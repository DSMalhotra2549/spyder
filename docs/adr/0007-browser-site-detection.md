# Browser sites: Chrome via its address bar, Firefox via window title, no extensions

**Status:** accepted (2026-11-21). The user chose no extensions.

The user browses in Chrome and Firefox.
- **Chrome:** the site is read from the address bar using Windows UI Automation, via a helper process (ADR-0008). This gives an exact domain with no extension to install.
- **Firefox:** doesn't expose its address bar reliably to UI Automation, and regular Firefox only runs extensions signed by Mozilla. **Firefox sites are inferred from the window title** using a user-editable title-pattern map (e.g. a title ending in "- YouTube" maps to youtube.com). Titles that match no pattern are grouped as `Firefox: <title>`.
- Only the host is ever stored, never the path or query string.

## Considered options
- **One WebExtension for both browsers.** It was the most accurate option and was recommended, but the user rejected it: it needs a one-time Mozilla signing step and has to be installed in every browser.
- **A Firefox-only extension.** Rejected along with the above.

## Consequences
- Firefox site data is approximate. Sites with generic titles go to `Firefox: <title>` until the user adds a title pattern.
- Chrome incognito windows can't be reliably told apart from normal ones and are recorded normally. Firefox private windows are detected from the title suffix and stored as "Private browsing" with no title.
