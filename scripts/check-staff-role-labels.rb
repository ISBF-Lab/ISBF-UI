# frozen_string_literal: true

require "json"
require "tmpdir"

raise "Use the existing test database" unless Rails.env.test?

ENV["ISBF_ROLE_LABELS_LIBRARY_ONLY"] = "1"
load File.expand_path("staff-role-labels.rb", __dir__)
config = ENV.fetch("ISBF_ROLE_LABELS_CONFIG") { File.expand_path("../config/staff-role-labels.json", __dir__) }
labels = IsbfStaffRoleLabels.new(config)
before_groups = Group.where(id: [1, 2]).order(:id).pluck(:id, :name, :full_name)
before_overrides = TranslationOverride.order(:id).pluck(:locale, :translation_key, :value)
checks = []

Dir.mktmpdir("isbf-staff-role-check-") do |directory|
  backup = File.join(directory, "rollback.json")
  ActiveRecord::Base.transaction do
    labels.check!
    labels.apply!(backup)
    raise "Display names not applied" unless Group.find(1).full_name == "开发者" && Group.find(2).full_name == "管理员"
    checks << "apply preserves privileges and identifiers"
    begin
      labels.apply!(backup)
      raise "Existing backup was overwritten"
    rescue Errno::EEXIST
      checks << "backup overwrite refused after canonicalization"
    end
    labels.rollback!(backup)
    raise "Group rollback mismatch" unless before_groups == Group.where(id: [1, 2]).order(:id).pluck(:id, :name, :full_name)
    raise "Translation rollback mismatch" unless before_overrides.sort == TranslationOverride.order(:id).pluck(:locale, :translation_key, :value).sort
    checks << "rollback restores only original labels"
    TranslationOverride.upsert!("zh_CN", "js.admin_title", "自定义角色名称")
    begin
      labels.check!
      raise "Custom translation was overwritten"
    rescue => e
      raise if e.message.exclude?("Preserving an existing custom translation")
      checks << "existing customization protected"
    end
    raise ActiveRecord::Rollback
  end
end
puts JSON.generate(checks: checks)