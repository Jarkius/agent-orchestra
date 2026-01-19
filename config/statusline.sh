#!/bin/bash
# Claude Code Statusline - Accurate Context Display
# Parses transcript for real token counts instead of using buggy API values

input=$(cat)

# Extract basic info from statusline input
model=$(echo "$input" | jq -r '.model.display_name' | sed -E 's/Claude ([0-9.]+) (.*)/\2 \1/')
dir=$(echo "$input" | jq -r '.workspace.current_dir // .cwd')
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // 200000')
transcript=$(echo "$input" | jq -r '.transcript_path // empty')

# Project (ghq-aware) and branch
ghq_root=$(ghq root 2>/dev/null)
if [[ -n "$ghq_root" && "$dir" == "$ghq_root"* ]]; then
    proj="${dir#$ghq_root/}"
else
    proj=$(basename "$dir")
fi
branch=$(git -C "$dir" -c core.useBuiltinFSMonitor=false -c core.fsmonitor=false branch --show-current 2>/dev/null || echo "")

# Calculate accurate context from transcript
used=0
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
    # Get the most recent assistant message with usage info
    usage_line=$(tac "$transcript" 2>/dev/null | grep -m 1 '"input_tokens"' 2>/dev/null)
    if [ -n "$usage_line" ]; then
        input_tokens=$(echo "$usage_line" | jq -r '.message.usage.input_tokens // 0')
        cache_create=$(echo "$usage_line" | jq -r '.message.usage.cache_creation_input_tokens // 0')
        cache_read=$(echo "$usage_line" | jq -r '.message.usage.cache_read_input_tokens // 0')
        used=$((input_tokens + cache_create + cache_read))
    fi
fi

# Fallback to API values if transcript parsing fails
if [ "$used" -eq 0 ]; then
    pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0')
    used=$(echo "scale=0; ($pct * $ctx_size) / 100" | bc)
fi

# Calculate display values
mk=$(echo "scale=0; $ctx_size / 1000" | bc)
used_k=$(echo "scale=0; $used / 1000" | bc)
pct_int=$(echo "scale=0; ($used * 100) / $ctx_size" | bc)

# Clamp percentage
[ "$pct_int" -gt 100 ] && pct_int=100
[ "$pct_int" -lt 0 ] && pct_int=0

# Warning thresholds (compensate for hidden context ~15-20%)
# Statusline shows ~15-20% less than actual usage
WARN_THRESHOLD=40   # Yellow warning (real ~55-60%, ~40% remaining)
CRIT_THRESHOLD=55   # Red critical (real ~70-75%, ~25% remaining)

# Build progress bar (20 chars) with color based on usage
filled=$(echo "scale=0; $pct_int * 20 / 100" | bc)
[ "$filled" -gt 20 ] && filled=20
[ "$filled" -lt 0 ] && filled=0

# Determine bar color based on usage level
if [ "$pct_int" -ge "$CRIT_THRESHOLD" ]; then
    bar_color="\033[31m"  # Red
    pct_color="\033[31m"  # Red
    warn_icon="⚠️ "
elif [ "$pct_int" -ge "$WARN_THRESHOLD" ]; then
    bar_color="\033[33m"  # Yellow
    pct_color="\033[33m"  # Yellow
    warn_icon=""
else
    bar_color="\033[0m"   # Default
    pct_color="\033[33m"  # Yellow (normal)
    warn_icon=""
fi

bar=""
for ((i=0; i<filled; i++)); do bar+="█"; done
for ((i=filled; i<20; i++)); do bar+="░"; done

# Build output with colors and warning
out="${warn_icon}\033[35m${model}\033[0m \033[36m[\033[0m${bar_color}${bar}\033[0m\033[36m]\033[0m ${pct_color}${pct_int}%\033[0m \033[35m${used_k}k/${mk}k\033[0m"
[ -n "$branch" ] && out="${out} \033[32m${branch}\033[0m"
out="${out} \033[34m${proj}\033[0m"

printf "%b" "$out"
