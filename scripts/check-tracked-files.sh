#!/usr/bin/env bash
#
# check-tracked-files.sh
# Check that no binary or large files are accidentally tracked in Git.
#
# This script scans files tracked in Git and flags:
# 1. Binary files (unless their extension is in the allowlist).
# 2. Large files exceeding a configurable limit (default: 1MB/1024KB),
#    unless their path matches an allowlist pattern (like lockfiles).
#
# Exit status is 0 if no problems are found, 1 otherwise.

set -euo pipefail

# ANSI color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default values
MAX_SIZE_KB=1024
CHECK_STAGED=false
VERBOSE=false
NO_COLOR=false

# Default allowed binary extensions
DEFAULT_ALLOWED_BINARIES="png,jpg,jpeg,gif,ico,webp,svg,woff,woff2,eot,ttf,mp3,mp4,pdf,jar,wav"
ALLOWED_BINARIES="$DEFAULT_ALLOWED_BINARIES"

# Default allowed paths/patterns (e.g. lockfiles which are large text files)
DEFAULT_ALLOWED_PATHS="*pnpm-lock.yaml,*package-lock.json,*yarn.lock,*Podfile.lock,*go.sum,*go.work.sum"
ALLOWED_PATHS="$DEFAULT_ALLOWED_PATHS"

show_help() {
    cat << EOF
Usage: $0 [options]

Options:
  -s, --max-size <KB>     Max file size allowed in KB (default: $MAX_SIZE_KB KB)
  --staged                Only check staged (staged for commit) files
  --allow-binary <exts>   Comma-separated list of allowed binary extensions
                          (default: $DEFAULT_ALLOWED_BINARIES)
  --allow-path <patterns> Comma-separated list of glob patterns to ignore size/binary checks
                          (default: $DEFAULT_ALLOWED_PATHS)
  --no-color              Disable colorized output
  -v, --verbose           Print details for all checked files
  -h, --help              Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -s|--max-size)
            MAX_SIZE_KB="$2"
            shift 2
            ;;
        --staged)
            CHECK_STAGED=true
            shift
            ;;
        --allow-binary)
            ALLOWED_BINARIES="$2"
            shift 2
            ;;
        --allow-path)
            ALLOWED_PATHS="$2"
            shift 2
            ;;
        --no-color)
            NO_COLOR=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            show_help >&2
            exit 1
            ;;
    esac
done

if [ "$NO_COLOR" = "true" ] || [ ! -t 1 ]; then
    RED=""
    GREEN=""
    YELLOW=""
    BLUE=""
    BOLD=""
    NC=""
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo -e "${RED}Error: Not in a git repository.${NC}" >&2
    exit 1
fi

EMPTY_TREE=$(git hash-object -t tree /dev/null 2>/dev/null || echo "4b825dc642cb6eb9a060e54bf8d69288fbee4904")

# Load binary files list from git diff --numstat comparing to empty tree
if [ "$CHECK_STAGED" = "true" ]; then
    binary_files=$(git diff --cached --numstat "$EMPTY_TREE" 2>/dev/null | grep '^-	-' | cut -f3- || true)
else
    binary_files=$(git diff --numstat "$EMPTY_TREE" 2>/dev/null | grep '^-	-' | cut -f3- || true)
fi

is_binary_file() {
    local target="$1"
    [ -z "$binary_files" ] && return 1
    case $'\n'"$binary_files"$'\n' in
        *$'\n'"$target"$'\n'*) return 0 ;;
        *) return 1 ;;
    esac
}

is_extension_allowed() {
    local e="$1"
    if [ -n "$e" ]; then
        case ",$ALLOWED_BINARIES," in
            *",$e,"*) return 0 ;;
        esac
    fi
    return 1
}

is_path_allowed() {
    local p="$1"
    [ -z "$ALLOWED_PATHS" ] && return 1
    
    local save_IFS="$IFS"
    IFS=','
    for pattern in $ALLOWED_PATHS; do
        # Trim leading/trailing whitespaces
        pattern=$(echo "$pattern" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        if [ -n "$pattern" ]; then
            case "$p" in
                $pattern) IFS="$save_IFS"; return 0 ;;
            esac
        fi
    done
    IFS="$save_IFS"
    return 1
}

echo -e "${BLUE}${BOLD}Starting git tracked files audit...${NC}"
if [ "$CHECK_STAGED" = "true" ]; then
    echo -e "Mode: ${YELLOW}Staged files only${NC}"
else
    echo -e "Mode: ${YELLOW}All tracked files${NC}"
fi
echo -e "Max size limit: ${YELLOW}${MAX_SIZE_KB} KB${NC}"
echo ""

total_files=0
failed_files=0
failures=()

