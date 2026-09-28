#!/usr/bin/env ruby
# Verify the existing theme before the CLI's initial full upload.
require "json"
require "net/http"
require "uri"

uri = URI.join(ENV.fetch("DISCOURSE_URL"), "/admin/customize/themes.json")
request = Net::HTTP::Get.new(uri)
request["Api-Key"] = ENV.fetch("DISCOURSE_API_KEY")
response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", open_timeout: 5, read_timeout: 10) do |http|
  http.request(request)
end
abort "Theme lookup failed (HTTP #{response.code}); check the API key and site." unless response.is_a?(Net::HTTPSuccess)

themes = JSON.parse(response.body).fetch("themes")
target = themes.find { |theme| theme["id"] == 3 }
abort "Theme ID 3 is not ISBF Campus Feed V3; upload cancelled." unless target&.fetch("name") == "ISBF Campus Feed V3"
abort "Theme ID 3 is a component; upload cancelled." if target["component"]
abort "Duplicate V3 themes exist; upload cancelled." unless themes.count { |theme| theme["name"] == target["name"] } == 1

puts "Verified existing theme: #{target.fetch('name')} (id:3)."
