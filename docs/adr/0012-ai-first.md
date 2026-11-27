# AI-first

**Status:** accepted (2026-11-28). This is the user's requirement.

Spyder is AI-first. AI and LLM features belong everywhere they make the app more effective at holding the user to their own standards: categorizing apps and sites, questioning block answers that don't match the recorded activity, running the morning and evening rituals, and writing the weekly audit. Spyder is the foundation of Berthier, the user's AI chief of staff.

## Consequences
- Spyder will make network requests to a model provider. Privacy isn't a constraint for this user.
- The AI is an assistant, not the decision-maker: the user makes the final calls. Pre-committed consequences are applied as written, and the AI can't waive them in the moment. Rules change only in the weekly review, and every attempt to negotiate is logged.
- The core stays pure (ADR-0006): model calls live in the main process, never in `src/core/`.
