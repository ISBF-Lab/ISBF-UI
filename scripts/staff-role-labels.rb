# frozen_string_literal: true
# Run using bin/rails runner. ISBF_ROLE_LABELS_MODE: check, apply, or rollback.
# The rollback file contains site configuration and must stay outside Git.
require "digest"
require "json"

class IsbfStaffRoleLabels
  def initialize(config_path)
    @config = JSON.parse(File.read(config_path))
    raise "Unsupported role labels configuration" unless @config.fetch("version") == 1
    @entries = @config.fetch("translations")
    @groups = @config.fetch("groups")
  end

  def check!
    @groups.each do |entry|
      group = Group.find(entry.fetch("id"))
      unless group.automatic? && group.name == entry.fetch("name")
        raise "System group identity changed: #{group.id}"
      end
    end

    @entries.each do |entry|
      locale, key, value = entry.values_at("locale", "key", "value")
      raise "Translation key unavailable: #{locale}:#{key}" unless I18n.exists?(key, locale)
      record = TranslationOverride.find_or_initialize_by(locale: locale, translation_key: key)
      value = canonical_value(record, value)
      original = canonical_value(record, entry.fetch("original"))
      if record.persisted? && ![original, value].include?(record.value)
        raise "Preserving an existing custom translation: #{locale}:#{key}"
      end
      record.value = value
      record.original_translation = entry.fetch("original")
      raise "Invalid translation #{key}: #{record.errors.full_messages.join(', ')}" unless record.valid?
    end
    { translations: @entries.length, groups: @groups.length, valid: true }
  end

  def apply!(backup_path)
    check!
    snapshot = {
      "version" => 1,
      "config_sha256" => Digest::SHA256.hexdigest(JSON.generate(@config)),
      "permissions_sha256" => permissions_fingerprint,
      "groups" => @groups.map do |entry|
        Group.find(entry.fetch("id")).attributes.slice("id", "name", "full_name").merge(
          "applied_full_name" => entry.fetch("full_name"),
        )
      end,
      "translations" => @entries.map do |entry|
        record = TranslationOverride.find_by(locale: entry.fetch("locale"), translation_key: entry.fetch("key"))
        entry.slice("locale", "key").merge(
          "existed" => !record.nil?,
          "value" => record&.value,
          "applied_value" => canonical_value(record || TranslationOverride.new, entry.fetch("value")),
        )
      end,
    }
    File.open(backup_path, File::WRONLY | File::CREAT | File::EXCL, 0o600) do |file|
      file.write(JSON.pretty_generate(snapshot))
      file.flush
      file.fsync
    end

    ActiveRecord::Base.transaction do
      @entries.each do |entry|
        update_translation(entry.fetch("locale"), entry.fetch("key"), entry.fetch("value"))
      end
      # Automatic-group refresh also rewrites internal names and memberships.
      @groups.each { |entry| Group.find(entry.fetch("id")).update!(full_name: entry.fetch("full_name")) }
      raise "Permissions changed" unless permissions_fingerprint == snapshot.fetch("permissions_sha256")
    end
    { applied: true, translations: @entries.length, groups: @groups.length, permissions_unchanged: true }
  ensure
    TranslationOverride.reload_all_overrides!
  end

  def rollback!(backup_path)
    snapshot = JSON.parse(File.read(backup_path))
    expected_sha = Digest::SHA256.hexdigest(JSON.generate(@config))
    unless snapshot.fetch("version") == 1 && snapshot.fetch("config_sha256") == expected_sha
      raise "Rollback configuration does not match"
    end
    before_permissions = permissions_fingerprint
    snapshot.fetch("groups").each do |entry|
      group = Group.find(entry.fetch("id"))
      unless group.name == entry.fetch("name") && [entry["full_name"], entry.fetch("applied_full_name")].include?(group.full_name)
        raise "Preserving a subsequent group change: #{group.id}"
      end
    end
    snapshot.fetch("translations").each do |entry|
      record = TranslationOverride.find_by(locale: entry.fetch("locale"), translation_key: entry.fetch("key"))
      if [entry["value"], entry.fetch("applied_value")].exclude?(record&.value)
        raise "Preserving a subsequent translation change: #{entry.fetch('key')}"
      end
    end

    ActiveRecord::Base.transaction do
      snapshot.fetch("translations").each do |entry|
        if entry.fetch("existed")
          update_translation(entry.fetch("locale"), entry.fetch("key"), entry.fetch("value"))
        else
          TranslationOverride.revert!(entry.fetch("locale"), entry.fetch("key"))
        end
      end
      snapshot.fetch("groups").each { |entry| Group.find(entry.fetch("id")).update!(full_name: entry["full_name"]) }
      raise "Permissions changed" unless permissions_fingerprint == before_permissions
    end
    { restored: true, permissions_unchanged: true }
  ensure
    TranslationOverride.reload_all_overrides!
  end

  private

  def canonical_value(record, value)
    record.sanitize_field(value, additional_attributes: %w[data-auto-route target])
  end

  def permissions_fingerprint
    Digest::SHA256.hexdigest(JSON.generate(
      users: User.where("admin OR moderator").order(:id).pluck(:id, :admin, :moderator),
      memberships: GroupUser.where(group_id: @groups.map { |g| g.fetch("id") }).order(:group_id, :user_id).pluck(:group_id, :user_id, :owner),
      groups: Group.where(id: @groups.map { |g| g.fetch("id") }).order(:id).pluck(:id, :name, :automatic),
    ))
  end

  def update_translation(locale, key, value)
    record = TranslationOverride.upsert!(locale, key, value)
    raise "Translation update failed: #{key}" unless record.persisted? && record.errors.empty?
  end
end

unless ENV["ISBF_ROLE_LABELS_LIBRARY_ONLY"] == "1"
  config_path = ENV.fetch("ISBF_ROLE_LABELS_CONFIG") { File.expand_path("../config/staff-role-labels.json", __dir__) }
  labels = IsbfStaffRoleLabels.new(config_path)
  result = case ENV.fetch("ISBF_ROLE_LABELS_MODE", "check")
  when "check"
    labels.check!
  when "apply"
    labels.apply!(ENV.fetch("ISBF_ROLE_LABELS_BACKUP"))
  when "rollback"
    labels.rollback!(ENV.fetch("ISBF_ROLE_LABELS_BACKUP"))
  else
    raise "Unknown role labels mode"
  end
  puts JSON.generate(result)
end