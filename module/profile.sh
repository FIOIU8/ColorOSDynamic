# Profile schema 1. Sections preserve the legacy files verbatim except observer migration.
validate_profile() {
    local bytes
    bytes=$(wc -c < "$1") || return 1
    [ "$bytes" -le 45000 ] || return 1
    LC_ALL=C awk '
        function number(s, max) { return s ~ /^[1-9][0-9]*$/ && s+0 <= max }
        function package(s) { return s ~ /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/ }
        function bad() { invalid=1; exit 1 }
        NR==1 { if ($0!="schema=1") bad(); next }
        NR==2 { if ($0!="backend=shell" && $0!="backend=rust") bad(); next }
        /^\[(rules|rates|monitor|names)\]$/ {
            if (seen[$0]++) bad()
            section=$0
            next
        }
        /[\r[:cntrl:]]/ { if ($0 ~ /[^\t[:print:]\200-\377]/) bad() }
        /^[[:space:]]*(#|$)/ { next }
        {
            pos=index($0,"="); if (!pos) bad()
            key=substr($0,1,pos-1); value=substr($0,pos+1)
            if (section=="[rules]") {
                if (!number(value,9999)) bad()
                if (key=="global_sample_rate") global=value
                else if (package(key)) rules[key]=value
                else bad()
            } else if (section=="[rates]") {
                if (!number(key,9999)) bad()
                n=split(value,parts," ")
                if (n!=6 || parts[1]!="touchHidlTest" || parts[2]!="-c" || parts[3]!="wo" ||
                    parts[4] !~ /^[0-9]+$/ || parts[5] !~ /^[0-9]+$/ || parts[6] !~ /^[A-Za-z0-9]+$/ ||
                    length(parts[4])>4 || length(parts[5])>4 || length(parts[6])>8 ||
                    value!="touchHidlTest -c wo " parts[4] " " parts[5] " " parts[6]) bad()
                rates[key]=1
            } else if (section=="[monitor]") {
                if (key=="fallback_enabled") { if (value!="0" && value!="1") bad() }
                else if (key=="poll_interval") { if (!number(value,60)) bad() }
                else if (key=="fallback_method") { if (value!="polling") bad() }
                else if (key=="fallback_app") { if (!package(value)) bad() }
                else bad()
            } else if (section=="[names]") {
                if (!package(key) || length(value)>300) bad()
            } else bad()
        }
        END {
            if (invalid || NR<6 || !seen["[rules]"] || !seen["[rates]"] || !seen["[monitor]"] || !seen["[names]"] || !rates[global]) exit 1
            for (pkg in rules) if (!rates[rules[pkg]]) exit 1
        }
    ' "$1"
}

module_edition() {
    local edition
    edition=$(awk -F= '$1 == "edition" { print $2; exit }' "$MODDIR/edition.conf" 2>/dev/null)
    case "$edition" in
        rust) printf 'rust\n' ;;
        *) printf 'shell\n' ;;
    esac
}

ensure_profile() {
    [ -f "$CONFIG" ] && return 0
    local temp
    temp=$(mktemp "$MODDIR/.profile.XXXXXX") || return 1
    if {
        printf 'schema=1\nbackend=%s\n[rules]\n' "$(module_edition)"
        cat "$MODDIR/touch_opt.conf" && printf '\n[rates]\n' && cat "$MODDIR/rate_code.conf" &&
        printf '\n[monitor]\n' && sed -e 's/^fallback_method=observer$/fallback_method=polling/' -e 's/^fallback_package=/fallback_app=/' "$MODDIR/monitor_config.conf" &&
        printf '\n[names]\n' && cat "$MODDIR/app_names.conf"
    } > "$temp" && validate_profile "$temp"; then
        # Another startup path may be migrating at the same time. Install once.
        ln "$temp" "$CONFIG" 2>/dev/null || [ -f "$CONFIG" ] || { rm -f "$temp"; return 1; }
        rm -f "$temp"
        return 0
    fi
    rm -f "$temp"
    return 1
}

save_profile() {
    local temp
    [ -n "$1" ] && [ "${#1}" -le 60000 ] || return 1
    temp=$(mktemp "$MODDIR/.profile.XXXXXX") || return 1
    if printf '%s' "$1" | base64 -d > "$temp" && validate_profile "$temp" && mv -f "$temp" "$CONFIG"; then
        return 0
    fi
    rm -f "$temp"
    return 1
}

load_profile() {
    # Capture a single inode before validating and parsing. Save uses rename.
    local temp line section key value
    temp=$(mktemp "$SESSION/.config.XXXXXX") || return 1
    if ! cat "$CONFIG" > "$temp" || ! validate_profile "$temp"; then
        rm -f "$temp"
        return 1
    fi
    global_rate= fallback_enabled=0 interval=3 configured_backend=shell
    rules= mappings= names= fallback_apps=' '
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            '[rules]'|'[rates]'|'[monitor]'|'[names]') section=$line; continue ;;
            \#*|'') continue ;;
            *=*) key=${line%%=*}; value=${line#*=} ;;
            *) continue ;;
        esac
        case "$section:$key" in
            :backend) configured_backend=$value ;;
            '[rules]:global_sample_rate') global_rate=$value ;;
            '[rules]:'*) rules="$rules$key=$value
" ;;
            '[rates]:'*) mappings="$mappings$key=$value
" ;;
            '[names]:'*) names="$names$key=$value
" ;;
            '[monitor]:fallback_enabled') fallback_enabled=$value ;;
            '[monitor]:poll_interval') interval=$value ;;
            '[monitor]:fallback_app') fallback_apps="$fallback_apps$value " ;;
        esac
    done < "$temp"
    rm -f "$temp"
    # The installed package is locked to its build edition; the profile keeps
    # a backend line for schema compatibility but cannot switch it at runtime.
    configured_backend=$(module_edition)
}

# Last matching entry wins, as it does in the configuration editor.
lookup() {
    local entries=$1 key=$2 line
    found=
    [ -n "$key" ] || return 0
    while IFS= read -r line; do
        case "$line" in "$key="*) found=${line#*=} ;; esac
    done <<EOF
$entries
EOF
}
