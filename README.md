# Reddit Story Hunter

A small, read-only, non-commercial personal tool that uses Google Apps Script to retrieve public Reddit post metadata and organize it in a private Google Sheet.

## Purpose

The tool helps one user discover and revisit relevant public discussions across a limited set of subreddits without manually checking each community.

It is intentionally read-only:

- no posting
- no commenting
- no voting
- no private messaging
- no moderation actions
- no access to private Reddit content
- no AI/ML model training
- no sale, licensing, or redistribution of Reddit data

## What data is stored

The default crawler stores only the metadata needed for discovery and ranking:

- market
- language
- subreddit
- Reddit post ID
- title
- Reddit permalink
- creation time
- post score
- comment count
- calculated age / score-per-hour / comments-per-hour
- local workflow fields in the spreadsheet

The crawler does **not** store Reddit usernames or full post bodies in this MVP.

## Architecture

```text
Reddit Data API (OAuth)
        |
        v
Google Apps Script
        |
        v
Private Google Sheet
  - STORIES
  - SOURCES
  - CONFIG
```

## Google Sheet layout

### `SOURCES`

Expected columns:

| Column | Name |
|---|---|
| A | Market |
| B | Language |
| C | Subreddit |
| D | Enabled |
| E | Priority |
| F | Notes |

### `CONFIG`

Expected columns:

| Column | Name |
|---|---|
| A | Key |
| B | Value |
| C | Note |

Supported configuration keys include:

- `max_post_age_hours` — default 72
- `max_posts_per_market_per_run` — default 50

### `STORIES`

The script expects 26 columns matching the project's Google Sheet template. It writes Reddit metadata into columns A:M, sets `Status` to `NEW`, and updates `Last Checked`.

## Setup

1. Create or open the Google Sheet.
2. Open **Extensions → Apps Script**.
3. Copy `Code.gs` and `appsscript.json` into the Apps Script project.
4. Open **Project Settings → Script Properties**.
5. Add:

```text
SPREADSHEET_ID=<your Google Sheet id>
REDDIT_CLIENT_ID=<approved Reddit client id>
REDDIT_CLIENT_SECRET=<approved Reddit client secret>
REDDIT_USER_AGENT=googleapps:reddit-story-hunter:v0.1 (by /u/YOUR_REDDIT_USERNAME)
```

Never put Reddit credentials in source code or spreadsheet cells.

6. Run `testRedditConnection()`.
7. Run `crawlReddit()`.
8. After testing, run `installHourlyTrigger()` if hourly refreshes are desired.

## Data handling

The crawler uses OAuth and an identifiable User-Agent, keeps the scope limited to configured subreddits, and uses a short configurable retention window. The repository contains no API credentials or user data.

Before production use, the operator is responsible for keeping the implementation aligned with Reddit's current Data API terms, rate limits, deletion requirements, and any access conditions attached to the approved API application.

## Repository status

This repository is the source-code reference for a Reddit Data Access request for an external Google Apps Script integration that does not run inside the Devvit ecosystem.
