# frozen_string_literal: true

require "digest"
require "shellwords"
require "tempfile"
require "time"
require "uri"
require "yaml"

class TaskConfigError < StandardError; end

TaskConfigIssue = Data.define(:path, :code, :message) do
  def to_h
    { "path" => path, "code" => code, "message" => message }
  end
end

class TaskConfigRevisionConflict < TaskConfigError; end

class TaskConfigValidationError < TaskConfigError
  attr_reader :issues

  def initialize(issues)
    @issues = issues
    super(issues.map(&:message).join("\n"))
  end
end

class TaskConfig
  WORKSPACE_DIRECTORY = "InAppFigma"
  CONFIG_FILENAME = "InAppFigma.yaml"
  LAUNCHER_FILENAME = "OpenInAppFigma.command"
  PROJECT_SCRIPT_PATH = ".codex/skills/in-app-swift-figma/scripts/task_config.rb"
  SCHEMA_VERSION = 7
  STATUSES = %w[todo in_progress failed blocked done].freeze
  IMPLEMENTATION_STATUSES = %w[todo in_progress done].freeze
  TASK_KINDS = %w[state behavior popup].freeze
  PAGE_TYPES = %w[view view_controller].freeze
  PAGE_ROLES = %w[screen popup].freeze
  DELIVERY_PROFILES = %w[strict implementation review].freeze
  SYSTEM_UI_COMPONENTS = %w[tab_bar_controller picker].freeze
  DATA_ACCESS_MODES = %w[read_only read_write].freeze
  DESTINATION_STYLES = %w[push sheet full_screen].freeze
  TERMINAL_STYLES = %w[back dismiss].freeze
  TRANSITION_STYLES = (DESTINATION_STYLES + TERMINAL_STYLES + ["external"]).freeze
  BEHAVIOR_TYPES = %w[scroll scroll_lock sticky fixed keyboard_avoidance pull_to_refresh pagination interaction].freeze
  BEHAVIOR_AXES = %w[vertical horizontal both].freeze
  BEHAVIOR_TRIGGER_EVENTS = %w[tap page_appear page_disappear state_enter state_exit timer_finished video_finished custom_event].freeze
  PRESENTATION_ACTION_TYPES = %w[navigate present_popup dismiss_popup].freeze
  BEHAVIOR_ACTION_TYPES = %w[
    navigate present_popup dismiss_popup
    start_countdown stop_countdown
    start_countup stop_countup
    play_video pause_video stop_video
    emit_event custom
  ].freeze
  BEHAVIOR_RUN_POLICIES = %w[once_per_instance every_time].freeze
  STATUS_ACTIONS = %w[claim complete fail block requeue amend].freeze
  TOOL_OWNED_PAGE_FIELDS = %w[
    status attempts commit reason started_at completed_at
    acceptance_history accepted_baseline removed_tasks
  ].freeze
  ID_PATTERN = /\A[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\z/
  PARAMETER_NAME_PATTERN = /\A[A-Za-z_][A-Za-z0-9_]*\z/

  attr_reader :data, :path

  def initialize(path)
    @path = File.expand_path(path)
    @text = File.read(@path)
    @header = leading_comments(@text)
    @data = YAML.safe_load(@text, aliases: false)
    migrate_schema!
    apply_page_defaults!
    validate!(allow_migration_compatibility: true)
  rescue Errno::ENOENT
    raise TaskConfigError, "config not found: #{@path}"
  rescue Psych::Exception => e
    raise TaskConfigError, "invalid YAML: #{e.message}"
  end

  def self.init(path, template_path, project_root:, fallback_script:)
    target = File.expand_path(path)
    root = File.expand_path(project_root)
    unless Dir.exist?(root)
      raise TaskConfigError, "directory does not exist: #{root}"
    end
    workspace = File.join(root, WORKSPACE_DIRECTORY)
    expected_target = File.join(workspace, CONFIG_FILENAME)
    unless target == expected_target
      raise TaskConfigError,
            "#{CONFIG_FILENAME} and #{LAUNCHER_FILENAME} must be stored together in #{workspace}"
    end
    verify_development_files_are_not_packaged!(root)

    Dir.mkdir(workspace) unless Dir.exist?(workspace)
    create_exclusive(target, File.read(template_path))
    launcher = File.join(workspace, LAUNCHER_FILENAME)
    create_exclusive(launcher, launcher_content(fallback_script), mode: 0o755)
  rescue Errno::ENOENT => e
    raise TaskConfigError, e.message
  end

  def self.create_exclusive(path, content, mode: nil)
    File.open(path, File::WRONLY | File::CREAT | File::EXCL) do |file|
      file.write(content)
    end
    File.chmod(mode, path) if mode
    puts "Created #{path}"
  rescue Errno::EEXIST
    puts "Kept existing #{path}"
  end
  private_class_method :create_exclusive

  def self.launcher_content(fallback_script)
    fallback = Shellwords.escape(File.expand_path(fallback_script))
    <<~SH
      #!/bin/sh
      set -eu

      WORKSPACE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
      PROJECT_ROOT=$(CDPATH= cd -- "$WORKSPACE_ROOT/.." && pwd)
      LOCAL_SCRIPT="$PROJECT_ROOT/#{PROJECT_SCRIPT_PATH}"
      if [ -f "$LOCAL_SCRIPT" ]; then
        TASK_CONFIG_SCRIPT="$LOCAL_SCRIPT"
      else
        TASK_CONFIG_SCRIPT=#{fallback}
      fi

      exec ruby "$TASK_CONFIG_SCRIPT" serve --project-root "$PROJECT_ROOT" --config "$WORKSPACE_ROOT/#{CONFIG_FILENAME}"
    SH
  end
  private_class_method :launcher_content

  def self.verify_development_files_are_not_packaged!(project_root)
    project_files = Dir.glob(
      File.join(project_root, "**", "*.xcodeproj", "project.pbxproj")
    )
    if project_files.empty?
      raise TaskConfigError,
            "cannot verify packaging safety: no Xcode project found under #{project_root}"
    end

    project_files.each do |project_file|
      content = File.read(project_file)
      [CONFIG_FILENAME, LAUNCHER_FILENAME].each do |filename|
        next unless content.include?(filename)

        raise TaskConfigError,
              "cannot initialize: #{filename} is referenced by #{project_file}; remove it from Xcode targets and resources first"
      end
      reject_workspace_synchronization!(content, project_file, project_root)
    end
  end
  private_class_method :verify_development_files_are_not_packaged!

  def self.reject_workspace_synchronization!(content, project_file, project_root)
    workspace = File.join(project_root, WORKSPACE_DIRECTORY)
    synchronized_objects = content.scan(
      /\{\s*isa\s*=\s*PBXFileSystemSynchronizedRootGroup\s*;(.*?)\n\s*\};/m
    )
    synchronized_objects.each do |(body)|
      match = body.match(/(?:\A|\n)\s*path\s*=\s*(.*?);/)
      raw_path = match && match[1].strip
      path = unquote_pbx_string(raw_path)
      synchronized_root = if path.nil? || path.empty?
                            File.dirname(File.dirname(project_file))
                          else
                            File.expand_path(path, File.dirname(File.dirname(project_file)))
                          end
      next unless workspace == synchronized_root || workspace.start_with?("#{synchronized_root}#{File::SEPARATOR}")

      raise TaskConfigError,
            "cannot initialize: a filesystem synchronized root in #{project_file} covers the #{WORKSPACE_DIRECTORY} workspace"
    end
  end
  private_class_method :reject_workspace_synchronization!

  def self.unquote_pbx_string(value)
    return nil if value.nil?
    return value unless value.start_with?('"') && value.end_with?('"')

    value[1...-1].gsub(/\\([\\"])/, '\\1')
  end
  private_class_method :unquote_pbx_string

  def self.schema_metadata
    {
      "version" => SCHEMA_VERSION,
      "statuses" => STATUSES,
      "implementation_statuses" => IMPLEMENTATION_STATUSES,
      "task_kinds" => TASK_KINDS,
      "page_types" => PAGE_TYPES,
      "page_roles" => PAGE_ROLES,
      "delivery_profiles" => DELIVERY_PROFILES,
      "system_ui_components" => SYSTEM_UI_COMPONENTS,
      "data_access_modes" => DATA_ACCESS_MODES,
      "transition_styles" => TRANSITION_STYLES,
      "behavior_types" => BEHAVIOR_TYPES,
      "behavior_axes" => BEHAVIOR_AXES,
      "behavior_trigger_events" => BEHAVIOR_TRIGGER_EVENTS,
      "behavior_action_types" => BEHAVIOR_ACTION_TYPES,
      "behavior_run_policies" => BEHAVIOR_RUN_POLICIES
    }
  end

  def self.validate_draft(data, path:)
    config = from_data(data, path: path)
    config.validate!
    {
      "valid" => true,
      "issues" => [],
      "counts" => config.counts.transform_keys(&:to_s),
      "schema" => schema_metadata,
      "changes_by_page" => config.changes_by_page,
      "yaml_preview" => config.normalized_yaml
    }
  rescue TaskConfigError => e
    issues = config ? config.issues_from_error(e) : [TaskConfigIssue.new("config", "invalid_config", e.message)]
    {
      "valid" => false,
      "issues" => issues.map(&:to_h),
      "schema" => schema_metadata,
      "yaml_preview" => YAML.dump(data)
    }
  end

  def revision
    Digest::SHA256.hexdigest(File.binread(path))
  end

  def snapshot
    {
      "config" => Marshal.load(Marshal.dump(data)),
      "revision" => revision,
      "comment_warning" => body_comments?,
      "counts" => counts.transform_keys(&:to_s),
      "schema" => self.class.schema_metadata,
      "changes_by_page" => changes_by_page,
      "issues" => migration_issues.map(&:to_h),
      "project" => {
        "root" => File.dirname(path),
        "config_path" => path
      },
      "yaml_preview" => normalized_yaml
    }
  end

  def replace!(draft, expected_revision:, acknowledge_comment_loss:, confirm_amendments: false)
    require_current_revision!(expected_revision)
    if body_comments? && !acknowledge_comment_loss
      raise TaskConfigError, "YAML body comments would be removed; acknowledge body comments before saving"
    end

    result = self.class.validate_draft(draft, path: path)
    unless result.fetch("valid")
      issues = result.fetch("issues").map do |issue|
        TaskConfigIssue.new(issue.fetch("path"), issue.fetch("code"), issue.fetch("message"))
      end
      raise TaskConfigValidationError, issues
    end

    draft_config = self.class.send(:from_data, draft, path: path)
    reject_removed_done_pages!(draft_config)
    preserve_tool_owned_page_fields!(draft_config)
    amendments = amendment_changes_for(draft_config)
    return { "amendment_required" => true, "changes_by_page" => amendments } if amendments.any? && !confirm_amendments

    amendments.each do |page_key, changes|
      module_id, page_id = page_key.split(".", 2)
      amend_draft_page!(draft_config, module_id, page_id, changes)
    end
    draft_config.validate!
    write_payload!(@header + draft_config.normalized_yaml)
    self.class.new(path).snapshot
  end

  def apply_status!(action:, module_id:, page_id:, expected_revision:, reason: nil, commit: nil)
    require_current_revision!(expected_revision)
    raise TaskConfigError, "unsupported status action #{action}" unless STATUS_ACTIONS.include?(action)

    case action
    when "claim" then claim(module_id, page_id)
    when "complete" then complete(module_id, page_id, commit: commit)
    when "fail" then fail(module_id, page_id, reason: reason)
    when "block" then block(module_id, page_id, reason: reason)
    when "requeue" then requeue(module_id, page_id, reason: reason)
    when "amend" then amend(module_id, page_id, reason: reason)
    end
    self.class.new(path).snapshot
  end

  def normalized_yaml
    YAML.dump(data)
  end

  def issues_from_error(error)
    error.message.lines(chomp: true).map do |message|
      if (match = message.match(/\Aunknown destination (.+)\z/))
        destination = match[1]
        TaskConfigIssue.new(
          destination_path(destination),
          "unknown_destination",
          "Destination #{destination} does not exist."
        )
      else
        TaskConfigIssue.new(issue_path(message), issue_code(message), message)
      end
    end
  end

  def validate!(allow_migration_compatibility: false)
    errors = []
    unless @data.is_a?(Hash)
      raise TaskConfigError, "config root must be a mapping"
    end

    errors << "schema_version must be #{SCHEMA_VERSION}" unless @data["schema_version"] == SCHEMA_VERSION
    unless allow_migration_compatibility
      array_or_empty(@data["migration_compatibility"]).each_with_index do |entry, index|
        reason = entry.is_a?(Hash) ? entry["reason"] : "legacy data requires manual resolution"
        errors << "migration_compatibility[#{index}] #{reason}"
      end
    end
    validate_delivery(errors)
    validate_execution(errors)
    validate_system_ui(errors)
    mock_data_source_ids = validate_mock_data_sources(@data["mock_data_sources"], errors)

    modules = @data["modules"]
    unless modules.is_a?(Array)
      errors << "modules must be an array"
      raise_errors(errors)
    end

    module_ids = {}
    page_roles_by_id = index_page_roles(modules)
    pages_by_id = index_pages(modules)
    modules.each_with_index do |mod, module_index|
      module_path = "modules[#{module_index}]"
      validate_mapping(mod, module_path, errors)
      next unless mod.is_a?(Hash)

      module_id = validate_id(mod["id"], "#{module_path}.id", errors)
      validate_title(mod["title"], "#{module_path}.title", errors)
      duplicate_id(module_ids, module_id, "module", errors)

      pages = mod["pages"]
      unless pages.is_a?(Array)
        errors << "#{module_path}.pages must be an array"
        next
      end

      local_page_ids = {}
      pages.each_with_index do |page, page_index|
        page_path = "#{module_path}.pages[#{page_index}]"
        validate_page(page, page_path, module_id, local_page_ids, page_roles_by_id, pages_by_id, mock_data_source_ids, errors)
      end

      entry_page = mod["entry_page"]
      screen_page_ids = local_page_ids.select do |page_id, _page|
        page_roles_by_id["#{module_id}.#{page_id}"] == "screen"
      end
      if screen_page_ids.empty? && !entry_page.nil?
        errors << "#{module_path}.entry_page must be null when the module has no screen pages"
      elsif screen_page_ids.any? && (!entry_page.is_a?(String) || !local_page_ids.key?(entry_page))
        errors << "#{module_path}.entry_page must reference a page in module #{module_id}"
      elsif screen_page_ids.any? && page_roles_by_id["#{module_id}.#{entry_page}"] != "screen"
        errors << "#{module_path}.entry_page must reference a screen page"
      end
    end

    raise_errors(errors)
    true
  end

  def migration_issues
    array_or_empty(data["migration_compatibility"]).each_with_index.map do |entry, index|
      reason = entry.is_a?(Hash) ? entry["reason"] : "Legacy data requires manual resolution."
      path = entry.is_a?(Hash) && non_empty_string?(entry["path"]) ? entry["path"] : "migration_compatibility[#{index}]"
      TaskConfigIssue.new(path, "migration_required", reason)
    end
  end

  def counts
    pages = each_page.to_a
    {
      pages: pages.length,
      states: pages.sum { |_mod, page| page.fetch("states", []).length },
      behaviors: pages.sum { |_mod, page| page.fetch("behaviors", []).length },
      mock_data_sources: data.fetch("mock_data_sources", []).length
    }
  end

  def list(eligible: false)
    allowed = eligible ? %w[todo failed] : STATUSES
    each_page.filter_map do |mod, page|
      next unless allowed.include?(page["status"])

      format(
        "%<id>s\t%<status>s\tattempts=%<attempts>d\t%<title>s",
        id: "#{mod.fetch("id")}.#{page.fetch("id")}",
        status: page.fetch("status"),
        attempts: page.fetch("attempts"),
        title: page.fetch("title")
      )
    end
  end

  def claim(module_id, page_id)
    page = find_page(module_id, page_id)
    status = page.fetch("status")
    unless %w[todo failed].include?(status)
      raise TaskConfigError, "#{module_id}.#{page_id} is already #{status}"
    end

    page["status"] = "in_progress"
    page["attempts"] = page.fetch("attempts") + 1
    page["reason"] = nil
    page["commit"] = nil
    page["started_at"] = timestamp
    page["completed_at"] = nil
    save!
  end

  def complete(module_id, page_id, commit: nil)
    page = require_in_progress(module_id, page_id)
    reconcile_removed_tasks!(page)
    incomplete = incomplete_tasks(page)
    unless incomplete.empty?
      raise TaskConfigError, "incomplete implementation tasks: #{incomplete.join(', ')}"
    end

    page["status"] = "done"
    page["commit"] = commit
    page["reason"] = nil
    page["completed_at"] = timestamp
    page["accepted_baseline"] = accepted_contract(page)
    page["removed_tasks"] = []
    save!
  end

  def page_changes(module_id, page_id)
    page = find_page(module_id, page_id)
    page_changes_for(module_id, page_id, page)
  end

  def changes_by_page
    each_page.each_with_object({}) do |(mod, page), result|
      result["#{mod.fetch("id")}.#{page.fetch("id")}"] = page_changes(mod.fetch("id"), page.fetch("id"))
    end
  end

  def fail(module_id, page_id, reason:)
    transition_from_in_progress(module_id, page_id, "failed", reason)
  end

  def block(module_id, page_id, reason:)
    transition_from_in_progress(module_id, page_id, "blocked", reason)
  end

  def requeue(module_id, page_id, reason:)
    page = find_page(module_id, page_id)
    unless %w[in_progress failed blocked].include?(page.fetch("status"))
      raise TaskConfigError, "#{module_id}.#{page_id} cannot be requeued from #{page.fetch("status")}"
    end

    require_reason!(reason)
    page["status"] = "todo"
    page["reason"] = reason
    page["commit"] = nil
    page["started_at"] = nil
    page["completed_at"] = nil
    save!
  end

  def amend(module_id, page_id, reason:)
    require_reason!(reason)
    page = find_page(module_id, page_id)
    unless page.fetch("status") == "done"
      raise TaskConfigError, "#{module_id}.#{page_id} must be done before amendment"
    end

    started_at = timestamp
    page.fetch("acceptance_history") << {
      "commit" => page["commit"],
      "completed_at" => page["completed_at"],
      "superseded_at" => started_at,
      "amendment_reason" => reason
    }
    page["status"] = "in_progress"
    page["attempts"] = page.fetch("attempts") + 1
    page["reason"] = reason
    page["commit"] = nil
    page["started_at"] = started_at
    page["completed_at"] = nil
    save!
  end

  private

  def self.from_data(data, path:)
    instance = allocate
    instance.instance_variable_set(:@path, File.expand_path(path))
    instance.instance_variable_set(:@text, "")
    instance.instance_variable_set(:@header, "")
    instance.instance_variable_set(:@data, Marshal.load(Marshal.dump(data)))
    instance.send(:migrate_schema!)
    instance.send(:apply_page_defaults!)
    instance
  end
  private_class_method :from_data

  def amendment_changes_for(draft_config)
    each_page.each_with_object({}) do |(mod, disk_page), result|
      next unless disk_page["status"] == "done"

      module_id = mod.fetch("id")
      page_id = disk_page.fetch("id")
      draft_page = draft_config.send(:find_page_or_nil, module_id, page_id)
      next unless draft_page

      changes = page_changes_for(module_id, page_id, draft_page)
      changed = %w[states behaviors popup].any? { |kind| changes.fetch(kind).any? }
      result["#{module_id}.#{page_id}"] = changes if changed
    end
  end

  def reject_removed_done_pages!(draft_config)
    each_page do |mod, disk_page|
      next unless disk_page["status"] == "done"

      module_id = mod.fetch("id")
      page_id = disk_page.fetch("id")
      next if draft_config.send(:find_page_or_nil, module_id, page_id)

      raise TaskConfigError, "#{module_id}.#{page_id} must be amended before removal"
    end
  end

  def preserve_tool_owned_page_fields!(draft_config)
    each_page do |mod, disk_page|
      draft_page = draft_config.send(:find_page_or_nil, mod.fetch("id"), disk_page.fetch("id"))
      next unless draft_page

      TOOL_OWNED_PAGE_FIELDS.each do |field|
        next if field == "removed_tasks"

        draft_page[field] = Marshal.load(Marshal.dump(disk_page[field]))
      end
      reconcile_removed_tasks!(draft_page)
    end
  end

  def page_changes_for(module_id, page_id, page)
    reconcile_removed_tasks!(page)
    baseline = page["accepted_baseline"] || { "states" => [], "behaviors" => [], "popup" => nil }
    {
      "page" => "#{module_id}.#{page_id}",
      "states" => diff_collection("state", baseline.fetch("states", []), page.fetch("states"), page.fetch("removed_tasks")),
      "behaviors" => diff_collection("behavior", baseline.fetch("behaviors", []), page.fetch("behaviors"), page.fetch("removed_tasks")),
      "popup" => diff_collection(
        "popup",
        popup_task_collection(baseline["popup"]),
        popup_task_collection(page["popup"]),
        page.fetch("removed_tasks")
      )
    }
  end

  def amend_draft_page!(draft_config, module_id, page_id, changes)
    disk_page = find_page(module_id, page_id)
    draft_page = draft_config.send(:find_page, module_id, page_id)
    started_at = timestamp
    task_ids = %w[states behaviors popup].flat_map { |kind| changes.fetch(kind) }.map do |change|
      "#{change.fetch('kind')}:#{change.fetch('id')}"
    end.uniq.sort

    draft_page["acceptance_history"] = Marshal.load(Marshal.dump(disk_page.fetch("acceptance_history")))
    draft_page.fetch("acceptance_history") << {
      "commit" => disk_page["commit"],
      "completed_at" => disk_page["completed_at"],
      "superseded_at" => started_at,
      "amendment_reason" => "Automatic amendment: #{task_ids.join(', ')}"
    }
    draft_page["accepted_baseline"] = Marshal.load(Marshal.dump(disk_page["accepted_baseline"]))
    reset_amended_task_statuses!(draft_page, changes)
    draft_page["status"] = "in_progress"
    draft_page["attempts"] = disk_page.fetch("attempts") + 1
    draft_page["reason"] = "Automatic amendment: #{task_ids.join(', ')}"
    draft_page["commit"] = nil
    draft_page["started_at"] = started_at
    draft_page["completed_at"] = nil
  end

  def reset_amended_task_statuses!(page, changes)
    changed = {
      "state" => changes.fetch("states").map { |change| change.fetch("id") }.to_h { |id| [id, true] },
      "behavior" => changes.fetch("behaviors").map { |change| change.fetch("id") }.to_h { |id| [id, true] },
      "popup" => changes.fetch("popup").map { |change| change.fetch("id") }.to_h { |id| [id, true] }
    }
    { "state" => "states", "behavior" => "behaviors" }.each do |kind, collection|
      array_or_empty(page[collection]).each do |task|
        next unless task.is_a?(Hash)

        task["implementation_status"] = changed.fetch(kind).key?(task["id"]) ? "todo" : "done"
      end
    end
    if page["popup"].is_a?(Hash)
      page["popup"]["implementation_status"] = changed.fetch("popup").key?("structure") ? "todo" : "done"
    end
    reconcile_removed_tasks!(page)
    page.fetch("removed_tasks").each { |task| task["implementation_status"] = "todo" }
  end

  def destination_path(destination)
    data.fetch("modules", []).each_with_index do |mod, module_index|
      next unless mod.is_a?(Hash)
      mod.fetch("pages", []).each_with_index do |page, page_index|
        next unless page.is_a?(Hash)
        page.fetch("behaviors", []).each_with_index do |behavior, behavior_index|
          actions = behavior.is_a?(Hash) ? behavior["actions"] : nil
          next unless actions.is_a?(Array)

          actions.each_with_index do |action, action_index|
            next unless action.is_a?(Hash) && action["destination"] == destination

            raw = "modules[#{module_index}].pages[#{page_index}].behaviors[#{behavior_index}].actions[#{action_index}].destination"
            return canonical_issue_path(raw)
          end
        end
      end
    end
    "modules"
  end

  def issue_path(message)
    raw = message[/\A(?:duplicate\s+)?((?:modules|mock_data_sources|system_ui)(?:\[[0-9]+\])?(?:\.[A-Za-z0-9_\[\]-]+)*)/]
    return message.start_with?("execution") ? message.split.first : "config" unless raw

    path = canonical_issue_path(raw)
    return path.sub(/\.(?:push|sheet|full_screen)\z/, ".destination") if message.include?("requires destination")
    return path.sub(/\.external\z/, ".url") if message.include?("requires url")

    path
  end

  def canonical_issue_path(raw)
    match = raw.match(/\Amodules\[([0-9]+)\](.*)\z/)
    return raw unless match

    module_index = match[1].to_i
    mod = data.fetch("modules", [])[module_index]
    path = collection_item_path("modules", mod, module_index)
    remainder = match[2]

    if (page_match = remainder.match(/\A\.pages\[([0-9]+)\](.*)\z/))
      page_index = page_match[1].to_i
      page = mod.is_a?(Hash) && mod["pages"].is_a?(Array) ? mod["pages"][page_index] : nil
      path = collection_item_path("#{path}.pages", page, page_index)
      remainder = page_match[2]

      if (behavior_match = remainder.match(/\A\.behaviors\[([0-9]+)\](.*)\z/))
        behavior_index = behavior_match[1].to_i
        behavior = page.is_a?(Hash) && page["behaviors"].is_a?(Array) ? page["behaviors"][behavior_index] : nil
        path = collection_item_path("#{path}.behaviors", behavior, behavior_index)
        remainder = behavior_match[2]
      end
    end

    "#{path}#{remainder}"
  end

  def collection_item_path(collection_path, item, index)
    if item.is_a?(Hash) && valid_id?(item["id"])
      "#{collection_path}.#{item['id']}"
    else
      "#{collection_path}[#{index}]"
    end
  end

  def issue_code(message)
    return "migration_required" if message.start_with?("migration_compatibility[")
    return "required" if message.include?("required") || message.include?("requires") || message.include?("must contain")
    return "duplicate_id" if message.start_with?("duplicate")
    return "invalid_type" if message.include?("must be a mapping") || message.include?("must be an array")
    return "invalid_url" if message.include?("URL") || message.include?("url")

    "invalid_value"
  end

  def valid_id?(value)
    value.is_a?(String) && ID_PATTERN.match?(value)
  end

  def validate_execution(errors)
    execution = @data["execution"]
    unless execution.is_a?(Hash)
      errors << "execution must be a mapping"
      return
    end

    errors << "execution.parallel must be true or false" unless [true, false].include?(execution["parallel"])
    max_parallel = execution["max_parallel"]
    unless max_parallel.is_a?(Integer) && max_parallel.positive?
      errors << "execution.max_parallel must be a positive integer"
    end
  end

  def validate_delivery(errors)
    delivery = @data["delivery"]

    unless delivery.is_a?(Hash)
      errors << "delivery must be a mapping"
      return
    end
    unless DELIVERY_PROFILES.include?(delivery["profile"])
      errors << "delivery.profile must be one of #{DELIVERY_PROFILES.join(', ')}"
    end
  end

  def validate_system_ui(errors)
    system_ui = @data["system_ui"]
    unless system_ui.is_a?(Hash)
      errors << "system_ui must be a mapping"
      return
    end

    system_ui.each_key do |component|
      errors << "system_ui.#{component} is not supported" unless SYSTEM_UI_COMPONENTS.include?(component)
    end
    SYSTEM_UI_COMPONENTS.each do |component|
      unless [true, false].include?(system_ui[component])
        errors << "system_ui.#{component} must be true or false"
      end
    end
  end

  def validate_page(page, page_path, module_id, local_ids, page_roles_by_id, pages_by_id, mock_data_source_ids, errors)
    validate_mapping(page, page_path, errors)
    return unless page.is_a?(Hash)

    page_id = validate_id(page["id"], "#{page_path}.id", errors)
    validate_title(page["title"], "#{page_path}.title", errors)
    validate_swift_page_title(page["title"], "#{page_path}.title", errors)
    unless PAGE_TYPES.include?(page["page_type"])
      errors << "#{page_path}.page_type must be one of #{PAGE_TYPES.join(", ")}"
    end
    unless PAGE_ROLES.include?(page["page_role"])
      errors << "#{page_path}.page_role must be one of #{PAGE_ROLES.join(", ")}"
    end
    duplicate_id(local_ids, page_id, "page in module #{module_id}", errors)

    canonical_id = module_id && page_id ? "#{module_id}.#{page_id}" : nil

    status = page["status"]
    errors << "#{page_path}.status must be one of #{STATUSES.join(", ")}" unless STATUSES.include?(status)
    attempts = page["attempts"]
    errors << "#{page_path}.attempts must be a non-negative integer" unless attempts.is_a?(Integer) && attempts >= 0
    if %w[failed blocked].include?(status) && blank?(page["reason"])
      errors << "#{page_path}.reason is required when status is #{status}"
    end

    validate_acceptance_history(page["acceptance_history"], page_path, errors)

    validate_data_dependencies(page["data_dependencies"], page_path, mock_data_source_ids, errors)
    validate_popup(page, page_path, errors)

    state_ids = validate_states(page["states"], page_path, errors)
    errors << "#{page_path}.state_transitions is not supported in schema v7; use behaviors" if page.key?("state_transitions")
    errors << "#{page_path}.navigation is not supported in schema v7; use behaviors with actions.type navigate" if page.key?("navigation")
    validate_behaviors(
      page.fetch("behaviors", []),
      page_path,
      state_ids,
      canonical_id,
      page["page_role"],
      page_roles_by_id,
      pages_by_id,
      errors
    )
    validate_accepted_baseline(page["accepted_baseline"], page_path, errors)
    validate_removed_tasks(page["removed_tasks"], page_path, errors)
  end

  def validate_popup(page, page_path, errors)
    popup = page["popup"]
    if page["page_role"] == "popup"
      unless popup.is_a?(Hash)
        errors << "#{page_path}.popup is required when page_role is popup"
        return
      end
    elsif page.key?("popup")
      errors << "#{page_path}.popup is allowed only when page_role is popup"
      return unless popup.is_a?(Hash)
    else
      return
    end

    validate_implementation_status(popup, "#{page_path}.popup", errors)
    fields = popup["fields"]
    unless fields.is_a?(Hash)
      errors << "#{page_path}.popup.fields must be a mapping"
    else
      %w[title subtitle content].each do |field|
        unless [true, false].include?(fields[field])
          errors << "#{page_path}.popup.fields.#{field} must be true or false"
        end
      end
      unknown = fields.keys - %w[title subtitle content]
      unknown.each { |field| errors << "#{page_path}.popup.fields.#{field} is not supported" }
    end

    buttons = popup["buttons"]
    unless buttons.is_a?(Array)
      errors << "#{page_path}.popup.buttons must be an array"
      return
    end
    seen = {}
    buttons.each_with_index do |button, index|
      button_path = "#{page_path}.popup.buttons[#{index}]"
      unless button.is_a?(Hash)
        errors << "#{button_path} must be a mapping"
        next
      end
      errors << "#{button_path} must contain only id" unless button.keys == ["id"]
      button_id = validate_id(button["id"], "#{button_path}.id", errors)
      duplicate_id(seen, button_id, "popup button", errors)
    end
  end

  def validate_mock_data_sources(sources, errors)
    unless sources.is_a?(Array)
      errors << "mock_data_sources must be an array"
      return {}
    end

    ids = {}
    sources.each_with_index do |source, index|
      source_path = "mock_data_sources[#{index}]"
      validate_mapping(source, source_path, errors)
      next unless source.is_a?(Hash)

      source_id = validate_id(source["id"], "#{source_path}.id", errors)
      duplicate_id(ids, source_id, "mock data source", errors)
      unless swift_type_name?(source["swift_type"])
        errors << "#{source_path}.swift_type must be a Swift type name"
      end
      errors << "#{source_path}.fixture is required" unless non_empty_string?(source["fixture"])
    end
    ids
  end

  def validate_acceptance_history(history, page_path, errors)
    unless history.is_a?(Array)
      errors << "#{page_path}.acceptance_history must be an array"
      return
    end

    history.each_with_index do |entry, index|
      entry_path = "#{page_path}.acceptance_history[#{index}]"
      validate_mapping(entry, entry_path, errors)
      next unless entry.is_a?(Hash)

      %w[commit completed_at].each do |field|
        if !entry[field].nil? && !non_empty_string?(entry[field])
          errors << "#{entry_path}.#{field} must be null or a non-empty string"
        end
      end
      %w[superseded_at amendment_reason].each do |field|
        unless non_empty_string?(entry[field])
          errors << "#{entry_path}.#{field} must be a non-empty string"
        end
      end
    end
  end

  def validate_data_dependencies(dependencies, page_path, source_ids, errors)
    unless dependencies.is_a?(Array)
      errors << "#{page_path}.data_dependencies must be an array"
      return
    end

    seen = {}
    dependencies.each_with_index do |dependency, index|
      dependency_path = "#{page_path}.data_dependencies[#{index}]"
      validate_mapping(dependency, dependency_path, errors)
      next unless dependency.is_a?(Hash)

      source = dependency["source"]
      unless source.is_a?(String) && source_ids.key?(source)
        errors << "#{dependency_path}.source must reference a mock data source"
      end
      if source.is_a?(String)
        if seen.key?(source)
          errors << "#{dependency_path}.source duplicates #{source}"
        else
          seen[source] = true
        end
      end
      unless DATA_ACCESS_MODES.include?(dependency["access"])
        errors << "#{dependency_path}.access must be one of #{DATA_ACCESS_MODES.join(", ")}"
      end
    end
  end

  def validate_states(states, page_path, errors)
    unless states.is_a?(Array) && states.any?
      errors << "#{page_path}.states must contain at least one state"
      return {}
    end

    ids = {}
    states.each_with_index do |state, index|
      state_path = "#{page_path}.states[#{index}]"
      validate_mapping(state, state_path, errors)
      next unless state.is_a?(Hash)

      state_id = validate_id(state["id"], "#{state_path}.id", errors)
      duplicate_id(ids, state_id, "state", errors)
      validate_title(state["title"], "#{state_path}.title", errors)
      errors << "#{state_path}.figma_url must be a Figma URL" unless figma_url?(state["figma_url"])
      validate_implementation_status(state, state_path, errors)
    end
    ids
  end

  def validate_behaviors(behaviors, page_path, state_ids, source_id, source_role, page_roles_by_id, pages_by_id, errors)
    unless behaviors.is_a?(Array)
      errors << "#{page_path}.behaviors must be an array"
      return
    end

    ids = {}
    behavior_lookup = behaviors.each_with_object({}) do |behavior, lookup|
      next unless behavior.is_a?(Hash) && valid_id?(behavior["id"])

      lookup[behavior["id"]] = behavior
    end
    behaviors.each_with_index do |behavior, index|
      behavior_path = "#{page_path}.behaviors[#{index}]"
      validate_mapping(behavior, behavior_path, errors)
      next unless behavior.is_a?(Hash)

      behavior_id = validate_id(behavior["id"], "#{behavior_path}.id", errors)
      duplicate_id(ids, behavior_id, "behavior", errors)
      unless BEHAVIOR_TYPES.include?(behavior["type"])
        errors << "#{behavior_path}.type must be one of #{BEHAVIOR_TYPES.join(", ")}"
      end
      unless behavior["target"].is_a?(String) && !behavior["target"].strip.empty?
        errors << "#{behavior_path}.target is required"
      end
      if behavior.key?("axis") && !BEHAVIOR_AXES.include?(behavior["axis"])
        errors << "#{behavior_path}.axis must be one of #{BEHAVIOR_AXES.join(", ")}"
      end
      validate_string_list(behavior, "fixed_regions", behavior_path, errors)
      validate_implementation_status(behavior, behavior_path, errors)

      if behavior.key?("states")
        states = behavior["states"]
        valid_states = states.is_a?(Array) &&
                       states.all? { |state_id| state_id.is_a?(String) && state_ids.key?(state_id) } &&
                       states.uniq.length == states.length
        errors << "#{behavior_path}.states must reference unique states in this page" unless valid_states
      end
      %w[condition note].each do |key|
        next unless behavior.key?(key)
        unless behavior[key].is_a?(String) && !behavior[key].strip.empty?
          errors << "#{behavior_path}.#{key} must be a non-empty string"
        end
      end
      validate_interaction_behavior(
        behavior,
        behavior_path,
        behavior_lookup,
        state_ids,
        source_id,
        source_role,
        page_roles_by_id,
        pages_by_id,
        errors
      ) if behavior["type"] == "interaction"
    end
  end

  def validate_interaction_behavior(
    behavior,
    behavior_path,
    behavior_lookup,
    state_ids,
    source_id,
    source_role,
    page_roles_by_id,
    pages_by_id,
    errors
  )
    unless BEHAVIOR_RUN_POLICIES.include?(behavior["run_policy"])
      errors << "#{behavior_path}.run_policy must be one of #{BEHAVIOR_RUN_POLICIES.join(", ")}"
    end

    trigger = behavior["trigger"]
    unless trigger.is_a?(Hash)
      errors << "#{behavior_path}.trigger must be a mapping"
      return
    end
    event = trigger["event"]
    unless BEHAVIOR_TRIGGER_EVENTS.include?(event)
      errors << "#{behavior_path}.trigger.event must be one of #{BEHAVIOR_TRIGGER_EVENTS.join(", ")}"
    end
    if %w[timer_finished video_finished].include?(event)
      source_behavior = behavior_lookup[trigger["source"]]
      required_action = event == "timer_finished" ? "start_countdown" : "play_video"
      source_actions = source_behavior.is_a?(Hash) ? source_behavior["actions"] : nil
      valid_source = source_behavior.is_a?(Hash) &&
                     source_behavior["type"] == "interaction" &&
                     source_actions.is_a?(Array) &&
                     source_actions.any? { |action| action.is_a?(Hash) && action["type"] == required_action }
      unless valid_source
        errors << "#{behavior_path}.trigger.source must reference a #{required_action} behavior in this page"
      end
    elsif event == "custom_event" && !non_empty_string?(trigger["name"])
      errors << "#{behavior_path}.trigger.name is required for custom_event"
    end

    errors << "#{behavior_path}.action is not supported in schema v7; use state_change or actions" if behavior.key?("action")

    state_change = behavior["state_change"]
    actions = behavior["actions"]
    has_state_change = non_empty_string?(state_change)
    has_actions = actions.is_a?(Array) && actions.any?
    errors << "#{behavior_path} must define state_change or at least one action" unless has_state_change || has_actions

    if behavior.key?("state_change") && !(state_change.is_a?(String) && state_ids.key?(state_change))
      errors << "#{behavior_path}.state_change must reference a state in this page"
    end
    if behavior.key?("actions") && !actions.is_a?(Array)
      errors << "#{behavior_path}.actions must be an array"
      return
    end
    return unless actions.is_a?(Array)

    validate_behavior_action_list(
      actions,
      behavior_path,
      state_ids,
      source_id,
      source_role,
      page_roles_by_id,
      pages_by_id,
      errors
    )
  end

  def validate_behavior_action_list(actions, owner_path, caller_state_ids, source_id, source_role, page_roles_by_id, pages_by_id, errors)
    presentation_indices = []
    actions.each_with_index do |action, index|
      action_path = "#{owner_path}.actions[#{index}]"
      validate_behavior_action(
        action,
        action_path,
        caller_state_ids,
        source_id,
        source_role,
        page_roles_by_id,
        pages_by_id,
        errors
      )
      presentation_indices << index if action.is_a?(Hash) && PRESENTATION_ACTION_TYPES.include?(action["type"])
    end
    if presentation_indices.length > 1
      errors << "#{owner_path}.actions must contain at most one presentation action"
    end
    if (misordered_index = presentation_indices.find { |index| index != actions.length - 1 })
      errors << "#{owner_path}.actions[#{misordered_index}] presentation actions must be last"
    end
  end

  def validate_behavior_action(action, action_path, caller_state_ids, source_id, source_role, page_roles_by_id, pages_by_id, errors)
    unless action.is_a?(Hash)
      errors << "#{action_path} must be a mapping"
      return
    end

    action_type = action["type"]
    unless BEHAVIOR_ACTION_TYPES.include?(action_type)
      errors << "#{action_path}.type must be one of #{BEHAVIOR_ACTION_TYPES.join(", ")}"
      return
    end

    validate_behavior_parameters(action, action_path, errors)
    case action_type
    when "navigate"
      validate_navigation_action(action, action_path, source_id, page_roles_by_id, errors)
    when "present_popup"
      errors << "#{action_path}.present_popup requires destination" if blank?(action["destination"])
      errors << "#{action_path}.present_popup must not define url" unless blank?(action["url"])
      errors << "#{action_path}.present_popup must not define destination_instance" unless blank?(action["destination_instance"])
      errors << "#{action_path}.present_popup must not define parameters" if action.key?("parameters")
      validate_destination_role(action, action_path, "popup", page_roles_by_id, errors)
      validate_present_popup(action, action_path, caller_state_ids, source_id, source_role, page_roles_by_id, pages_by_id, errors)
    when "dismiss_popup"
      errors << "#{action_path}.dismiss_popup must not define destination" unless blank?(action["destination"])
      errors << "#{action_path}.dismiss_popup must not define url" unless blank?(action["url"])
      errors << "#{action_path}.dismiss_popup must not define destination_instance" unless blank?(action["destination_instance"])
      errors << "#{action_path}.dismiss_popup must not define parameters" unless blank?(action["parameters"])
    when "start_countdown", "stop_countdown", "start_countup", "stop_countup", "play_video", "pause_video", "stop_video"
      validate_action_target(action, action_path, errors)
    when "emit_event", "custom"
      errors << "#{action_path}.name is required for #{action_type}" unless non_empty_string?(action["name"])
    end
  end

  def validate_present_popup(action, action_path, caller_state_ids, source_id, source_role, page_roles_by_id, pages_by_id, errors)
    template = pages_by_id[action["destination"]]
    popup = template.is_a?(Hash) ? template["popup"] : nil
    return unless popup.is_a?(Hash)

    enabled_fields = %w[title subtitle content].select { |field| popup.dig("fields", field) == true }
    content = action["content"]
    unless content.is_a?(Hash)
      errors << "#{action_path}.content must be a mapping"
      content = {}
    end
    enabled_fields.each do |field|
      if !content.key?(field)
        errors << "#{action_path}.content.#{field} is required by the popup template"
      elsif !non_empty_string?(content[field])
        errors << "#{action_path}.content.#{field} must be a non-empty string"
      end
    end
    (content.keys - enabled_fields).each do |field|
      errors << "#{action_path}.content.#{field} is not enabled by the popup template"
    end

    expected_ids = array_or_empty(popup["buttons"]).filter_map { |button| button["id"] if button.is_a?(Hash) }
    buttons = action["buttons"]
    unless buttons.is_a?(Array)
      errors << "#{action_path}.buttons must be an array"
      return
    end
    actual_ids = buttons.filter_map { |button| button["id"] if button.is_a?(Hash) }
    unless actual_ids == expected_ids && buttons.length == expected_ids.length
      errors << "#{action_path}.buttons must match popup template button order: #{expected_ids.join(', ')}"
    end
    buttons.each_with_index do |button, index|
      button_path = "#{action_path}.buttons[#{index}]"
      unless button.is_a?(Hash)
        errors << "#{button_path} must be a mapping"
        next
      end
      errors << "#{button_path}.text must be a non-empty string" unless non_empty_string?(button["text"])
      validate_popup_callback(
        button["callback"],
        "#{button_path}.callback",
        caller_state_ids,
        source_id,
        source_role,
        page_roles_by_id,
        pages_by_id,
        errors
      )
    end
  end

  def validate_popup_callback(callback, callback_path, caller_state_ids, source_id, source_role, page_roles_by_id, pages_by_id, errors)
    unless callback.is_a?(Hash)
      errors << "#{callback_path} must be a mapping"
      return
    end

    state_change = callback["state_change"]
    actions = callback["actions"]
    has_state_change = non_empty_string?(state_change)
    has_actions = actions.is_a?(Array) && actions.any?
    unless has_state_change || has_actions
      errors << "#{callback_path} must define state_change or at least one action"
    end
    if callback.key?("state_change") && !(state_change.is_a?(String) && caller_state_ids.key?(state_change))
      errors << "#{callback_path}.state_change must reference a state in the calling page"
    end
    if callback.key?("actions") && !actions.is_a?(Array)
      errors << "#{callback_path}.actions must be an array"
      return
    end
    return unless actions.is_a?(Array)

    validate_behavior_action_list(
      actions,
      callback_path,
      caller_state_ids,
      source_id,
      source_role,
      page_roles_by_id,
      pages_by_id,
      errors
    )
  end

  def validate_action_target(action, action_path, errors)
    return if non_empty_string?(action["target"])

    errors << "#{action_path}.target is required for #{action['type']}"
  end

  def validate_navigation_action(action, action_path, source_id, page_roles_by_id, errors)
    if action.key?("branches")
      %w[style destination destination_instance url parameters].each do |field|
        errors << "#{action_path}.navigate with branches must not define #{field}" if action.key?(field)
      end
      branches = action["branches"]
      unless branches.is_a?(Array) && branches.length >= 2
        errors << "#{action_path}.branches must contain at least two navigation branches"
        return
      end
      conditions = []
      branches.each_with_index do |branch, index|
        branch_path = "#{action_path}.branches[#{index}]"
        unless branch.is_a?(Hash)
          errors << "#{branch_path} must be a mapping"
          next
        end
        condition = branch["condition"]
        unless non_empty_string?(condition)
          errors << "#{branch_path}.condition must be a non-empty string"
        else
          conditions << condition
        end
        validate_behavior_parameters(branch, branch_path, errors)
        validate_navigation_route(branch, branch_path, source_id, page_roles_by_id, errors)
      end
      errors << "#{action_path}.branches conditions must be unique" unless conditions.uniq.length == conditions.length
      return
    end

    validate_navigation_route(action, action_path, source_id, page_roles_by_id, errors)
  end

  def validate_navigation_route(route, route_path, source_id, page_roles_by_id, errors)
    style = route["style"]
    errors << "#{route_path}.style must be one of #{TRANSITION_STYLES.join(', ')}" unless TRANSITION_STYLES.include?(style)

    if DESTINATION_STYLES.include?(style)
      errors << "#{route_path}.#{style} requires destination" if blank?(route["destination"])
      errors << "#{route_path}.#{style} must not define url" unless blank?(route["url"])
      validate_destination_metadata(route, route_path, source_id, errors)
      validate_destination_role(route, route_path, "screen", page_roles_by_id, errors)
    elsif TERMINAL_STYLES.include?(style)
      errors << "#{route_path}.#{style} must not define url" unless blank?(route["url"])
      errors << "#{route_path}.#{style} must not define destination_instance" unless blank?(route["destination_instance"])
      errors << "#{route_path}.#{style} must not define parameters" unless blank?(route["parameters"])
      validate_destination_role(route, route_path, "screen", page_roles_by_id, errors)
    elsif style == "external"
      errors << "#{route_path}.external requires url" unless http_url?(route["url"])
      errors << "#{route_path}.external must not define destination" unless blank?(route["destination"])
      errors << "#{route_path}.external must not define destination_instance" unless blank?(route["destination_instance"])
      errors << "#{route_path}.external must not define parameters" unless blank?(route["parameters"])
    end
  end

  def validate_destination_role(action, action_path, expected_role, page_roles_by_id, errors)
    destination = action["destination"]
    return if blank?(destination)

    role = page_roles_by_id[destination]
    if role.nil?
      errors << "unknown destination #{destination}"
    elsif role != expected_role
      errors << "#{action_path}.destination must reference a #{expected_role} page"
    end
  end

  def validate_behavior_parameters(action, action_path, errors)
    return unless action.key?("parameters")

    parameters = action["parameters"]
    unless parameters.is_a?(Hash)
      errors << "#{action_path}.parameters must be a mapping"
      return
    end
    parameters.each do |name, expression|
      unless name.is_a?(String) && PARAMETER_NAME_PATTERN.match?(name)
        errors << "#{action_path}.parameters keys must be valid parameter names"
      end
      unless expression.is_a?(String) && !expression.strip.empty?
        errors << "#{action_path}.parameters.#{name} must be a non-empty string"
      end
    end
  end

  def validate_string_list(owner, key, owner_path, errors)
    return unless owner.key?(key)

    values = owner[key]
    valid = values.is_a?(Array) &&
            values.all? { |value| value.is_a?(String) && !value.strip.empty? } &&
            values.uniq.length == values.length
    errors << "#{owner_path}.#{key} must contain unique non-empty strings" unless valid
  end

  def validate_destination_metadata(transition, transition_path, source_id, errors)
    instance_policy = transition["destination_instance"]
    if transition.key?("destination_instance") && instance_policy != "new"
      errors << "#{transition_path}.destination_instance must be new"
    end
    if transition["destination"] == source_id && instance_policy != "new"
      errors << "#{transition_path}.self transition requires destination_instance: new"
    end

    parameters = transition["parameters"]
    return if parameters.nil?
    unless parameters.is_a?(Hash)
      errors << "#{transition_path}.parameters must be a mapping"
      return
    end

    parameters.each do |name, expression|
      unless name.is_a?(String) && PARAMETER_NAME_PATTERN.match?(name)
        errors << "#{transition_path}.parameters keys must be valid parameter names"
      end
      unless expression.is_a?(String) && !expression.strip.empty?
        errors << "#{transition_path}.parameters.#{name} must be a non-empty string"
      end
    end
  end

  def validate_mapping(value, path, errors)
    errors << "#{path} must be a mapping" unless value.is_a?(Hash)
  end

  def validate_implementation_status(item, item_path, errors)
    return if IMPLEMENTATION_STATUSES.include?(item["implementation_status"])

    errors << "#{item_path}.implementation_status must be one of #{IMPLEMENTATION_STATUSES.join(', ')}"
  end

  def validate_accepted_baseline(baseline, page_path, errors)
    return if baseline.nil?

    unless baseline.is_a?(Hash)
      errors << "#{page_path}.accepted_baseline must be null or a mapping"
      return
    end

    %w[states behaviors].each do |kind|
      tasks = baseline[kind]
      unless tasks.is_a?(Array) && tasks.all? { |task| task.is_a?(Hash) && !task.key?("implementation_status") }
        errors << "#{page_path}.accepted_baseline.#{kind} must be an array of task contracts"
      end
    end
    popup = baseline["popup"]
    if !popup.nil? && (!popup.is_a?(Hash) || popup.key?("implementation_status"))
      errors << "#{page_path}.accepted_baseline.popup must be null or a popup task contract"
    end
  end

  def validate_removed_tasks(removed_tasks, page_path, errors)
    unless removed_tasks.is_a?(Array)
      errors << "#{page_path}.removed_tasks must be an array"
      return
    end

    removed_tasks.each_with_index do |removed_task, index|
      task_path = "#{page_path}.removed_tasks[#{index}]"
      unless removed_task.is_a?(Hash)
        errors << "#{task_path} must be a mapping"
        next
      end

      required_keys = %w[kind id implementation_status]
      unless removed_task.length == required_keys.length && required_keys.all? { |key| removed_task.key?(key) }
        errors << "#{task_path} must contain only kind, id, and implementation_status"
      end

      unless TASK_KINDS.include?(removed_task["kind"])
        errors << "#{task_path}.kind must be one of #{TASK_KINDS.join(', ')}"
      end
      validate_id(removed_task["id"], "#{task_path}.id", errors)
      validate_implementation_status(removed_task, task_path, errors)
    end
  end

  def contract_item(item)
    return Marshal.load(Marshal.dump(item)) unless item.is_a?(Hash)

    Marshal.load(Marshal.dump(item.reject { |key, _| key == "implementation_status" }))
  end

  def accepted_contract(page)
    {
      "states" => page.fetch("states", []).map { |item| contract_item(item) },
      "behaviors" => page.fetch("behaviors", []).map { |item| contract_item(item) },
      "popup" => page["popup"].is_a?(Hash) ? contract_item(page["popup"]) : nil
    }
  end

  def popup_task_collection(popup)
    return [] unless popup.is_a?(Hash)

    [Marshal.load(Marshal.dump(popup)).merge("id" => "structure")]
  end

  def reconcile_removed_tasks!(page)
    baseline = page["accepted_baseline"]
    return unless baseline.is_a?(Hash)

    prior_statuses = array_or_empty(page["removed_tasks"]).each_with_object({}) do |task, result|
      next unless task.is_a?(Hash)

      result[[task["kind"], task["id"]]] = task["implementation_status"]
    end
    removed = []
    { "state" => "states", "behavior" => "behaviors" }.each do |kind, collection|
      current_ids = index_mappings_by_id(array_or_empty(page[collection])).keys.to_h { |id| [id, true] }
      array_or_empty(baseline[collection]).each do |task|
        next unless task.is_a?(Hash) && task["id"].is_a?(String)
        next if current_ids.key?(task["id"])

        removed << {
          "kind" => kind,
          "id" => task["id"],
          "implementation_status" => prior_statuses.fetch([kind, task["id"]], "todo")
        }
      end
    end
    baseline_popup = popup_task_collection(baseline["popup"])
    current_popup = popup_task_collection(page["popup"])
    if baseline_popup.any? && current_popup.empty?
      removed << {
        "kind" => "popup",
        "id" => "structure",
        "implementation_status" => prior_statuses.fetch(["popup", "structure"], "todo")
      }
    end
    page["removed_tasks"] = removed.sort_by { |task| [task["kind"], task["id"]] }
  end

  def incomplete_tasks(page)
    current_tasks = {
      "state" => page.fetch("states", []),
      "behavior" => page.fetch("behaviors", []),
      "popup" => popup_task_collection(page["popup"])
    }
    current = current_tasks.flat_map do |kind, tasks|
      array_or_empty(tasks).filter_map do |task|
        next if task.is_a?(Hash) && task["implementation_status"] == "done"

        "#{kind}:#{task.is_a?(Hash) ? task["id"] : "invalid"}"
      end
    end
    removed = array_or_empty(page["removed_tasks"]).filter_map do |task|
      next if task.is_a?(Hash) && task["implementation_status"] == "done"

      "#{task.is_a?(Hash) ? task["kind"] : "invalid"}:#{task.is_a?(Hash) ? task["id"] : "invalid"}"
    end
    (current + removed).sort
  end

  def diff_collection(kind, baseline_items, current_items, removed_tasks)
    baseline_by_id = index_mappings_by_id(array_or_empty(baseline_items))
    current_by_id = index_mappings_by_id(array_or_empty(current_items))
    removed_by_id = array_or_empty(removed_tasks).select { |task| task.is_a?(Hash) && task["kind"] == kind }.each_with_object({}) do |task, result|
      result[task["id"]] = task if task.is_a?(Hash)
    end

    modified = (baseline_by_id.keys & current_by_id.keys).sort.filter_map do |id|
      changed_fields = changed_field_paths(baseline_by_id.fetch(id), contract_item(current_by_id.fetch(id)))
      if changed_fields.any?
        diff_item(kind, id, current_by_id.fetch(id)["implementation_status"], "modified", changed_fields)
      elsif current_by_id.fetch(id)["implementation_status"] != "done"
        diff_item(kind, id, current_by_id.fetch(id)["implementation_status"], "unchanged", [])
      end
    end
    removed = (baseline_by_id.keys - current_by_id.keys).sort.map do |id|
      status = removed_by_id.fetch(id, {}).fetch("implementation_status", "todo")
      diff_item(kind, id, status, "removed", [])
    end
    added = (current_by_id.keys - baseline_by_id.keys).sort.map do |id|
      current = current_by_id.fetch(id)
      diff_item(kind, id, current["implementation_status"], "added", changed_field_paths({}, contract_item(current)))
    end
    modified + removed + added
  end

  def diff_item(kind, id, implementation_status, change, changed_fields)
    {
      "kind" => kind,
      "id" => id,
      "implementation_status" => implementation_status,
      "change" => change,
      "changed_fields" => changed_fields
    }
  end

  def changed_field_paths(before, after, path = nil)
    if before.is_a?(Hash) && after.is_a?(Hash)
      return (before.keys | after.keys).sort.flat_map do |key|
        child_path = path ? "#{path}.#{key}" : key.to_s
        changed_field_paths(before[key], after[key], child_path)
      end
    end
    if before.is_a?(Array) && after.is_a?(Array)
      return (0...[before.length, after.length].max).flat_map do |index|
        changed_field_paths(before[index], after[index], "#{path}[#{index}]")
      end
    end

    before == after ? [] : [path]
  end

  def validate_id(value, path, errors)
    unless value.is_a?(String) && ID_PATTERN.match?(value)
      errors << "#{path} must use lowercase letters, digits, and hyphens"
      return nil
    end
    value
  end

  def validate_title(value, path, errors)
    errors << "#{path} is required" if blank?(value)
  end

  def validate_swift_page_title(value, path, errors)
    return if blank?(value)

    tokens = value.to_s.scan(/[\p{L}\p{N}]+/)
    base_name = tokens.map { |token| "#{token[0].upcase}#{token[1..]}" }.join
    errors << "#{path} must produce a Swift type name" unless base_name.match?(/\A\p{L}/)
  end

  def apply_page_defaults!
    return unless @data.is_a?(Hash)

    @data["delivery"] = {} unless @data.key?("delivery")
    @data["delivery"]["profile"] = "strict" if @data["delivery"].is_a?(Hash) && !@data["delivery"].key?("profile")
    @data["system_ui"] = {} unless @data.key?("system_ui")
    if @data["system_ui"].is_a?(Hash)
      SYSTEM_UI_COMPONENTS.each do |component|
        @data["system_ui"][component] = false unless @data["system_ui"].key?(component)
      end
    end
    @data["mock_data_sources"] = [] unless @data.key?("mock_data_sources")
    return unless @data["modules"].is_a?(Array)

    @data["modules"].each do |mod|
      next unless mod.is_a?(Hash) && mod["pages"].is_a?(Array)

      mod["pages"].each do |page|
        next unless page.is_a?(Hash)

        page["page_type"] = "view" unless page.key?("page_type")
        page["data_dependencies"] = [] unless page.key?("data_dependencies")
        page["acceptance_history"] = [] unless page.key?("acceptance_history")
        page["behaviors"] = [] unless page.key?("behaviors")
        array_or_empty(page["states"]).each do |item|
          item["implementation_status"] = "todo" if item.is_a?(Hash) && !item.key?("implementation_status")
        end
        array_or_empty(page["behaviors"]).each do |item|
          item["implementation_status"] = "todo" if item.is_a?(Hash) && !item.key?("implementation_status")
        end
        page["accepted_baseline"] = nil unless page.key?("accepted_baseline")
        page["removed_tasks"] = [] unless page.key?("removed_tasks")
        reconcile_removed_tasks!(page)
      end
    end
  end

  def migrate_schema!
    migrate_v1_to_v2! if @data.is_a?(Hash) && @data["schema_version"] == 1
    migrate_v2_to_v3! if @data.is_a?(Hash) && @data["schema_version"] == 2
    migrate_v3_to_v4! if @data.is_a?(Hash) && @data["schema_version"] == 3
    migrate_v4_to_v5! if @data.is_a?(Hash) && @data["schema_version"] == 4
    migrate_v5_to_v6! if @data.is_a?(Hash) && @data["schema_version"] == 5
    migrate_v6_to_v7! if @data.is_a?(Hash) && @data["schema_version"] == 6
  end

  def migrate_v1_to_v2!
    if @data["modules"].is_a?(Array)
      @data["modules"].each do |mod|
        next unless mod.is_a?(Hash) && mod["pages"].is_a?(Array)

        mod["pages"].each { |page| migrate_page_to_unified_behaviors!(page) if page.is_a?(Hash) }
      end
    end
    @data["schema_version"] = 2
  end

  def migrate_v2_to_v3!
    if @data["modules"].is_a?(Array)
      @data["modules"].each do |mod|
        next unless mod.is_a?(Hash) && mod["pages"].is_a?(Array)

        mod["pages"].each do |page|
          next unless page.is_a?(Hash)

          page["page_role"] = "screen"
          array_or_empty(page["behaviors"]).each do |behavior|
            migrate_v2_interaction_behavior!(behavior)
          end
        end
      end
    end
    @data["schema_version"] = 3
  end

  def migrate_v3_to_v4!
    if @data["modules"].is_a?(Array)
      @data["modules"].each do |mod|
        next unless mod.is_a?(Hash) && mod["pages"].is_a?(Array)

        mod["pages"].each do |page|
          next unless page.is_a?(Hash)

          implementation_status = page["status"] == "done" ? "done" : "todo"
          array_or_empty(page["states"]).each do |item|
            item["implementation_status"] = implementation_status if item.is_a?(Hash)
          end
          array_or_empty(page["behaviors"]).each do |item|
            item["implementation_status"] = implementation_status if item.is_a?(Hash)
          end
          page["accepted_baseline"] = accepted_contract(page) if page["status"] == "done"
          page["removed_tasks"] = []
        end
      end
    end
    @data["schema_version"] = 4
  end

  def migrate_v4_to_v5!
    @data["schema_version"] = 5
  end

  def migrate_v5_to_v6!
    baseline_document, baseline_page_ids = accepted_baseline_document(@data)
    migrate_v5_document_to_v6!(@data)
    migrate_v5_document_to_v6!(baseline_document, record_compatibility: false)

    migrated_baselines = pages_by_canonical_id(baseline_document)
    pages_by_canonical_id(@data).each do |canonical_id, page|
      next unless baseline_page_ids.include?(canonical_id)

      baseline_page = migrated_baselines.fetch(canonical_id)
      page["accepted_baseline"] = accepted_contract(baseline_page)
    end
  end

  def migrate_v6_to_v7!
    @data["schema_version"] = 7
  end

  def migrate_v5_document_to_v6!(document, record_compatibility: true)
    modules = array_or_empty(document["modules"])
    compatibility = record_compatibility ? array_or_empty(document["migration_compatibility"]) : []
    pages = {}
    page_paths = {}
    presentations = Hash.new { |hash, key| hash[key] = [] }

    modules.each_with_index do |mod, module_index|
      next unless mod.is_a?(Hash)

      array_or_empty(mod["pages"]).each_with_index do |page, page_index|
        next unless page.is_a?(Hash)

        canonical_id = "#{mod['id']}.#{page['id']}"
        pages[canonical_id] = page
        page_paths[canonical_id] = "modules[#{module_index}].pages[#{page_index}]"
        array_or_empty(page["behaviors"]).each_with_index do |behavior, behavior_index|
          next unless behavior.is_a?(Hash)

          array_or_empty(behavior["actions"]).each_with_index do |action, action_index|
            next unless action.is_a?(Hash) && action["type"] == "present_popup"

            presentations[action["destination"]] << {
              "page" => page,
              "behavior" => behavior,
              "action" => action,
              "path" => "#{page_paths[canonical_id]}.behaviors[#{behavior_index}].actions[#{action_index}]"
            }
          end
        end
      end
    end

    popup_results = {}
    pages.each do |canonical_id, page|
      next unless page["page_role"] == "popup"

      results = []
      retained_behaviors = []
      array_or_empty(page["behaviors"]).each_with_index do |behavior, behavior_index|
        unless behavior.is_a?(Hash)
          retained_behaviors << behavior
          next
        end
        return_actions = array_or_empty(behavior["actions"]).each_with_index.select do |action, _index|
          action.is_a?(Hash) && action["type"] == "return_popup_result"
        end
        if return_actions.empty?
          retained_behaviors << behavior
          next
        end

        return_actions.each do |action, action_index|
          result = action["result"]
          raw_path = "#{page_paths[canonical_id]}.behaviors[#{behavior_index}].actions[#{action_index}]"
          if valid_id?(result)
            results << {
              "id" => result,
              "target" => behavior["target"],
              "legacy" => Marshal.load(Marshal.dump(action)),
              "path" => raw_path
            }
          else
            compatibility << migration_entry(raw_path, "Invalid popup result cannot become a button ID.", action)
          end
          unless blank?(action["parameters"])
            compatibility << migration_entry(raw_path, "Legacy popup result parameters have no schema v6 callback equivalent.", action)
          end
        end

        remaining = array_or_empty(behavior["actions"]).reject do |action|
          action.is_a?(Hash) && action["type"] == "return_popup_result"
        end
        migrated_behavior = Marshal.load(Marshal.dump(behavior))
        if remaining.empty?
          migrated_behavior.delete("actions")
        else
          migrated_behavior["actions"] = remaining
        end
        if non_empty_string?(migrated_behavior["state_change"]) || array_or_empty(migrated_behavior["actions"]).any?
          retained_behaviors << migrated_behavior
        end
      end
      page["behaviors"] = retained_behaviors

      grouped = results.group_by { |result| result["id"] }
      grouped.each do |result_id, entries|
        targets = entries.map { |entry| entry["target"] }.uniq
        next unless entries.length > 1 || targets.length > 1

        compatibility << migration_entry(
          "#{page_paths[canonical_id]}.popup.buttons",
          "Result #{result_id} maps to multiple popup targets and requires manual review.",
          entries.map { |entry| entry["legacy"] }
        )
      end
      ordered_ids = results.map { |result| result["id"] }.uniq
      ordered_ids = ["primary"] if ordered_ids.empty?
      popup_results[canonical_id] = ordered_ids

      referenced_presentations = presentations[canonical_id]
      enabled = %w[title subtitle content].to_h do |field|
        present = referenced_presentations.any? do |item|
          parameters = item["action"]["parameters"]
          parameters.is_a?(Hash) && (parameters.key?(field) || (field == "content" && parameters.key?("message")))
        end
        [field, present]
      end
      if referenced_presentations.empty? && results.empty?
        enabled = { "title" => true, "subtitle" => false, "content" => true }
      end
      status = page["status"] == "done" ? "done" : "todo"
      page["popup"] = {
        "implementation_status" => status,
        "fields" => enabled,
        "buttons" => ordered_ids.map { |id| { "id" => id } }
      }
    end

    consumed_continuations = {}
    presentations.each do |destination, items|
      template = pages[destination]
      next unless template.is_a?(Hash) && template["page_role"] == "popup"

      button_ids = popup_results.fetch(destination, ["primary"])
      enabled_fields = %w[title subtitle content].select { |field| template.dig("popup", "fields", field) }
      items.each do |item|
        action = item["action"]
        parameters = action["parameters"].is_a?(Hash) ? Marshal.load(Marshal.dump(action["parameters"])) : {}
        content = {}
        enabled_fields.each do |field|
          key = field == "content" && !parameters.key?("content") && parameters.key?("message") ? "message" : field
          if non_empty_string?(parameters[key])
            content[field] = parameters.delete(key)
          else
            content[field] = "#{field}_text"
            compatibility << migration_entry(item["path"], "Missing legacy value for popup content field #{field}.", action)
          end
        end

        caller_behaviors = array_or_empty(item["page"]["behaviors"])
        bindings = button_ids.map do |button_id|
          text_key = "#{button_id}_text"
          text = parameters.delete(text_key)
          unless non_empty_string?(text)
            text = text_key
            compatibility << migration_entry(item["path"], "Missing unambiguous legacy button text parameter #{text_key}.", action)
          end
          matches = caller_behaviors.each_with_index.select do |behavior, _index|
            behavior.is_a?(Hash) && behavior.dig("trigger", "event") == "popup_result" &&
              behavior.dig("trigger", "source") == item["behavior"]["id"] &&
              behavior.dig("trigger", "result") == button_id
          end
          callback = if matches.length == 1
                       continuation, continuation_index = matches.first
                       consumed_continuations[[item["page"].object_id, continuation_index]] = true
                       {}.tap do |value|
                         value["state_change"] = continuation["state_change"] if continuation.key?("state_change")
                         value["actions"] = Marshal.load(Marshal.dump(continuation["actions"])) if continuation.key?("actions")
                       end
                     else
                       if matches.length > 1
                         compatibility << migration_entry(item["path"], "Multiple popup_result continuations match #{button_id}.", matches.map(&:first))
                       end
                       { "actions" => [{ "type" => "dismiss_popup" }] }
                     end
          { "id" => button_id, "text" => text, "callback" => callback }
        end

        unless parameters.empty?
          compatibility << migration_entry(item["path"], "Unknown legacy presentation parameters require manual mapping.", parameters)
        end
        action.delete("parameters")
        action["content"] = content
        action["buttons"] = bindings
      end
    end

    pages.each do |canonical_id, page|
      retained = []
      array_or_empty(page["behaviors"]).each_with_index do |behavior, behavior_index|
        if behavior.is_a?(Hash) && behavior.dig("trigger", "event") == "popup_result"
          unless consumed_continuations[[page.object_id, behavior_index]]
            path = "#{page_paths[canonical_id]}.behaviors[#{behavior_index}]"
            compatibility << migration_entry(path, "Popup result continuation could not be matched to one presentation button.", behavior)
          end
        else
          retained << behavior
        end
      end
      page["behaviors"] = retained
    end

    if record_compatibility
      compatibility.empty? ? document.delete("migration_compatibility") : document["migration_compatibility"] = compatibility
    end
    document["schema_version"] = 6
  end

  def accepted_baseline_document(document)
    baseline_document = Marshal.load(Marshal.dump(document))
    baseline_page_ids = []
    pages_by_canonical_id(baseline_document).each do |canonical_id, page|
      baseline = page["accepted_baseline"]
      next unless baseline.is_a?(Hash)

      baseline_page_ids << canonical_id
      page["states"] = Marshal.load(Marshal.dump(array_or_empty(baseline["states"])))
      page["behaviors"] = Marshal.load(Marshal.dump(array_or_empty(baseline["behaviors"])))
      if baseline["popup"].is_a?(Hash)
        page["popup"] = Marshal.load(Marshal.dump(baseline["popup"]))
      else
        page.delete("popup")
      end
    end
    [baseline_document, baseline_page_ids]
  end

  def pages_by_canonical_id(document)
    array_or_empty(document["modules"]).each_with_object({}) do |mod, result|
      next unless mod.is_a?(Hash)

      array_or_empty(mod["pages"]).each do |page|
        next unless page.is_a?(Hash)

        result["#{mod['id']}.#{page['id']}"] = page
      end
    end
  end

  def migration_entry(path, reason, legacy)
    {
      "path" => path,
      "reason" => reason,
      "legacy" => Marshal.load(Marshal.dump(legacy))
    }
  end

  def migrate_v2_interaction_behavior!(behavior)
    return unless behavior.is_a?(Hash) && behavior["type"] == "interaction"

    action = behavior.delete("action")
    if action.is_a?(Hash) && action["type"] == "set_state"
      behavior["state_change"] = action["state_id"]
    elsif action.is_a?(Hash)
      behavior["actions"] = [action]
    end
  end

  def migrate_page_to_unified_behaviors!(page)
    state_transitions = array_or_empty(page["state_transitions"])
    navigation_transitions = array_or_empty(page.dig("navigation", "transitions"))
    state_lookup = index_mappings_by_id(state_transitions)
    navigation_lookup = index_mappings_by_id(navigation_transitions)
    behaviors = array_or_empty(page["behaviors"]).map do |behavior|
      migrate_existing_behavior(behavior, state_lookup, navigation_lookup)
    end
    used_ids = behaviors.filter_map { |behavior| behavior["id"] if behavior.is_a?(Hash) }.to_h { |id| [id, true] }

    state_transitions.each do |transition|
      next unless transition.is_a?(Hash)

      behaviors << migrate_state_transition(transition, unique_behavior_id(transition["id"], used_ids))
    end
    navigation_transitions.each do |transition|
      next unless transition.is_a?(Hash)

      behaviors << migrate_navigation_transition(transition, unique_behavior_id(transition["id"], used_ids))
    end

    page["behaviors"] = behaviors
    page.delete("state_transitions")
    page.delete("navigation")
  end

  def migrate_existing_behavior(behavior, state_lookup, navigation_lookup)
    return behavior unless behavior.is_a?(Hash) && behavior["type"] == "custom"

    migrated = Marshal.load(Marshal.dump(behavior))
    migrated["type"] = "interaction"
    action = migrated["action"]
    if action.is_a?(Hash) && %w[start_countdown stop_countdown play_video pause_video stop_video].include?(action["type"])
      action["target"] = migrated["target"] if blank?(action["target"]) && non_empty_string?(migrated["target"])
    end
    if action.is_a?(Hash) && action["type"] == "perform_state_transition"
      transition = state_lookup[action["transition_id"]]
      migrated["action"] = { "type" => "set_state", "state_id" => transition["to"] } if transition
    elsif action.is_a?(Hash) && action["type"] == "perform_navigation_transition"
      transition = navigation_lookup[action["transition_id"]]
      migrated["action"] = navigation_action_from_transition(transition) if transition
    end
    migrated
  end

  def migrate_state_transition(transition, id)
    target, trigger = legacy_trigger(transition["action"])
    migrated = {
      "id" => id,
      "type" => "interaction",
      "target" => target,
      "trigger" => trigger,
      "action" => { "type" => "set_state", "state_id" => transition["to"] },
      "run_policy" => "every_time"
    }
    migrated["states"] = [transition["from"]] if non_empty_string?(transition["from"])
    migrated["condition"] = transition["condition"] if transition.key?("condition")
    migrated
  end

  def migrate_navigation_transition(transition, id)
    target, trigger = legacy_trigger(transition["action"])
    migrated = {
      "id" => id,
      "type" => "interaction",
      "target" => target,
      "trigger" => trigger,
      "action" => navigation_action_from_transition(transition),
      "run_policy" => "every_time"
    }
    migrated["condition"] = transition["condition"] if transition.key?("condition")
    migrated
  end

  def navigation_action_from_transition(transition)
    return { "type" => "perform_navigation_transition" } unless transition.is_a?(Hash)

    action = { "type" => "navigate", "style" => transition["style"] }
    %w[destination destination_instance url parameters].each do |key|
      action[key] = Marshal.load(Marshal.dump(transition[key])) if transition.key?(key)
    end
    action
  end

  def legacy_trigger(action)
    name = action.to_s
    if name.start_with?("tap_") && name.length > 4
      [name.delete_prefix("tap_"), { "event" => "tap" }]
    else
      ["page", { "event" => "custom_event", "name" => name }]
    end
  end

  def index_mappings_by_id(items)
    items.each_with_object({}) do |item, result|
      result[item["id"]] = item if item.is_a?(Hash) && item["id"].is_a?(String)
    end
  end

  def unique_behavior_id(candidate, used_ids)
    base = valid_id?(candidate) ? candidate : "migrated-behavior"
    value = base
    suffix = 2
    while used_ids.key?(value)
      value = "#{base}-#{suffix}"
      suffix += 1
    end
    used_ids[value] = true
    value
  end

  def array_or_empty(value)
    value.is_a?(Array) ? value : []
  end

  def index_page_roles(modules)
    modules.each_with_object({}) do |mod, roles|
      next unless mod.is_a?(Hash) && valid_id?(mod["id"]) && mod["pages"].is_a?(Array)

      mod["pages"].each do |page|
        next unless page.is_a?(Hash) && valid_id?(page["id"])

        roles["#{mod['id']}.#{page['id']}"] = page["page_role"]
      end
    end
  end

  def index_pages(modules)
    modules.each_with_object({}) do |mod, pages|
      next unless mod.is_a?(Hash) && valid_id?(mod["id"]) && mod["pages"].is_a?(Array)

      mod["pages"].each do |page|
        next unless page.is_a?(Hash) && valid_id?(page["id"])

        pages["#{mod['id']}.#{page['id']}"] = page
      end
    end
  end

  def duplicate_id(seen, id, label, errors)
    return unless id
    if seen.key?(id)
      errors << "duplicate #{label} id #{id}"
    else
      seen[id] = true
    end
  end

  def figma_url?(value)
    return false unless http_url?(value)
    host = URI.parse(value).host
    host == "figma.com" || host == "www.figma.com"
  rescue URI::InvalidURIError
    false
  end

  def http_url?(value)
    return false unless value.is_a?(String)
    uri = URI.parse(value)
    %w[http https].include?(uri.scheme) && !uri.host.nil?
  rescue URI::InvalidURIError
    false
  end

  def blank?(value)
    value.nil? || (value.respond_to?(:empty?) && value.empty?)
  end

  def non_empty_string?(value)
    value.is_a?(String) && !value.strip.empty?
  end

  def swift_type_name?(value)
    return false unless value.is_a?(String)

    value.match?(/\A\p{L}[\p{L}\p{N}_]*(?:\.\p{L}[\p{L}\p{N}_]*)*\z/)
  end

  def raise_errors(errors)
    raise TaskConfigError, errors.join("\n") unless errors.empty?
  end

  def each_page
    return enum_for(:each_page) unless block_given?
    @data.fetch("modules").each do |mod|
      mod.fetch("pages").each { |page| yield mod, page }
    end
  end

  def find_page(module_id, page_id)
    page = find_page_or_nil(module_id, page_id)
    return page if page

    mod = @data.fetch("modules").find { |item| item.fetch("id") == module_id }
    raise TaskConfigError, "unknown module #{module_id}" unless mod

    raise TaskConfigError, "unknown page #{module_id}.#{page_id}"
  end

  def find_page_or_nil(module_id, page_id)
    mod = @data.fetch("modules").find { |item| item.fetch("id") == module_id }
    mod&.fetch("pages")&.find { |item| item.fetch("id") == page_id }
  end

  def require_in_progress(module_id, page_id)
    page = find_page(module_id, page_id)
    unless page.fetch("status") == "in_progress"
      raise TaskConfigError, "#{module_id}.#{page_id} must be in_progress"
    end
    page
  end

  def transition_from_in_progress(module_id, page_id, status, reason)
    require_reason!(reason)
    page = require_in_progress(module_id, page_id)
    page["status"] = status
    page["reason"] = reason
    page["completed_at"] = timestamp
    save!
  end

  def require_reason!(reason)
    raise TaskConfigError, "reason is required" if blank?(reason)
  end

  def timestamp
    Time.now.utc.iso8601
  end

  def leading_comments(text)
    text.lines.take_while do |line|
      line.strip.empty? || line.lstrip.start_with?("#")
    end.join
  end

  def body_comments?
    body = @text.byteslice(@header.bytesize..) || ""
    body.lines.any? { |line| line.lstrip.start_with?("#") }
  end

  def require_current_revision!(expected_revision)
    return if expected_revision == revision

    raise TaskConfigRevisionConflict, "configuration changed on disk; reload before saving"
  end

  def save!
    validate!
    write_payload!(@header + normalized_yaml)
  end

  def write_payload!(payload)
    directory = File.dirname(@path)
    temp = Tempfile.new([File.basename(@path), ".tmp"], directory)
    begin
      temp.write(payload)
      temp.flush
      temp.fsync
      temp.close
      File.rename(temp.path, @path)
    ensure
      temp.close unless temp.closed?
      temp.unlink if File.exist?(temp.path)
    end
  end
end
