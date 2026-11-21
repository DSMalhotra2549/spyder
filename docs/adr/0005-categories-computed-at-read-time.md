# Activity categories are computed when read, not stored

**Status:** accepted (2026-11-21)

Activity rows store only raw facts: exe, app name, window title, domain, browser, private flag. The category (Productive / Neutral / Distracting / Uncategorized) is computed from the current rules whenever reports are built. As a result, editing a rule, or tagging an Uncategorized site with one click, **recategorizes all past data**, which is what someone correcting their categories expects.

## Consequences
- Reports have to categorize rows on the fly. This is cheap: there are a few thousand rows per day, and results are memoized by (exe, domain, title) per report request.
- **Distraction flags** are the exception. They are stored when the nudge fires, because they record what happened at that moment.