process_file() {
    local file_mode="$1"
    local file_sha="$2"
    local file_stage="$3"
    local file_path="$4"
    
    # Skip submodules (160000) and symlinks (120000)
    if [ "$file_mode" = "160000" ] || [ "$file_mode" = "120000" ]; then
        return
    fi
    
    total_files=$((total_files + 1))
    
    # Get file size in bytes and convert to KB
    local file_size
    file_size=$(git cat-file -s "$file_sha")
    local file_size_kb=$(( (file_size + 1023) / 1024 ))
    
    local is_bin=false
    if is_binary_file "$file_path"; then
        is_bin=true
    fi
    
    local is_allowed=true
    local reason=""
    
    if [ "$is_bin" = "true" ]; then
        # Get lowercase extension
        local ext="${file_path##*.}"
        ext=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
        if [ "$ext" = "$file_path" ]; then
            ext=""
        fi
        
        # Check if the binary extension is on the allowlist
        if ! is_extension_allowed "$ext"; then
            is_allowed=false
            if [ -z "$ext" ]; then
                reason="Binary file without extension"
            else
                reason="Binary file extension (.$ext) not on allowlist"
            fi
        # Even if the extension is allowed, check if it exceeds the size limit
        elif [ "$file_size_kb" -gt "$MAX_SIZE_KB" ]; then
            if ! is_path_allowed "$file_path"; then
                is_allowed=false
                reason="Binary file size (${file_size_kb} KB) exceeds limit of ${MAX_SIZE_KB} KB"
            fi
        fi
    else
        # For text files, check if size exceeds the limit
        if [ "$file_size_kb" -gt "$MAX_SIZE_KB" ]; then
            if ! is_path_allowed "$file_path"; then
                is_allowed=false
                reason="Text file size (${file_size_kb} KB) exceeds limit of ${MAX_SIZE_KB} KB"
            fi
        fi
    fi
    
    if [ "$is_allowed" = "false" ]; then
        failed_files=$((failed_files + 1))
        failures+=("$file_path: $reason")
        echo -e "${RED}[FAIL]${NC} $file_path ($reason)"
    elif [ "$VERBOSE" = "true" ]; then
        local type_str="text"
        [ "$is_bin" = "true" ] && type_str="bin"
        echo -e "${GREEN}[OK]${NC}   $file_path ($type_str, ${file_size_kb} KB)"
    fi
}

if [ "$CHECK_STAGED" = "true" ]; then
    while IFS= read -r -d '' file; do
        # Retrieve metadata from index for this file
        # git ls-files -s -z returns: <mode> <sha> <stage>\t<path>\0
        line=$(git ls-files -s -z -- "$file" 2>/dev/null | tr '\0' '\n')
        [ -z "$line" ] && continue # Skip if deleted
        
        metadata_part="${line%%$'\t'*}"
        file_path="${line#*$'\t'}"
        read -r file_mode file_sha file_stage <<< "$metadata_part"
        
        process_file "$file_mode" "$file_sha" "$file_stage" "$file_path"
    done < <(git diff --cached --name-only -z)
else
    while IFS= read -r -d '' line; do
        metadata_part="${line%%$'\t'*}"
        file_path="${line#*$'\t'}"
        read -r file_mode file_sha file_stage <<< "$metadata_part"
        
        process_file "$file_mode" "$file_sha" "$file_stage" "$file_path"
    done < <(git ls-files -s -z)
fi

echo ""
echo -e "${BOLD}Audit Summary:${NC}"
echo -e "Total files scanned: $total_files"
echo -e "Failures detected:  $failed_files"

if [ "$failed_files" -gt 0 ]; then
    echo ""
    echo -e "${RED}${BOLD}CRITICAL: Tracked files audit failed!${NC}"
    echo -e "The following files are either binary or too large and should not be tracked:"
    for failure in "${failures[@]}"; do
        echo -e "  - $failure"
    done
    echo ""
    echo -e "${YELLOW}How to fix this:${NC}"
    echo -e "1. If a file was added accidentally, remove it from git tracking (keep local file):"
    echo -e "   ${BOLD}git rm --cached <file_path>${NC}"
    echo -e "2. Add the path or extension to your ${BOLD}.gitignore${NC} so it won't be tracked again."
    echo -e "3. If the file is a necessary large asset, configure it to use Git LFS (Large File Storage)."
    echo -e "4. If this is a legitimate file that MUST be tracked as-is, bypass this check by:"
    echo -e "   - Adding its extension to ${BOLD}--allow-binary${NC}"
    echo -e "   - Adding its path pattern to ${BOLD}--allow-path${NC} (e.g. via Makefile or hook options)"
    exit 1
else
    echo -e "${GREEN}${BOLD}Success: All files passed the tracked files audit!${NC}"
    exit 0
fi
