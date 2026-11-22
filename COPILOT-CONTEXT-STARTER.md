# Starting an AI chat session on this repo

This file used to hold a context blob to paste into a new Copilot chat. That is no longer
necessary — context now lives in files the assistants read on their own.

**Point your assistant at these, in order:**

| File | What it gives you |
| --- | --- |
| [.github/copilot-instructions.md](.github/copilot-instructions.md) | The short rules. Copilot loads this automatically |
| [PROJECT-CONTEXT.md](PROJECT-CONTEXT.md) | Architecture, config schema, invariants, legacy map |
| [README.md](README.md) | What the product is and how to build it |
| [plans/restore-ui-gtm-plan.md](plans/restore-ui-gtm-plan.md) | The phased plan the product was built against, with locked decisions |

If a tool cannot read repository files, paste **PROJECT-CONTEXT.md** — it is written to
stand alone.

**The one thing to say in any session:** this repository is named `tally-backup` for
historical reasons. The product is **Backup Genie**, a general-purpose versioned backup
application, not a Tally-specific tool. Files still carrying the old branding are legacy
and should not be extended.
