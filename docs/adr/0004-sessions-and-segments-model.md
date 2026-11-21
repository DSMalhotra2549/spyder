# Sessions are split into segments

**Status:** accepted (2026-11-21)

A **session** is the logical unit of work: name, project, kind, planned duration. A **segment** is one continuous interval during which that session was actually running. Away periods and pauses close the current segment, and resuming opens a new one in the same session. A session's elapsed time is the sum of its segments.

This lets a countdown continue where it left off after a pause or a classified away period. It also lets "I was working" put away time back exactly (by adding a segment), and makes reports exact without any double counting.

## Considered options
- **One row per session with a start and an end.** Rejected: pauses and away time inside a session can't be represented. They'd have to be subtracted in separate bookkeeping, which is error-prone.
