# Fixed-length blocks replace sessions

**Status:** accepted (2026-11-22). Supersedes ADR-0004.

The user presses Start and picks a block length, then gives no other input. Each time a block ends, the next one starts immediately and Spyder asks what the finished block was spent on. The work day becomes a list of equal blocks, each accounted for in free text. This replaces planned, timed and open sessions, segments, pauses, check-ins, projects and away classification. Asking at a fixed rhythm gives a finer and more honest record than naming sessions up front. It also means one action and one question repeated, rather than a model with many kinds of session.

## Consequences
- Being away doesn't interrupt the loop. Away minutes are only a hint when the user accounts for a block. Spyder not running ends the loop, and that gap becomes untracked.
- Merging adjacent blocks is the only way a block gets longer than the block length. Old sessions convert to one block each, and old away periods to blocks or untracked time.
