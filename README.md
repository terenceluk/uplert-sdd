# Uplert

A personal uptime monitor. Sign in, add HTTP checks, and watch a dashboard of current
up/down status, 24-hour uptime percentage, and recent response times. A background poller
checks each endpoint on its own schedule.

## Requirements

- Windows 11
- Node.js 22.5.0 or later (tested on Node.js 24)

No other prerequisites. There are no third-party npm dependencies, so there is nothing to
install beyond Node.js itself.

## Running it

```powershell
npm start
```

That's it — one command. On first run this creates `uplert.db` (a SQLite file) in the
working directory automatically; there is no separate setup or migration step.

You'll see a startup warning from Node.js like:

```text
ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

This is expected — it comes from Node's built-in `node:sqlite` module, which this project
uses instead of a third-party database package. It does not affect functionality.

Once running, open `http://localhost:3000` in a browser to register an account and start
adding checks. The first account ever registered becomes the administrator.

## Running the tests

```powershell
npm test
```

This runs the full automated test suite via Node's built-in test runner (`node --test`).
Every functional requirement in `specs/001-uptime-monitor/spec.md` has at least one
corresponding test, and the full suite must pass before any change is considered complete.
