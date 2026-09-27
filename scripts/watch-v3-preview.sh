#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
site_url=http://localhost:3000
cli_bin="$(ruby -e 'print Gem.user_dir')/bin/discourse_theme"
key_dir="$HOME/.config/isbf"
key_file="$key_dir/discourse-theme-api-key"
config_file="$HOME/.discourse_theme"

test -x "$cli_bin" || { echo "Discourse Theme CLI is not installed in WSL" >&2; exit 1; }
test -f "$repo_dir/about.json" || { echo "Theme source is missing" >&2; exit 1; }
ruby -rjson -e 'abort "Unexpected theme source" unless JSON.parse(File.read(ARGV.fetch(0)))["name"] == "ISBF Campus Feed V3"' "$repo_dir/about.json"
curl --fail --silent --show-error --output /dev/null --max-time 5 "$site_url/about.json" || {
  echo "Cannot reach the development site. Keep the localhost:3000 port forward open." >&2
  exit 1
}

if [[ "${1:-}" == "--check" ]]; then
  echo "Theme CLI and the development site are reachable."
  echo "Theme source: $repo_dir"
  exit 0
fi

umask 077
test ! -L "$config_file" || { echo "Theme CLI config file must not be a symlink" >&2; exit 1; }
ruby - "$repo_dir" "$config_file" <<'RUBY'
require "yaml"

directory, filename = ARGV
config = File.exist?(filename) ? YAML.load_file(filename) : {}
abort "Invalid Theme CLI configuration" unless config.is_a?(Hash)
entry = config[directory] ||= {}
abort "Theme CLI is bound to another theme" if entry["theme_id"] && entry["theme_id"].to_i != 3
abort "Theme CLI is bound to another site" if entry["url"] && entry["url"] != "http://localhost:3000"
entry["theme_id"] = 3
entry["url"] = "http://localhost:3000"
File.write(filename, config.to_yaml)
File.chmod(0o600, filename)
RUBY

if [[ "${1:-}" == "--configure" ]]; then
  echo "Theme CLI is bound to the existing V3 preview (id:3)."
  exit 0
fi

test ! -L "$key_dir" || { echo "API key directory must not be a symlink" >&2; exit 1; }
mkdir -p "$key_dir"
chmod 700 "$key_dir"
test ! -L "$key_file" || { echo "API key file must not be a symlink" >&2; exit 1; }

if [[ ! -s "$key_file" ]]; then
  if [[ ! -t 0 ]]; then
    echo "An interactive terminal is required to enter the Discourse API key." >&2
    exit 1
  fi
  echo "Create a single-user Global API key in the development site's Admin > API Keys page."
  read -r -s -p "Paste the API key here (it will not be echoed): " api_key
  echo
  [[ -n "$api_key" ]] || { echo "API key is empty" >&2; exit 1; }
  printf '%s' "$api_key" > "$key_file"
  unset api_key
fi

test "$(stat -c %u "$key_file")" = "$(id -u)" || { echo "API key file has the wrong owner" >&2; exit 1; }
chmod 600 "$key_file"

export DISCOURSE_URL="$site_url"
export DISCOURSE_API_KEY="$(cat "$key_file")"
echo "Select the existing ISBF Campus Feed V3 theme (id:3) when prompted."
echo "Keep this terminal open while editing; press Ctrl+C to stop syncing."
exec ruby -r "$repo_dir/scripts/force-polling.rb" "$cli_bin" watch "$repo_dir"
