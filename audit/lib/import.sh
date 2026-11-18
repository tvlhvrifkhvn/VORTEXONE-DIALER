# imp FILE [MAPPING_JSON|auto]  — runs the real background-job import path:
#   POST /api/imports/upload -> POST /api/imports/process -> poll GET /api/imports/status/:id
# Prints the upload's mapping, every distinct progress value, the final status
# and resultSummary, and the elapsed seconds. Requires env.sh to be sourced.
imp() {
  local file="$1" mapping="${2:-auto}" t0 up job st prev="" pct
  t0=$(date +%s.%N)
  up=$(curl -s -H "authorization: Bearer $(cat $SCRATCH/token)" -F "file=@$file" "$API/api/imports/upload" -w ' [HTTP %{http_code}]')
  echo "upload $(basename "$file"): $(echo "$up" | grep -oE '\[HTTP [0-9]+\]') mapping=$(echo "$up" | sed 's/ \[HTTP.*//' | jget mapping 2>/dev/null) error=$(echo "$up" | sed 's/ \[HTTP.*//' | jget error 2>/dev/null)"
  job=$(echo "$up" | sed 's/ \[HTTP.*//' | jget jobId 2>/dev/null)
  [ -z "$job" ] || [ "$job" = "undefined" ] && return 0
  [ "$mapping" = "auto" ] && mapping=$(echo "$up" | sed 's/ \[HTTP.*//' | jget mapping)
  echo "process: $(api POST /api/imports/process "{\"jobId\":$job,\"mapping\":$mapping}")"
  for i in $(seq 1 ${IMP_MAX_POLLS:-600}); do
    st=$(api GET /api/imports/status/$job | sed 's/ \[HTTP.*//')
    pct=$(echo "$st" | jget processedRows)/$(echo "$st" | jget totalRows)
    [ "$pct" != "$prev" ] && echo "  t=$(printf '%.1f' $(echo "$(date +%s.%N) - $t0" | bc))s progress $pct ($(echo "$st" | jget percentage)%) status=$(echo "$st" | jget status)" && prev=$pct
    case "$(echo "$st" | jget status)" in completed|failed|cancelled) break;; esac
    sleep ${IMP_POLL_S:-0.5}
  done
  echo "final: status=$(echo "$st" | jget status) error=$(echo "$st" | jget errorMessage) elapsed=$(printf '%.1f' $(echo "$(date +%s.%N) - $t0" | bc))s"
  echo "resultSummary: $(echo "$st" | jget resultSummary)"
  LAST_JOB=$job
}
