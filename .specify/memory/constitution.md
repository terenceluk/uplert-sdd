# Uplert Constitution

## Core Principles

### I. Native Windows Execution, No Lock-In
The application MUST run natively on Windows 11 and MUST be startable with a single
command (e.g. one script invocation or one executable) with no manual multi-step setup
beyond that command. Docker, Docker Desktop, WSL, and any VM-based runtime are
PROHIBITED as execution dependencies. The application MUST NOT require signup for,
or a paid tier of, any third-party service in order to run; any external service
integration MUST be optional, with the application fully functional without it.

**Rationale**: This is a small, locally run tool. Every environment dependency
(a container runtime, a subsystem, a hosted account) is a new way for it to fail to
start on a plain Windows 11 machine, and a paid or signup-gated dependency makes the
single-command promise conditional on something outside the user's control.

### II. SQLite Persistence, Created on First Run
All application data MUST be stored in SQLite. The database file MUST be created
automatically on first run if it does not already exist, with no separate migration
or provisioning command required before the application is usable.

**Rationale**: SQLite requires no server process and ships as a single file, which
matches the single-command, no-infrastructure constraint in Principle I. Auto-creation
on first run keeps "one command to start" literally true, including the very first
start.

### III. Per-User Data Isolation, Enforced Server-Side
Every user's data MUST be private to that user. Every request that reads or writes
user data MUST be authorized on the server, keyed off the authenticated session or
credential — never off a user ID, role, or permission flag supplied by the client.
Client-supplied identifiers MAY be used to select *which* record is requested, but
MUST NOT be trusted to decide *whether* access is allowed.

**Rationale**: Client input is attacker-controlled by definition. A server-side check
on every request is the only check that cannot be bypassed by editing a request
before it is sent, and is non-negotiable for any application that stores more than
one user's data.

### IV. Test-Backed Requirements (NON-NEGOTIABLE)
Every functional requirement defined in a feature's spec MUST have at least one
automated test that exercises it. A task MUST NOT be marked complete until the full
automated test suite passes, including tests unrelated to that task. A requirement
with no corresponding test is incomplete, regardless of whether the code behind it
appears to work.

**Rationale**: On a small team (or a solo author) there is no independent QA pass to
catch a regression; the test suite is that pass. Requiring the *full* suite to pass —
not just new tests — is what prevents a change in one area from silently breaking
another.

### V. Secure Credential & Session Handling
Passwords MUST be hashed using a modern adaptive hashing algorithm (e.g. bcrypt,
scrypt, or Argon2) with per-password salting; they MUST NOT be stored, transmitted,
or compared in plaintext. Session tokens MUST be stored in the database only as a
hash, never in plaintext, so that reading the database alone never yields a usable
session token. Every session MUST expire after a fixed period of inactivity, after
which it MUST be rejected for authentication. Session cookies MUST always be set
with both the `HttpOnly` and `SameSite=Strict` attributes. Passwords, password
hashes, session tokens, and any other credential material MUST NOT appear in logs,
error messages, or stack traces under any circumstance.

**Rationale**: Adaptive hashing resists brute-force and rainbow-table attacks far
better than a fast general-purpose hash. A session token is a bearer credential
exactly like a password — stored in plaintext, a database read (via backup, export,
or an unrelated vulnerability) hands an attacker a ready-to-use session, so it gets
the same hash-at-rest treatment. A fixed inactivity expiry bounds how long a leaked
or forgotten session stays useful instead of leaving it valid forever. `HttpOnly`
keeps the token out of reach of a successful script-injection payload, and
`SameSite=Strict` stops the browser from attaching the cookie to cross-site requests
at all — the strongest CSRF defense, and one this single-origin, locally run
application has no need to relax. Logging is a common, easily-overlooked leak path
for all of the above — a debug log line or an exception dump is often how credential
material actually escapes a system.

### VI. Minimal Dependencies
Every new dependency MUST be justified by a concrete, current need; dependencies MUST
NOT be added for hypothetical future use, convenience alone, or because a feature
could be partially hand-rolled instead. When a capability can be met by the language
or framework's standard library without materially more effort, the standard library
MUST be preferred over a third-party package.

**Rationale**: Each dependency is an addition to the install step, an attack surface,
and a future upgrade burden. For a small, locally run application, a lean dependency
tree is also what keeps the single-command setup fast and reliable.

## Technology Constraints

The application's run command (whatever form it takes — a script, a binary, a package
manager entry point) MUST be documented in the project's README and MUST work on a
clean Windows 11 install that has only the stated prerequisites (e.g. a specific
language runtime) installed — no Docker, no WSL, no container registry login, and no
paid API key. Any optional third-party integration (e.g. an external API) MUST degrade
gracefully to a disabled or stubbed state when its credentials are absent, rather than
preventing startup.

## Quality Gates

Before any task is marked complete:
1. Every functional requirement the task implements or touches MUST map to at least
   one automated test (Principle IV).
2. The full automated test suite MUST be run and MUST pass — no failing, erroring, or
   newly-skipped tests are acceptable as a completion state.
3. Any endpoint or code path that touches user data MUST be reviewed against
   Principle III: does authorization happen on the server, keyed off the
   authenticated identity, on every request that touches that data?
4. Any code path that touches passwords, session tokens, or other credentials MUST be
   reviewed against Principle V: adaptive password hashing and hash-at-rest session
   token storage in place, inactivity-based session expiry enforced, session cookies
   set with `HttpOnly` and `SameSite=Strict`, and no plaintext credential or token
   value reaching logs.

A task that fails any of these checks is not complete, even if its primary feature
appears to work end-to-end.

## Governance

This constitution supersedes any conflicting practice, template default, or ad hoc
convention used elsewhere in the project. Any plan, spec, or task list that conflicts
with a principle here MUST either be revised to comply or must document, in that
artifact, an explicit justification for the deviation and get the user's sign-off
before proceeding.

**Amendment procedure**: A change to this document is proposed by editing
`.specify/memory/constitution.md` (directly, or via the `/speckit-constitution`
command), stating what changed and why, and is adopted once the user approves it.
There is no separate approval body — the user is the sole ratifying authority for this
project.

**Versioning policy**: This constitution is versioned independently using semantic
versioning:
- MAJOR: a principle is removed or redefined in a way that is backward-incompatible
  with prior guidance.
- MINOR: a new principle or section is added, or existing guidance is materially
  expanded.
- PATCH: wording, clarification, or typo fixes with no change in substantive rule.

**Compliance review**: Every `/speckit-plan` run MUST re-check its design against
these principles before implementation tasks are generated, and every
`/speckit-implement` run MUST treat the Quality Gates section as a hard gate on task
completion, not a suggestion.

**Version**: 1.1.0 | **Ratified**: 2026-10-17 | **Last Amended**: 2026-10-17
