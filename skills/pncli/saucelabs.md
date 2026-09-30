# Sauce Labs

pncli calls the Sauce Labs REST API directly with your username and access key; no `saucectl`, Sauce Connect, or other CLI is required.

## Configuration

| Key | Environment variable | CI fallback | Purpose |
|---|---|---|---|
| `saucelabs.baseUrl` | `PNCLI_SAUCELABS_BASE_URL` | — | API endpoint for your data center (see below) |
| `saucelabs.username` | `PNCLI_SAUCELABS_USERNAME` | `SAUCE_USERNAME` | Your Sauce Labs username |
| `saucelabs.accessKey` | `PNCLI_SAUCELABS_ACCESS_KEY` | `SAUCE_ACCESS_KEY` | Your access key |

Find both the username and the access key in Sauce Labs under **Account → User Settings**. The access key is long-lived; pncli sends it with the username as HTTP Basic auth.

`baseUrl` depends on the data center your account lives in:

| Data center | `baseUrl` |
|---|---|
| US West | `https://api.us-west-1.saucelabs.com` |
| US East | `https://api.us-east-4.saucelabs.com` (real devices only — no virtual-device jobs) |
| EU Central | `https://api.eu-central-1.saucelabs.com` |

```bash
pncli config set saucelabs.baseUrl https://api.us-west-1.saucelabs.com
pncli config set saucelabs.username <your-username>
pncli config set saucelabs.accessKey <your-access-key>
pncli config test
```

Or with environment variables:

```bash
export PNCLI_SAUCELABS_BASE_URL=https://api.us-west-1.saucelabs.com
export PNCLI_SAUCELABS_USERNAME=<your-username>
export PNCLI_SAUCELABS_ACCESS_KEY=<your-access-key>
```

**CI:** `SAUCE_USERNAME` and `SAUCE_ACCESS_KEY` are the names `saucectl`, Sauce Connect, and Sauce's CI integrations already use, so a pipeline that sets them needs only `PNCLI_SAUCELABS_BASE_URL`. Precedence for the username and access key is `PNCLI_SAUCELABS_*` → `SAUCE_*` → `.pncli.json` / `~/.pncli/config.json`.

## Commands

### Account and platform

```bash
pncli saucelabs status                       # Is Sauce Labs operational? Current wait time
pncli saucelabs concurrency                  # Allowed vs. in-use VMs and real devices (also verifies credentials)
pncli saucelabs platforms --api appium       # Supported platforms: all | appium | webdriver
pncli saucelabs appium-versions              # Appium versions for real-device sessions, with EOL dates
pncli saucelabs users --phrase jane          # Look up users in your organization
pncli saucelabs team list
pncli saucelabs team get <team-id>
pncli saucelabs team members <team-id>
```

### Jobs (virtual devices and desktop browsers)

```bash
pncli saucelabs job list --limit 20 --from 2026-09-01T00:00:00Z
pncli saucelabs job get <job-id>                  # Status, platform, timings, log and video URLs
pncli saucelabs job assets <job-id>               # Asset file names (logs, video, screenshots)
pncli saucelabs job update <job-id> --passed --build release-42 --tags smoke,email
pncli saucelabs job update <job-id> --public team # public | public restricted | share | team | private
pncli saucelabs job stop <job-id>
pncli saucelabs job delete <job-id>
```

`--from` / `--to` accept Unix seconds or an ISO 8601 date. `--tags` replaces the job's existing tags.

### Real-device jobs

```bash
pncli saucelabs rdc-job list --limit 20
pncli saucelabs rdc-job list --live               # Manual (live) tests only
pncli saucelabs rdc-job get <job-id>              # Device, result, timings, device/network/crash log URLs
pncli saucelabs rdc-job update <job-id> --failed --name "Gmail rendering"
pncli saucelabs rdc-job stop <job-id>
pncli saucelabs rdc-job delete <job-id>
```

### Builds

`--source` is `vdc` (virtual devices, the default) or `rdc` (real devices).

