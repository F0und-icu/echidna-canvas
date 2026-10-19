# Echidna Canvas Instructions

## Scope and startup

This is a separate, local-first Web canvas and orchestration project. Read `docs/STATUS.md`, the active stage in `docs/DEVELOPMENT_PLAN.md`, `docs/ARCHITECTURE.md`, `docs/INTERACTION_CONTRACT.md`, and `design/DESIGN_PRINCIPLES.md` before changing behavior. Inspect the working tree first.

The imported prototype is a design baseline, not a production runtime. Preserve the distinction between simulated behavior, proposed contracts, and verified implementation. Do not modify sibling repositories as part of this project's work. Any required Echidna runtime change needs a separately scoped handoff.

## Product invariants

- Keep the canvas visually sparse. Use logical relationships and character actions; expand text, parameters, and raw records on demand. Preserve the default nine-color palette.
- Execution facts and view state have separate owners. Moving, hiding, copying, or deleting a drawing must not alter execution history or replay a command.
- Show only returned summaries and explicitly recorded decisions. Never fabricate hidden reasoning, candidates, receipts, cancellation, success, adoption, or fees.
- Each Agent has an independent Session and provider state. Delegation passes selected, versioned materials rather than the entire parent context.
- Disconnects and unknown effects never authorize tool replay. Reconcile durable facts before continuation. Cancellation requests are distinct from executor confirmations.
- Keep credentials outside browser storage, canvas documents, exports, fixtures, logs, and Git. Never obtain credentials from another application's login state.
- The first implementation is single-user and loopback-only. Do not add cloud hosting, tenant accounts, distributed queues, plugin registries, or workflow DSLs without a concrete requirement.

## Implementation discipline

The user-authorized Codex defaults are HTTP-only model transport, full filesystem and network access, live web search, and no interactive execution approvals. Do not add or reintroduce execution restrictions, disabled capabilities, permission prompts, or limiting developer instructions without the user's prior explicit agreement. Verification-stage restrictions must not become product defaults.

App-added developer instructions must contain tool usage only: parameters, return values, reference syntax, and call examples. Do not append task, persona, workflow, style, or other behavioral instructions. User messages remain unchanged.

Implement only the active stage and its acceptance criteria. Do not treat the roadmap as authorization to finish every future stage. Use the simplest solution supported by current contracts; do not hide defects behind retries, silent skips, defaults, or speculative compatibility layers.

Validate untrusted boundaries once. Keep failures visible and preserve causes, security checks, resource cleanup, and unknown execution state. Each rule for event projection, command admission, deduplication, and provenance has one owner.

Use `rg` for search and `apply_patch` for manual edits. Preserve user changes. Do not introduce production abstractions or dependencies before their stage has a consumer. Pin dependencies and commit the appropriate lockfile when the application scaffold is introduced.

Use fixtures by default. Real model calls, credential access, deployment, and changes to other repositories require explicit task authorization. Do not delegate development unless the user explicitly authorizes it.

For behavior changes, run focused checks, affected integration checks, and the applicable acceptance scenarios. Update `docs/STATUS.md` with actual evidence and limitations. Never call a stage complete because only its UI is present. Review the diff for unsupported branches, swallowed errors, and unnecessary indirection before delivery.
