#!/usr/bin/env bash
set -euo pipefail

# Run as root on the project server with the uploaded archive's SHA-256:
# sudo bash /home/tangency/update-v3-preview.sh /home/tangency/isbf-desktop-ui.zip <sha256>

host_archive=${1:?archive path is required}
expected_sha=${2:?archive SHA-256 is required}
host_importer=/home/tangency/update-v3-preview.rb
container=discourse_dev
container_archive=/tmp/isbf-desktop-ui-preview-20260927.zip
container_importer=/tmp/isbf-update-v3-preview-20260927.rb

[[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]]
test "$host_archive" = /home/tangency/isbf-desktop-ui.zip
test -f "$host_archive"
test -f "$host_importer"
test "$(sha256sum "$host_archive" | cut -d ' ' -f 1)" = "$expected_sha"
test "$(docker inspect --format '{{.Config.Image}} {{.State.Running}}' "$container")" = 'discourse/discourse_dev:release true'
docker exec "$container" test ! -e "$container_archive"
docker exec "$container" test ! -e "$container_importer"

docker cp "$host_archive" "$container:$container_archive"
docker cp "$host_importer" "$container:$container_importer"
docker exec -u discourse:discourse "$container" ruby -c "$container_importer"
docker exec -u discourse:discourse -w /src \
  -e "ISBF_PREVIEW_ARCHIVE=$container_archive" \
  -e "ISBF_PREVIEW_SHA256=$expected_sha" \
  "$container" bin/rails runner "$container_importer"
