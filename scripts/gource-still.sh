#!/usr/bin/env bash
# A real Gource render; retain only the final PNG, never a video.
set -euo pipefail
source_dir="${1:?source checkout required}"
output_dir="${2:?output directory required}"
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
source_sha="$(git -C "$source_dir" rev-parse HEAD)"
LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s '-screen 0 2560x1440x24' \
  gource "$source_dir" --viewport 2560x1440 --seconds-per-day 0.15 \
  --auto-skip-seconds 0.1 --max-file-lag 0.05 --file-idle-time 0 \
  --file-idle-time-at-end 0 --stop-at-end --camera-mode overview \
  --hide users,usernames,mouse,progress,date,filenames --dir-name-depth 3 \
  --font-size 22 --dir-font-size 20 --key --background-colour 0f172a \
  --title "IDLE Arcade | ${source_sha:0:8}" \
  --file-filter '(^|/)(node_modules|dist|build|\.git)/|(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$' \
  --output-framerate 25 --output-ppm-stream - \
  | ffmpeg -hide_banner -loglevel error -y -f image2pipe -vcodec ppm -i - \
      -update 1 "$output_dir/gource.png"
test -s "$output_dir/gource.png"
printf '{"repository":"idle-arcade/game","commit":"%s","renderer":"Gource","viewport":"2560x1440","description":"Final rendered frame of real Git history; idle files retained; dependencies, builds and lockfiles excluded."}\n' "$source_sha" > "$output_dir/gource-source.json"
