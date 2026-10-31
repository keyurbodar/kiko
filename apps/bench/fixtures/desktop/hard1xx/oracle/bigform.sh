set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
xdotool windowfocus "$(window_named "$pid" "Bench Fixture")"
xdotool mousemove 225 19 sleep 0.1 click 1 sleep 0.1
first=1
while IFS= read -r value; do
  if [ "$first" -eq 0 ]; then
    xdotool key --clearmodifiers Tab
    sleep 0.05
  fi
  first=0
  xdotool type --delay 5 --clearmodifiers -- "$value"
done < <(jq -r '.values[]' "$workdir/request.json")
xdotool mousemove 70 458 sleep 0.1 click 1
wait_state "$workdir/state.json" '.submitted != null'
