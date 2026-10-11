#!/bin/sh
# Usage: issues/bin/ledger.sh <unit> field=value [field=value ...]
# Sets fields on one ledger row in place and stamps `updated`. The coordinator is the only caller.
set -eu
file="$(dirname "$0")/../ledger.tsv"
unit="$1"; shift
now="$(date -u +%FT%TZ)"
awk -F'\t' -v OFS='\t' -v unit="$unit" -v now="$now" -v sets="$*" '
NR==1 { for (i=1;i<=NF;i++) col[$i]=i; print; next }
$1==unit {
  n=split(sets, kv, " ")
  for (j=1;j<=n;j++) { k=substr(kv[j],1,index(kv[j],"=")-1); v=substr(kv[j],index(kv[j],"=")+1); gsub(/_/," ",v); if (k in col) $(col[k])=v }
  $(col["updated"])=now
}
{ print }' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
