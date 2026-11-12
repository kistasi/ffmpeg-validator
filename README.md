# FFmpeg Validator

Finds corrupt files in a Radarr movie library by decoding each one with
ffmpeg, and shows the results, with a history of every run and its log.

Each movie file gets a decode-only pass (`ffmpeg -v error -i <file> -f null -`);
anything ffmpeg complains about marks the file corrupt. Results are cached by
Radarr's movie file id, so a run only scans files that are new or have been
replaced since the last one. Each movie is also tagged in Radarr with its
result, `ffmpeg-valid` or `ffmpeg-corrupt`.

The page shows:

- **Library**: every movie file with its status (clean, corrupt, not scanned
  yet, replaced since its scan), the lines ffmpeg complained with, and a button
  to rescan a single file. Files that need attention are listed first.
- **The active run**: which file is being decoded, a live log, and a Stop button.
- **Runs**: the last 50 runs, cron and manual, each with its log.

Runs are started from the page, or by `POST /api/runs`, which is what the
daily cron job calls:

```bash
curl -fsS -X POST -H 'Content-Type: application/json' \
  -d '{"trigger":"cron"}' http://localhost:8086/api/runs
```

| body field | |
| --- | --- |
| `mode` | `changed` (default): new and replaced files; `recheck-corrupt`: those plus files last found corrupt; `all`: every file |
| `movieFileId` | scan only this file, cached or not |
| `trigger` | `manual` (default) or `cron`, for the history |

Only one run happens at a time: while one is going, `POST` answers 409.
`DELETE /api/runs/active` stops it.

## What does not count as corrupt

A decode check that could not be run says nothing about the file, so it never
gets a file tagged corrupt:

- If ffmpeg cannot be started, or is killed by something other than the app
  (the OOM killer, say), the run is aborted.
- A file that is not readable is skipped. This is also what an unmounted
  drive looks like.
- A stopped run leaves the file being decoded with its previous result.

A decode that hangs for more than six hours is killed and does count against
the file.

## Configuration

| Variable | |
| --- | --- |
| `RADARR_URL` | e.g. `http://radarr:7878` |
| `RADARR_API_KEY` | Radarr API key |
| `RADARR_PUBLIC_URL` | optional, e.g. `http://malna.local:7878`; links each movie to its Radarr page |
| `FFMPEG_PATH` | optional, defaults to `ffmpeg` |

Mount the movie library at the **same path Radarr uses**, since the app opens
the paths Radarr reports. Scan results and run history are stored in
`data/scan-state.json` and `data/runs.json`; mount a volume at `/app/data` to
keep them.

## Running with Docker

```bash
docker build -t ffmpeg-validator .

docker run -d \
  --name ffmpeg-validator \
  -p 3000:3000 \
  -e RADARR_URL=http://radarr:7878 -e RADARR_API_KEY=... \
  -v /mnt/external/movies:/movies:ro \
  -v ffmpeg-validator-data:/app/data \
  ffmpeg-validator
```

## Development

```bash
npm run dev     # http://localhost:3000
npm test        # vitest
npm run lint
```

## A note on the code

This project was written by [Claude Code](https://claude.com/claude-code), Anthropic's CLI coding agent.

## License

Released under the [MIT License](LICENSE).
