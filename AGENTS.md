<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Strict Repository File Organization & Placement Policy

All agents and contributors must strictly enforce the following repository layout:

1. **Audit Reports**: Place in `docs/audits/<phase>/` (e.g., `docs/audits/phase-a/`, `docs/audits/phase-9/`, `docs/audits/phase-11/`).
2. **Implementation Reports & Plans**: Place in `docs/audits/<phase>/` (e.g., `PHASE11_FRONTEND_IMPLEMENTATION_PLAN.md` belongs in `docs/audits/phase-11/`).
3. **Acceptance Checklists & Test Reports**: Place in `docs/audits/<phase>/` (e.g., `PHASE_A1_LIVE_ACCEPTANCE_REPORT.md` belongs in `docs/audits/phase-a1/`).
4. **Temporary Scripts & One-Off Diagnostics**: Place in `scratch/<phase>/` (e.g., `scratch/phase-a1/`). Never place exploratory, scratch, or temporary scripts in the root directory.
5. **Permanent Automated Tests**: Place in `tests/` matching `*.test.mjs`.
6. **Core Project Documentation**: Place in existing canonical locations (`.planning/`, `docs/`, or canonical pointer files in root).
7. **Root Directory Invariant**: **NEVER** create generated reports, audit documents, acceptance checklists, temporary test scripts, or scratch files in the repository root. Keep the root strictly limited to package configuration, build tool configs, canonical pointers (`PROJECT_STATE.md`, `TESTING.md`, etc.), and environment files.

Every future task must adhere to this file creation policy without exception.
