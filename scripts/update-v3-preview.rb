# Run with bin/rails runner inside the existing discourse_dev container.
# Updates only the existing ID 3 staff preview; it never changes the default theme.

require "digest"
require "fileutils"
require "pathname"
require "tmpdir"
require "zip"

archive = ENV.fetch("ISBF_PREVIEW_ARCHIVE")
expected_sha = ENV.fetch("ISBF_PREVIEW_SHA256")
theme_id = 3
theme_name = "ISBF Campus Feed V3"
default_theme_id = 2

abort "Invalid SHA-256" unless expected_sha.match?(/\A[0-9a-f]{64}\z/)
abort "Preview archive is missing" unless File.file?(archive)
abort "Preview archive checksum differs" unless Digest::SHA256.file(archive).hexdigest == expected_sha
abort "Default theme changed; inspect before updating" unless SiteSetting.default_theme_id == default_theme_id

theme = Theme.find_by(id: theme_id)
abort "Unexpected preview theme" unless theme&.name == theme_name && !theme.component?
abort "Preview permissions changed" unless theme.enabled? && !theme.user_selectable?
abort "Unexpected V3 theme count" unless Theme.where(name: theme_name).count == 1

Dir.mktmpdir("isbf-v3-preview-") do |directory|
  Zip::File.open(archive) do |zip|
    zip.each do |entry|
      relative = Pathname.new(entry.name).cleanpath
      abort "Invalid path in preview archive" if relative.absolute? || relative.each_filename.include?("..")

      destination = File.join(directory, relative.to_s)
      if entry.directory?
        FileUtils.mkdir_p(destination)
      else
        FileUtils.mkdir_p(File.dirname(destination))
        File.open(destination, "wb") { |file| IO.copy_stream(entry.get_input_stream, file) }
      end
    end
  end

  abort "Theme metadata is missing" unless File.file?(File.join(directory, "about.json"))

  ActiveRecord::Base.transaction do
    updated = RemoteTheme.import_theme_from_directory(
      directory,
      theme_id: theme_id,
      before_save: ->(candidate) { candidate.assign_attributes(enabled: true, user_selectable: false) },
    )

    raise "Unexpected theme after update" unless updated.id == theme_id && updated.name == theme_name
    raise "Default theme changed unexpectedly" unless SiteSetting.default_theme_id == default_theme_id
    raise "Preview state changed unexpectedly" unless updated.reload.enabled? && !updated.user_selectable?
    raise "Unexpected V3 theme count after update" unless Theme.where(name: theme_name).count == 1
    raise "Theme JavaScript was not compiled" unless JavascriptCache.exists?(theme_id: theme_id)
  end

  puts "Updated ISBF V3 staff preview: id=#{theme_id}"
  puts "default_theme_id=#{SiteSetting.default_theme_id}"
  puts "preview_path=/?preview_theme_id=#{theme_id}"
end
