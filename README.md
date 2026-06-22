# worldhype-data

Free auto-scraper for World Hype News. A GitHub Action runs every 30 minutes,
pulls real news for all 8 channels (publisher RSS + Google News, English only),
enriches it, and merges it into **feed.json** — which grows over time and never
deletes. Your site reads feed.json.

## Setup (web UI, no command line)
1. Create a new GitHub repo named **worldhype-data** (Public).
2. Upload ALL files from this folder (drag them into the repo's upload page),
   including the hidden `.github` folder. Commit.
3. Go to the repo's **Actions** tab → enable workflows → run **scrape-news** once
   (or just wait; it auto-runs on upload and every 30 min).
4. After it finishes, your feed is live at:
   `https://raw.githubusercontent.com/<YOUR_USERNAME>/worldhype-data/main/feed.json`

That URL goes into the site (the `FEED_URL` setting) so the site reads the
growing archive.

## Cost
$0. GitHub Actions free minutes cover a 30-min cadence easily.
