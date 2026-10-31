window_named() {
  local pid=$1 want=$2 tries=0 w
  while [ "$tries" -lt 150 ]; do
    for w in $(xdotool search --onlyvisible --pid "$pid" 2>/dev/null || true); do
      if [ "$(xdotool getwindowname "$w" 2>/dev/null || true)" = "$want" ]; then
        echo "$w"
        return 0
      fi
    done
    sleep 0.1
    tries=$((tries + 1))
  done
  return 1
}

window_named_any() {
  local pid=$1 want=$2 tries=0 w
  while [ "$tries" -lt 150 ]; do
    for w in $(xdotool search --pid "$pid" 2>/dev/null || true); do
      if [ "$(xdotool getwindowname "$w" 2>/dev/null || true)" = "$want" ]; then
        echo "$w"
        return 0
      fi
    done
    sleep 0.1
    tries=$((tries + 1))
  done
  return 1
}

window_right_of() {
  local pid=$1 want=$2 edge=$3 tries=0 w
  while [ "$tries" -lt 150 ]; do
    for w in $(xdotool search --onlyvisible --pid "$pid" 2>/dev/null || true); do
      [ "$(xdotool getwindowname "$w" 2>/dev/null || true)" = "$want" ] || continue
      eval "$(xdotool getwindowgeometry --shell "$w")"
      if [ "$X" -ge "$edge" ]; then
        echo "$w"
        return 0
      fi
    done
    sleep 0.1
    tries=$((tries + 1))
  done
  return 1
}

wait_state() {
  local file=$1 filter=$2 tries=0
  while [ "$tries" -lt 300 ]; do
    if [ -f "$file" ] && jq -e "$filter" "$file" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.05
    tries=$((tries + 1))
  done
  return 1
}