```bash
pncli saucelabs build list --source rdc --status failed,error --limit 10
pncli saucelabs build get <build-id> --source rdc
pncli saucelabs build jobs <build-id> --failed    # also --errored --passed --running --queued --completed --finished --faulty
pncli saucelabs build for-job <job-id>            # Which build a job belongs to
```

### Real devices

```bash
pncli saucelabs device list --os android --type phone
pncli saucelabs device list --name "iPhone 1[56].*" --os-version 17
pncli saucelabs device get iPhone_15_real          # Full hardware and OS descriptor
pncli saucelabs device status --state available    # Which devices are free right now
pncli saucelabs device status --private-only
```

`--name` and `--os-version` are regular expressions on the Sauce side.

### Device sessions (Real Device Access API)

A session reserves a real device and lets you drive it through the API. Close it when you are done — an open session holds a device and counts against your concurrency.

```bash
# Reserve a device; --wait polls until it is ACTIVE (default timeout 300s)
pncli saucelabs session create --device-name "Samsung Galaxy S2[34].*" --os android --wait
pncli saucelabs session create --os ios --duration PT30M --tunnel-name <tunnel-name> --wait

pncli saucelabs session list --state active
pncli saucelabs session get <session-id>           # State, expiry, Appium URL, live-view link

# Drive the device
pncli saucelabs session open-url <session-id> https://preview.imagile.dev/welcome-email
pncli saucelabs session shell <session-id> "getprop ro.build.version.release"   # Android only
pncli saucelabs session install-app <session-id> storage:filename=app.apk --launch
pncli saucelabs session installations <session-id>
pncli saucelabs session launch-app <session-id> --package-name com.google.android.gm
pncli saucelabs session launch-app <session-id> --bundle-id com.apple.mobilesafari
pncli saucelabs session uninstall-app <session-id> --package-name <package>
pncli saucelabs session settings <session-id> --orientation landscape --locale de_DE

# Record a test (a job) inside the session
pncli saucelabs session start-test <session-id> --name "Welcome email" --build release-42 --video --device-logs
pncli saucelabs session end-test <session-id> --passed
pncli saucelabs session tests <session-id>

# Network throttling
pncli saucelabs session network-profiles <session-id>
pncli saucelabs session network <session-id> --profile 4G-fast
pncli saucelabs session network <session-id> --download 1500 --upload 750 --latency 300 --loss 1
pncli saucelabs session network <session-id> --reset

# Appium
pncli saucelabs session appium <session-id>
pncli saucelabs session appium <session-id> --start --appium-version <version>

# Release the device
pncli saucelabs session delete <session-id>
```

Limits Sauce Labs enforces, not pncli:

- Sessions default to 6 hours. Public devices cap at 1 hour, private devices at 24 hours; longer `--duration` values are capped rather than rejected.
- `session shell` works on Android only, and public devices accept only an allowlisted set of commands.
- `session settings --locale` and `--animations` are Android only; `--orientation` works on both.
- A `409` on `session create` means your concurrency limit is reached — check `pncli saucelabs concurrency`.

### Sauce Connect tunnels

```bash
pncli saucelabs tunnel list                        # Full details for your tunnels
pncli saucelabs tunnel list --all                  # Include tunnels shared with you
pncli saucelabs tunnel get <tunnel-id>
pncli saucelabs tunnel jobs <tunnel-id>            # Jobs currently running through it
pncli saucelabs tunnel stop <tunnel-id>
```

### App storage

```bash
pncli saucelabs storage files --kind android --query gmail
pncli saucelabs storage groups --kind ios
```

## Not supported

pncli returns JSON from API calls; it does not handle binary content or visual comparison.

- Downloading job assets (videos, logs, screenshots), device screenshots, and pulling or pushing files on a device. `job assets` and the `*_url` fields on jobs give you the links.
- Uploading apps to app storage.
- Judging how something renders. To check an email on real devices, reserve a session, `open-url` the email's web view or `launch-app` the mail client, record it with `start-test --video --screenshots`, and review the recording through the job's `video_url` or the session's `liveViewUrl`.
- Starting a Sauce Connect tunnel. Run Sauce Connect itself, then reference the tunnel with `--tunnel-name`.
