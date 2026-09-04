# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "open3"
require "rbconfig"
require "tmpdir"
require "yaml"

class TaskConfigTest < Minitest::Test
  SKILL_ROOT = File.expand_path("..", __dir__)
  SCRIPT = File.join(SKILL_ROOT, "scripts", "task_config.rb")
  CORE = File.join(SKILL_ROOT, "scripts", "task_config_core.rb")

  def test_core_can_be_required_without_running_cli
    out, err, status = Open3.capture3(
      RbConfig.ruby,
      "-e",
      "require ARGV.fetch(0); puts TaskConfig.name",
      CORE
    )

    assert status.success?, err
    assert_equal "TaskConfig\n", out
  end

  def test_init_places_both_artifacts_in_a_dedicated_workspace_directory
    Dir.mktmpdir do |dir|
      write_xcode_project(dir, synchronized_path: "App")

      _out, err, status = run_cli("init", "--project-root", dir, chdir: dir)

      assert status.success?, err
      workspace = File.join(dir, "InAppFigma")
      assert File.file?(File.join(workspace, "InAppFigma.yaml"))
      assert File.file?(File.join(workspace, "OpenInAppFigma.command"))
      assert_equal %w[InAppFigma.yaml OpenInAppFigma.command], Dir.children(workspace).sort
      refute File.exist?(File.join(dir, "InAppFigma.yaml"))
      refute File.exist?(File.join(dir, "OpenInAppFigma.command"))
    end
  end

  def test_init_creates_documented_template_without_overwriting
    Dir.mktmpdir do |dir|
      write_xcode_project(dir, synchronized_path: "App")
      out, err, status = run_cli("init", "--project-root", dir, chdir: dir)

      assert status.success?, err
      path = File.join(dir, "InAppFigma", "InAppFigma.yaml")
      launcher_path = File.join(dir, "InAppFigma", "OpenInAppFigma.command")
      content = File.read(path)
      assert_includes out, path
      assert_includes out, launcher_path
      assert_includes content, "# Hierarchy: module -> page -> state"
      assert_includes content, "# Page A -> Page B"
      assert_includes content, "#             condition: has_next_a"
      assert_equal 1, content.scan(/#\s+destination_instance: new/).length
      assert_equal 1, content.scan(/#\s+item: next_item/).length
      refute_includes content, "Schema v2 migration-reference fields retained for older readers"
      assert_equal [], load_yaml(path).fetch("modules")
      assert_equal "strict", load_yaml(path).dig("delivery", "profile")
      assert_equal false, load_yaml(path).dig("system_ui", "tab_bar_controller")
      assert_equal false, load_yaml(path).dig("system_ui", "picker")
      assert File.executable?(launcher_path)

      File.open(path, "a") { |file| file.puts("# keep-existing-content") }
      File.open(launcher_path, "a") { |file| file.puts("# keep-custom-launcher-content") }
      _out, err, status = run_cli("init", "--project-root", dir, chdir: dir)

      assert status.success?, err
      assert_includes File.read(path), "# keep-existing-content"
      assert_includes File.read(launcher_path), "# keep-custom-launcher-content"
    end
  end

  def test_task_configuration_documents_action_specific_parameter_contracts
    guidance = File.read(File.join(SKILL_ROOT, "references", "task-configuration.md"))

    assert_includes guidance, "`navigate` parameters carry destination input"
    assert_includes guidance, "`present_popup.content`"
    assert_includes guidance, "`present_popup.buttons`"
    assert_includes guidance, "popup button callback"
    assert_includes guidance, "`start_countdown.parameters.duration_seconds` configures the countdown duration"
    refute_includes guidance, "valid only for destination-creating `navigate` actions"
  end

  def test_schema_v6_popup_guidance_and_template_use_caller_owned_callbacks
    guidance = File.read(File.join(SKILL_ROOT, "references", "task-configuration.md"))
    template = File.read(File.join(SKILL_ROOT, "assets", "InAppFigma.yaml"))
    current_guidance, migration_guidance = guidance.split("## Schema v5 Migration", 2)

    assert_equal 6, YAML.safe_load(template).fetch("schema_version")
    assert_includes template, "popup:"
    assert_includes template, "fields:"
    assert_includes template, "buttons:"
    assert_includes template, "callback:"
    assert_includes template, "content:"
    refute_includes template, "popup_result"
    refute_includes template, "return_popup_result"
    refute_includes current_guidance, "popup_result"
    refute_includes current_guidance, "return_popup_result"
    assert_includes migration_guidance, "popup_result"
    assert_includes migration_guidance, "return_popup_result"
    assert_includes guidance, "popup-instance:"
  end

  def test_page_delivery_rules_are_routed_from_a_separate_reference
    entrypoint = File.read(File.join(SKILL_ROOT, "SKILL.md"))
    delivery = File.read(File.join(SKILL_ROOT, "references", "page-delivery-profiles.md"))
    configuration = File.read(File.join(SKILL_ROOT, "references", "task-configuration.md"))

    assert_includes entrypoint, "page-delivery-profiles.md"
    refute_includes entrypoint, "## Reliable Visual Delivery Contract"
    assert_includes delivery, "### `strict`"
    assert_includes delivery, "### `implementation`"
    assert_includes delivery, "### `review`"
    assert_includes delivery, "## Page Implementation"
    assert_includes delivery, "## Project Conventions"
    assert_includes delivery, "## Review"
    assert_includes delivery, "## Completion Gate"
    assert_includes configuration, "`delivery.profile`"
    assert_includes configuration, "Page delivery profile"
  end

  def test_system_ui_configuration_defines_scoped_visual_gate_exceptions
    delivery = File.read(File.join(SKILL_ROOT, "references", "page-delivery-profiles.md"))
    verification = File.read(File.join(SKILL_ROOT, "references", "assets-and-verification.md"))
    configuration = File.read(File.join(SKILL_ROOT, "references", "task-configuration.md"))
    template = File.read(File.join(SKILL_ROOT, "assets", "InAppFigma.yaml"))

    assert_includes configuration, "`system_ui.tab_bar_controller`"
    assert_includes configuration, "`system_ui.picker`"
    assert_includes delivery, "system ownership evidence"
    assert_includes verification, "OS-owned pixels inside that component boundary"
    assert_includes template, "system_ui:"
  end

  def test_generated_launcher_uses_its_directory_and_prefers_project_local_skill
    Dir.mktmpdir do |dir|
      write_xcode_project(dir, synchronized_path: "App")
      run_success("init", "--project-root", dir, chdir: dir)
      local_script = File.join(
        dir, ".codex", "skills", "in-app-swift-figma", "scripts", "task_config.rb"
      )
      FileUtils.mkdir_p(File.dirname(local_script))
      File.write(local_script, "puts ARGV\n")

      out, err, status = Open3.capture3(
        File.join(dir, "InAppFigma", "OpenInAppFigma.command"),
        chdir: File.dirname(dir)
      )

      assert status.success?, err
      assert_equal(
        "serve\n--project-root\n#{dir}\n--config\n#{File.join(dir, "InAppFigma", "InAppFigma.yaml")}\n",
        out
      )
    end
  end

  def test_generated_launcher_falls_back_to_the_initializing_skill
    Dir.mktmpdir do |dir|
      write_xcode_project(dir, synchronized_path: "App")
      run_success("init", "--project-root", dir, chdir: dir)
      fake_node = write_fake_node(dir)

      out, err, status = Open3.capture3(
        { "IN_APP_FIGMA_NODE" => fake_node },
        File.join(dir, "InAppFigma", "OpenInAppFigma.command"),
        chdir: File.dirname(dir)
      )

      assert status.success?, err
      assert_includes out, "--config\n#{File.join(dir, "InAppFigma", "InAppFigma.yaml")}"
      assert_includes out, "--editor-root\n#{File.join(SKILL_ROOT, "scripts", "editor")}"
    end
  end

  def test_init_rejects_projects_that_explicitly_reference_development_files
    ["InAppFigma.yaml", "OpenInAppFigma.command"].each do |filename|
      Dir.mktmpdir do |dir|
        write_xcode_project(dir, synchronized_path: "App", extra: "path = #{filename};")

        _out, err, status = run_cli("init", "--project-root", dir, chdir: dir)

        refute status.success?
        assert_includes err, filename
        refute Dir.exist?(File.join(dir, "InAppFigma"))
      end
    end
  end

  def test_init_rejects_a_synchronized_group_that_covers_the_project_root
    [".", nil].each do |synchronized_path|
      Dir.mktmpdir do |dir|
        write_xcode_project(dir, synchronized_path: synchronized_path)

        _out, err, status = run_cli("init", "--project-root", dir, chdir: dir)

        refute status.success?
        assert_includes err, "synchronized root"
        refute Dir.exist?(File.join(dir, "InAppFigma"))
      end
    end
  end

  def test_init_rejects_a_synchronized_group_for_the_workspace_directory
    Dir.mktmpdir do |dir|
      write_xcode_project(dir, synchronized_path: "InAppFigma")

      _out, err, status = run_cli("init", "--project-root", dir, chdir: dir)

      refute status.success?
      assert_includes err, "synchronized root"
      refute Dir.exist?(File.join(dir, "InAppFigma"))
    end
  end

  def test_init_rejects_a_project_root_without_an_xcode_project
    Dir.mktmpdir do |dir|
      _out, err, status = run_cli("init", "--project-root", dir, chdir: dir)

      refute status.success?
      assert_includes err, "Xcode project"
      refute Dir.exist?(File.join(dir, "InAppFigma"))
    end
  end

  def test_init_requires_yaml_and_launcher_in_the_dedicated_workspace
    Dir.mktmpdir do |dir|
      write_xcode_project(dir, synchronized_path: "App")
      invalid_paths = [
        File.join(dir, "config", "InAppFigma.yaml"),
        File.join(dir, "CustomInAppFigma.yaml")
      ]

      invalid_paths.each do |config_path|
        FileUtils.mkdir_p(File.dirname(config_path))
        _out, err, status = run_cli(
          "init", "--project-root", dir, "--config", config_path, chdir: dir
        )

        refute status.success?
        assert_includes err, "must be stored together"
        refute File.exist?(config_path)
        refute Dir.exist?(File.join(dir, "InAppFigma"))
      end
    end
  end

  def test_init_rejects_a_missing_project_root
    Dir.mktmpdir do |dir|
      missing_root = File.join(dir, "missing-project")

      _out, err, status = run_cli(
        "init", "--project-root", missing_root, chdir: dir
      )

      refute status.success?
      assert_includes err, "directory does not exist"
      refute Dir.exist?(missing_root)
    end
  end

  def test_validate_accepts_module_page_state_and_behavior_hierarchy
    with_config do |dir, path|
      out, err, status = run_cli("validate", "--config", path, chdir: dir)

      assert status.success?, err
      assert_includes out, "2 pages"
      assert_includes out, "2 states"
      assert_includes out, "2 behaviors"
    end
  end

  def test_validate_migrates_legacy_page_internal_state_transitions
    with_config do |dir, path, config|
      page_a = page(config, "page-a")
      page_a["states"] << {
        "id" => "exit-confirmation",
        "title" => "Exit confirmation",
        "figma_url" => "https://www.figma.com/design/file/Page?node-id=1-3"
      }
      page_a["state_transitions"] = [
        {
          "id" => "show-exit-confirmation",
          "from" => "default",
          "to" => "exit-confirmation",
          "action" => "tap_back",
          "condition" => "workout_in_progress"
        },
        {
          "id" => "continue-workout",
          "from" => "exit-confirmation",
          "to" => "default",
          "action" => "tap_continue_workout"
        }
      ]
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      assert status.success?, err
    end
  end

  def test_validate_accepts_page_behaviors
    with_config do |dir, path, config|
      page_a = page(config, "page-a")
      page_a["behaviors"] = [
        {
          "id" => "main-content-scroll",
          "type" => "scroll",
          "target" => "content_below_navigation",
          "axis" => "vertical",
          "fixed_regions" => ["navigation_bar", "bottom_action"],
          "states" => ["default"],
          "condition" => "content_exceeds_viewport",
          "note" => "Keep the primary action visible."
        },
        {
          "id" => "lock-alert-background",
          "type" => "scroll_lock",
          "target" => "page_content",
          "states" => ["default"]
        }
      ]
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      assert status.success?, err
    end
  end

  def test_validate_migrates_legacy_custom_countdown_behavior_chain
    with_config do |dir, path, config|
      page_a = page(config, "page-a")
      page_a["states"] << {
        "id" => "completion",
        "title" => "Completion",
        "figma_url" => "https://www.figma.com/design/file/Page?node-id=1-3"
      }
      page_a["state_transitions"] = [{
        "id" => "show-completion",
        "from" => "default",
        "to" => "completion",
        "action" => "countdown_completed"
      }]
      page_a["behaviors"] = [
        {
          "id" => "workout-countdown",
          "type" => "custom",
          "target" => "countdown_label",
          "trigger" => { "event" => "page_appear" },
          "action" => {
            "type" => "start_countdown",
            "parameters" => { "duration_seconds" => "30" }
          },
          "run_policy" => "once_per_instance"
        },
        {
          "id" => "countdown-completed",
          "type" => "custom",
          "target" => "page",
          "trigger" => {
            "event" => "timer_finished",
            "source" => "workout-countdown"
          },
          "action" => {
            "type" => "perform_state_transition",
            "transition_id" => "show-completion"
          },
          "run_policy" => "every_time"
        }
      ]
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      assert status.success?, err
      require CORE
      migrated = TaskConfig.new(path).data
      assert_equal "countdown_label", page(migrated, "page-a").fetch("behaviors").first.dig("actions", 0, "target")
    end
  end

  def test_validate_rejects_invalid_interaction_behavior_contracts
    with_config do |dir, path, config|
      require CORE
      config = TaskConfig.new(path).data
      page_a = page(config, "page-a")
      page_a["behaviors"] = [
        {
          "id" => "start",
          "type" => "interaction",
          "target" => "countdown_label",
          "trigger" => { "event" => "not-an-event" },
          "actions" => [{ "type" => "start_countdown", "parameters" => {} }],
          "run_policy" => "sometimes"
        },
        {
          "id" => "finish",
          "type" => "interaction",
          "target" => "page",
          "trigger" => { "event" => "timer_finished", "source" => "missing-timer" },
          "state_change" => "missing-state",
          "run_policy" => "every_time"
        },
        {
          "id" => "navigate",
          "type" => "interaction",
          "target" => "page",
          "trigger" => { "event" => "custom_event", "name" => 12 },
          "actions" => [{ "type" => "navigate", "style" => "push", "destination" => "account.missing" }],
          "run_policy" => "once_per_instance"
        },
        {
          "id" => "custom-action",
          "type" => "interaction",
          "target" => "page",
          "trigger" => { "event" => "page_appear" },
          "actions" => [{ "type" => "custom", "name" => 12 }],
          "run_policy" => "once_per_instance"
        }
      ]
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      refute status.success?
      assert_includes err, "trigger.event must be one of"
      assert_includes err, "actions[0].parameters.duration_seconds is required"
      assert_includes err, "run_policy must be one of once_per_instance, every_time"
      assert_includes err, "trigger.source must reference a start_countdown behavior in this page"
      assert_includes err, "state_change must reference a state in this page"
      assert_includes err, "trigger.name is required for custom_event"
      assert_includes err, "actions[0].name is required for custom"
    end
  end

  def test_validate_rejects_invalid_page_behavior_fields
    with_config do |dir, path, config|
      page_a = page(config, "page-a")
      page_a["behaviors"] = [{
        "id" => "bad-behavior",
        "type" => "animate",
        "target" => "",
        "axis" => "diagonal",
        "fixed_regions" => ["", "header", "header"],
        "states" => ["missing", "missing"],
        "condition" => "",
        "note" => ""
      }]
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      refute status.success?
      assert_includes err, "type must be one of"
      assert_includes err, "target is required"
      assert_includes err, "axis must be one of vertical, horizontal, both"
      assert_includes err, "fixed_regions must contain unique non-empty strings"
      assert_includes err, "states must reference unique states in this page"
      assert_includes err, "condition must be a non-empty string"
      assert_includes err, "note must be a non-empty string"
    end
  end

  def test_schema_metadata_exposes_behavior_ranges
    require CORE
    metadata = TaskConfig.schema_metadata

    assert_equal %w[view view_controller], metadata.fetch("page_types")
    assert_equal %w[screen popup], metadata.fetch("page_roles")
    assert_equal %w[scroll scroll_lock sticky fixed keyboard_avoidance pull_to_refresh pagination interaction], metadata.fetch("behavior_types")
    assert_equal %w[vertical horizontal both], metadata.fetch("behavior_axes")
    assert_equal %w[tap page_appear page_disappear state_enter state_exit timer_finished video_finished custom_event], metadata.fetch("behavior_trigger_events")
    assert_equal %w[navigate present_popup dismiss_popup start_countdown stop_countdown play_video pause_video stop_video emit_event custom], metadata.fetch("behavior_action_types")
    assert_equal %w[once_per_instance every_time], metadata.fetch("behavior_run_policies")
  end

  def test_v3_done_page_migrates_tasks_and_acceptance_baseline
    require CORE
    config = valid_v3_config
    migrated_page = page(config, "page-a")
    migrated_page["status"] = "done"

    loaded = load_task_config(config)
    loaded_page = page(loaded.data, "page-a")

    assert_equal 6, loaded.data["schema_version"]
    assert_equal ["done"], loaded_page.fetch("states").map { |item| item["implementation_status"] }.uniq
    assert_equal ["done"], loaded_page.fetch("behaviors").map { |item| item["implementation_status"] }.uniq
    assert_equal(
      {
        "states" => loaded_page.fetch("states").map { |item| item.reject { |key, _| key == "implementation_status" } },
        "behaviors" => loaded_page.fetch("behaviors").map { |item| item.reject { |key, _| key == "implementation_status" } },
        "popup" => nil
      },
      loaded_page.fetch("accepted_baseline")
    )
    assert_equal [], loaded_page.fetch("removed_tasks")
  end

  def test_v4_accepts_compact_removed_tasks_and_rejects_invalid_task_status
    require CORE
    config = valid_v4_config
    page(config, "page-a").fetch("states").first["implementation_status"] = "blocked"

    error = assert_raises(TaskConfigError) { load_task_config(config) }
    assert_includes error.message, "implementation_status"

    config = valid_v4_config
    page(config, "page-a")["removed_tasks"] = [{
      "kind" => "state",
      "id" => "retired-state",
      "implementation_status" => "done"
    }]
    loaded = load_task_config(config)
    assert_equal [{
      "kind" => "state",
      "id" => "retired-state",
      "implementation_status" => "done"
    }], page(loaded.data, "page-a").fetch("removed_tasks")

    [
      { "task" => { "id" => "legacy-task" } },
      { "unknown" => "unexpected" },
      { 99 => "unexpected" }
    ].each do |extra|
      config = valid_v4_config
      page(config, "page-a")["removed_tasks"] = [{
        "kind" => "state",
        "id" => "retired-state",
        "implementation_status" => "done"
      }.merge(extra)]

      error = assert_raises(TaskConfigError) { load_task_config(config) }
      assert_includes error.message, "removed_tasks"
    end
  end

  def test_page_changes_reports_added_modified_removed_and_unchanged_reopened_tasks
    require CORE
    config = completed_v4_config
    page_a = page(config, "page-a")
    page_a.fetch("states").first["figma_url"] = changed_figma_url
    page_a.fetch("behaviors").shift
    page_a.fetch("behaviors") << retry_behavior

    changes = load_task_config(config).page_changes("account", "page-a")

    assert_equal %w[modified], changes.fetch("states").map { |item| item["change"] }
    assert_equal ["figma_url"], changes.fetch("states").first.fetch("changed_fields")
    assert_equal %w[removed added], changes.fetch("behaviors").map { |item| item["change"] }
    assert_equal ["retry-default"], changes.fetch("behaviors").filter { |item| item["change"] == "added" }.map { |item| item["id"] }

    page_a.fetch("states").first["figma_url"] = page_a.fetch("accepted_baseline").fetch("states").first.fetch("figma_url")
    page_a.fetch("states").first["implementation_status"] = "todo"
    reopened = load_task_config(config).page_changes("account", "page-a").fetch("states")
    assert_equal ["unchanged"], reopened.map { |item| item["change"] }
    assert_equal ["todo"], reopened.map { |item| item["implementation_status"] }
  end

  def test_removed_tasks_are_reconciled_and_restoration_discards_the_removal
    require CORE
    config = completed_v4_config
    page_a = page(config, "page-a")
    removed_behavior = page_a.fetch("behaviors").pop

    loaded = load_task_config(config)
    assert_equal [{
      "kind" => "behavior", "id" => removed_behavior.fetch("id"), "implementation_status" => "todo"
    }], page(loaded.data, "page-a").fetch("removed_tasks")

    page_a.fetch("behaviors") << removed_behavior
    restored = load_task_config(config)
    assert_equal [], page(restored.data, "page-a").fetch("removed_tasks")
  end

  def test_page_changes_reports_recursive_field_paths_in_lexical_order
    require CORE
    config = completed_v4_config
    trigger = page(config, "page-a").fetch("behaviors").first.fetch("trigger")
    trigger["event"] = "page_appear"

    change = load_task_config(config).page_changes("account", "page-a").fetch("behaviors").first

    assert_equal "modified", change.fetch("change")
    assert_equal ["trigger.event"], change.fetch("changed_fields")
  end

  def test_complete_rejects_any_incomplete_current_or_removed_task
    require CORE
    config = in_progress_v4_config
    page(config, "page-a").fetch("states").first["implementation_status"] = "todo"

    with_task_config(config) do |loaded|
      error = assert_raises(TaskConfigError) { loaded.complete("account", "page-a") }
      assert_includes error.message, "incomplete implementation tasks"
    end

    config = in_progress_v4_config
    page(config, "page-a").fetch("behaviors").pop
    with_task_config(config) do |loaded|
      error = assert_raises(TaskConfigError) { loaded.complete("account", "page-a") }
      assert_includes error.message, "incomplete implementation tasks"
    end
  end

  def test_complete_refreshes_baseline_and_clears_removed_tasks
    require CORE
    config = in_progress_v4_config
    page_a = page(config, "page-a")
    page_a.fetch("states").first["implementation_status"] = "done"
    page_a.fetch("behaviors").each { |item| item["implementation_status"] = "done" }
    page_a["removed_tasks"] = [{
      "kind" => "state", "id" => "retired-state", "implementation_status" => "done"
    }]

    with_task_config(config) do |loaded|
      loaded.complete("account", "page-a", commit: "accepted123")
      completed = page(loaded.data, "page-a")

      assert_equal "done", completed.fetch("status")
      assert_equal [], completed.fetch("removed_tasks")
      assert_equal(
        completed.fetch("states").map { |item| item.reject { |key, _| key == "implementation_status" } },
        completed.fetch("accepted_baseline").fetch("states")
      )
    end
  end

  def test_confirmed_replace_writes_the_amended_draft_once
    require CORE
    writer = Class.new(TaskConfig) do
      attr_reader :write_count

      private

      def write_payload!(payload)
        @write_count = (@write_count || 0) + 1
        super
      end
    end
    config = completed_v4_config

    Dir.mktmpdir do |dir|
      path = File.join(dir, "InAppFigma.yaml")
      write_config(path, config)
      loaded = writer.new(path)
      draft = deep_copy(loaded.snapshot.fetch("config"))
      page(draft, "page-a").fetch("states").first["figma_url"] = changed_figma_url

      snapshot = loaded.replace!(
        draft,
        expected_revision: loaded.revision,
        acknowledge_comment_loss: false,
        confirm_amendments: true
      )

      assert_equal 1, loaded.write_count
      assert_equal "in_progress", page(snapshot.fetch("config"), "page-a").fetch("status")
    end
  end

  def test_changes_cli_emits_stable_yaml
    with_config do |dir, path, config|
      config = completed_v4_config
      page(config, "page-a").fetch("states").first["figma_url"] = changed_figma_url
      write_config(path, config)

      out, err, status = run_cli("changes", "account", "page-a", "--config", path, chdir: dir)

      assert status.success?, err
      assert_equal "account.page-a", YAML.safe_load(out).fetch("page")
      assert_includes out, "changed_fields"
    end
  end

  def test_snapshot_and_successful_draft_validation_include_changes_by_page
    require CORE
    config = completed_v4_config
    page(config, "page-a").fetch("states").first["figma_url"] = changed_figma_url

    snapshot = nil
    with_task_config(config) { |loaded| snapshot = loaded.snapshot }
    validation = TaskConfig.validate_draft(config, path: "draft.yaml")

    assert_equal ["account.page-a", "account.page-b"], snapshot.fetch("changes_by_page").keys.sort
    assert_equal "modified", snapshot.fetch("changes_by_page").fetch("account.page-a").fetch("states").first.fetch("change")
    assert validation.fetch("valid")
    assert_equal snapshot.fetch("changes_by_page"), validation.fetch("changes_by_page")
  end

  def test_v3_done_page_with_a_non_mapping_task_fails_validation_without_crashing
    require CORE
    config = valid_v3_config
    page(config, "page-a")["status"] = "done"
    page(config, "page-a")["states"] = ["not-a-task"]

    error = assert_raises(TaskConfigError) { load_task_config(config) }
    assert_includes error.message, "states[0] must be a mapping"
  end

  def test_validate_accepts_page_types_and_rejects_unknown_values
    with_config do |dir, path, config|
      page(config, "page-a")["page_type"] = "view_controller"
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)
      assert status.success?, err

      page(config, "page-a")["page_type"] = "storyboard"
      write_config(path, config)
      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      refute status.success?
      assert_includes err, "page_type must be one of view, view_controller"
    end
  end

  def test_missing_page_type_migrates_to_view
    require CORE
    with_config do |_dir, path, config|
      page(config, "page-a").delete("page_type")
      write_config(path, config)

      loaded = TaskConfig.new(path)

      assert_equal "view", page(loaded.data, "page-a").fetch("page_type")
      assert_includes loaded.normalized_yaml, "page_type: view"
    end
  end

  def test_validate_rejects_page_title_without_a_swift_type_basename
    with_config do |dir, path, config|
      page(config, "page-a")["title"] = "123"
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      refute status.success?
      assert_includes err, "title must produce a Swift type name"
    end
  end

  def test_validate_rejects_unknown_endpoints_after_legacy_state_transition_migration
    with_config do |dir, path, config|
      page_a = page(config, "page-a")
      page_a["state_transitions"] = [{
        "id" => "show-alert",
        "from" => "missing",
        "to" => "alert",
        "action" => "tap_back"
      }]
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      refute status.success?
      assert_includes err, "states must reference unique states in this page"
      assert_includes err, "state_change must reference a state in this page"
    end
  end

  def test_validate_allows_multiple_state_actions_for_the_same_tap
    with_config do |dir, path, config|
      page_a = page(config, "page-a")
      page_a["state_transitions"] = [
        { "id" => "first", "from" => "default", "to" => "default", "action" => "tap_back" },
        { "id" => "second", "from" => "default", "to" => "default", "action" => "tap_back" }
      ]
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      assert status.success?, err
    end
  end

  def test_validate_rejects_unknown_navigation_destination
    with_config do |dir, path, config|
      transition(config, "page-a")["destination"] = "account.missing"
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      refute status.success?
      assert_includes err, "unknown destination account.missing"
    end
  end

  def test_validate_accepts_existing_destination_for_back_and_dismiss
    with_config do |dir, path, config|
      transition(config, "page-b")["destination"] = "account.page-a"
      page(config, "page-a")["navigation"]["transitions"] << {
        "id" => "close-sheet",
        "action" => "tap_close",
        "style" => "dismiss",
        "destination" => "account.page-b"
      }
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      assert status.success?, err
    end
  end

  def test_validate_rejects_unknown_back_or_dismiss_destination
    with_config do |dir, path, config|
      transition(config, "page-b")["destination"] = "account.missing"
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      refute status.success?
      assert_includes err, "unknown destination account.missing"
    end
  end

  def test_validate_keeps_terminal_destination_optional_for_legacy_configs
    with_config do |dir, path|
      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      assert status.success?, err
    end
  end

  def test_validate_requires_new_instance_for_self_push
    with_config do |dir, path, config|
      page_a = page(config, "page-a")
      page_a["navigation"]["transitions"] = [
        {
          "id" => "continue-with-next-a",
          "action" => "tap_continue",
          "condition" => "has_next_a",
          "style" => "push",
          "destination" => "account.page-a"
        }
      ]
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      refute status.success?
      assert_includes err, "self transition requires destination_instance: new"
    end
  end

  def test_validate_accepts_conditional_new_instance_self_push_with_parameters
    with_config do |dir, path, config|
      page_a = page(config, "page-a")
      page_a["navigation"]["transitions"] = [
        {
          "id" => "continue-with-next-a",
          "action" => "tap_continue",
          "condition" => "has_next_a",
          "style" => "push",
          "destination" => "account.page-a",
          "destination_instance" => "new",
          "parameters" => { "item" => "next_item" }
        },
        {
          "id" => "finish-to-b",
          "action" => "tap_continue",
          "condition" => "should_finish",
          "style" => "full_screen",
          "destination" => "account.page-b",
          "destination_instance" => "new"
        }
      ]
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      assert status.success?, err
    end
  end

  def test_validate_allows_multiple_navigation_actions_for_the_same_tap
    with_config do |dir, path, config|
      page_a = page(config, "page-a")
      page_a["navigation"]["transitions"] = [
        {
          "id" => "continue-with-next-a",
          "action" => "tap_continue",
          "style" => "push",
          "destination" => "account.page-a",
          "destination_instance" => "new"
        },
        {
          "id" => "finish-to-b",
          "action" => "tap_continue",
          "condition" => "should_finish",
          "style" => "push",
          "destination" => "account.page-b"
        }
      ]
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      assert status.success?, err
    end
  end

  def test_validate_rejects_invalid_parameters_and_terminal_instance_policy
    with_config do |dir, path, config|
      page_a = page(config, "page-a")
      page_a["navigation"]["transitions"] = [
        {
          "id" => "continue-to-b",
          "action" => "tap_continue",
          "style" => "push",
          "destination" => "account.page-b",
          "destination_instance" => "reuse",
          "parameters" => ["next_item"]
        }
      ]
      page_b = page(config, "page-b")
      page_b["navigation"]["transitions"].first["destination_instance"] = "new"
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      refute status.success?
      assert_includes err, "destination_instance must be new"
      assert_includes err, "parameters must be a mapping"
      assert_includes err, "back must not define destination_instance"
    end
  end

  def test_validate_rejects_blank_condition_and_parameter_expression
    with_config do |dir, path, config|
      target = transition(config, "page-a")
      target["condition"] = ""
      target["parameters"] = { "item" => "" }
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      refute status.success?
      assert_includes err, "condition must be a non-empty string"
      assert_includes err, "parameters.item must be a non-empty string"
    end
  end

  def test_validate_reports_malformed_module_without_crashing
    with_config do |dir, path, config|
      config["modules"] = ["not-a-module"]
      write_config(path, config)

      _out, err, status = run_cli("validate", "--config", path, chdir: dir)

      refute status.success?
      assert_includes err, "modules[0] must be a mapping"
      refute_includes err, "NoMethodError"
    end
  end

  def test_claim_marks_page_in_progress_and_prevents_duplicate_work
    with_config do |dir, path|
      _out, err, status = run_cli(
        "claim", "account", "page-a", "--config", path, chdir: dir
      )
      assert status.success?, err

      page = page(load_yaml(path), "page-a")
      assert_equal "in_progress", page.fetch("status")
      assert_equal 1, page.fetch("attempts")
      refute_nil page.fetch("started_at")

      _out, err, status = run_cli(
        "claim", "account", "page-a", "--config", path, chdir: dir
      )
      refute status.success?
      assert_includes err, "already in_progress"
    end
  end

  def test_complete_marks_page_done_and_excludes_it_from_eligible_pages
    with_config do |dir, path|
      run_success("claim", "account", "page-a", "--config", path, chdir: dir)
      mark_page_tasks_done(path, "page-a")
      run_success(
        "complete", "account", "page-a", "--commit", "abc123",
        "--config", path, chdir: dir
      )

      page = page(load_yaml(path), "page-a")
      assert_equal "done", page.fetch("status")
      assert_equal "abc123", page.fetch("commit")
      refute_nil page.fetch("completed_at")

      out, err, status = run_cli("list", "--eligible", "--config", path, chdir: dir)
      assert status.success?, err
      refute_includes out, "account.page-a"
      assert_includes out, "account.page-b"
    end
  end

  def test_amend_archives_the_accepted_baseline_and_starts_a_new_attempt
    with_config do |dir, path|
      run_success("claim", "account", "page-a", "--config", path, chdir: dir)
      mark_page_tasks_done(path, "page-a")
      run_success(
        "complete", "account", "page-a", "--commit", "accepted123",
        "--config", path, chdir: dir
      )
      accepted = page(load_yaml(path), "page-a")
      accepted_at = accepted.fetch("completed_at")

      run_success(
        "amend", "account", "page-a", "--reason", "Figma v2 updates the bottom action",
        "--config", path, chdir: dir
      )

      amended = page(load_yaml(path), "page-a")
      assert_equal "in_progress", amended.fetch("status")
      assert_equal 2, amended.fetch("attempts")
      assert_equal "Figma v2 updates the bottom action", amended.fetch("reason")
      assert_nil amended.fetch("commit")
      assert_nil amended.fetch("completed_at")
      refute_nil amended.fetch("started_at")
      assert_equal [{
        "commit" => "accepted123",
        "completed_at" => accepted_at,
        "superseded_at" => amended.fetch("started_at"),
        "amendment_reason" => "Figma v2 updates the bottom action"
      }], amended.fetch("acceptance_history")

      run_success(
        "complete", "account", "page-a", "--commit", "accepted456",
        "--config", path, chdir: dir
      )
      completed = page(load_yaml(path), "page-a")
      assert_equal "done", completed.fetch("status")
      assert_equal "accepted456", completed.fetch("commit")
      assert_equal amended.fetch("acceptance_history"), completed.fetch("acceptance_history")
    end
  end

  def test_amend_requires_a_done_page_and_a_reason
    with_config do |dir, path|
      _out, err, status = run_cli(
        "amend", "account", "page-a", "--reason", "new design",
        "--config", path, chdir: dir
      )
      refute status.success?
      assert_includes err, "must be done"

      run_success("claim", "account", "page-a", "--config", path, chdir: dir)
      mark_page_tasks_done(path, "page-a")
      run_success("complete", "account", "page-a", "--config", path, chdir: dir)
      _out, err, status = run_cli(
        "amend", "account", "page-a", "--config", path, chdir: dir
      )
      refute status.success?
      assert_includes err, "reason is required"
    end
  end

  def test_amend_accepts_a_legacy_done_page_without_completion_metadata
    with_config do |dir, path, config|
      legacy_page = page(config, "page-a")
      legacy_page["status"] = "done"
      legacy_page["attempts"] = 1
      write_config(path, config)

      run_success(
        "amend", "account", "page-a", "--reason", "Refresh legacy page",
        "--config", path, chdir: dir
      )

      amended = page(load_yaml(path), "page-a")
      assert_equal "in_progress", amended.fetch("status")
      assert_nil amended.dig("acceptance_history", 0, "completed_at")
      assert_nil amended.dig("acceptance_history", 0, "commit")
    end
  end

  def test_failed_page_is_eligible_and_can_be_claimed_again
    with_config do |dir, path|
      run_success("claim", "account", "page-a", "--config", path, chdir: dir)
      run_success(
        "fail", "account", "page-a", "--reason", "build failed",
        "--config", path, chdir: dir
      )

      out, err, status = run_cli("list", "--eligible", "--config", path, chdir: dir)
      assert status.success?, err
      assert_includes out, "account.page-a"

      run_success("claim", "account", "page-a", "--config", path, chdir: dir)
      assert_equal 2, page(load_yaml(path), "page-a").fetch("attempts")
    end
  end

  def test_blocked_page_requires_explicit_requeue
    with_config do |dir, path|
      run_success("claim", "account", "page-a", "--config", path, chdir: dir)
      run_success(
        "block", "account", "page-a", "--reason", "missing design",
        "--config", path, chdir: dir
      )

      out, err, status = run_cli("list", "--eligible", "--config", path, chdir: dir)
      assert status.success?, err
      refute_includes out, "account.page-a"

      run_success(
        "requeue", "account", "page-a", "--reason", "design supplied",
        "--config", path, chdir: dir
      )
      out, err, status = run_cli("list", "--eligible", "--config", path, chdir: dir)
      assert status.success?, err
      assert_includes out, "account.page-a"
    end
  end

  def test_status_update_preserves_leading_example_comments
    with_config do |dir, path|
      run_success("claim", "account", "page-a", "--config", path, chdir: dir)

      content = File.read(path)
      assert content.start_with?("# InAppFigma long-task configuration")
      assert_includes content, "# Page A -> Page B"
    end
  end

  def test_serve_passes_fixed_paths_and_no_open_to_node_server
    with_config do |dir, path|
      fake_node = write_fake_node(dir)
      out, err, status = run_cli(
        "serve", "--project-root", dir, "--port", "0", "--no-open",
        chdir: dir,
        env: { "IN_APP_FIGMA_NODE" => fake_node }
      )

      assert status.success?, err
      assert_includes out, "--config\n#{path}"
      assert_includes out, "--bridge\n#{File.join(SKILL_ROOT, "scripts", "task_config_web_bridge.rb")}"
      assert_includes out, "--editor-root\n#{File.join(SKILL_ROOT, "scripts", "editor")}"
      assert_includes out, "--port\n0"
      assert_includes out, "--no-open"
    end
  end

  def test_serve_rejects_missing_config_and_invalid_port
    Dir.mktmpdir do |dir|
      fake_node = write_fake_node(dir)
      _out, err, status = run_cli(
        "serve", "--project-root", dir, "--no-open",
        chdir: dir,
        env: { "IN_APP_FIGMA_NODE" => fake_node }
      )
      refute status.success?
      assert_includes err, "config not found"

      FileUtils.mkdir_p(File.join(dir, "InAppFigma"))
      File.write(File.join(dir, "InAppFigma", "InAppFigma.yaml"), YAML.dump(valid_config))
      _out, err, status = run_cli(
        "serve", "--project-root", dir, "--port", "70000", "--no-open",
        chdir: dir,
        env: { "IN_APP_FIGMA_NODE" => fake_node }
      )
      refute status.success?
      assert_includes err, "port must be between 0 and 65535"
    end
  end

  def test_serve_rejects_unavailable_node_and_does_not_rewrite_config
    with_config do |dir, path|
      original = File.binread(path)
      _out, err, status = run_cli(
        "serve", "--project-root", dir, "--no-open",
        chdir: dir,
        env: { "IN_APP_FIGMA_NODE" => File.join(dir, "missing-node") }
      )

      refute status.success?
      assert_includes err, "Node.js executable is unavailable"
      assert_equal original, File.binread(path)
    end
  end

  private

  def run_cli(*args, chdir:, env: {})
    Open3.capture3(env, RbConfig.ruby, SCRIPT, *args, chdir: chdir)
  end

  def write_fake_node(dir)
    path = File.join(dir, "fake-node")
    File.write(path, <<~SH)
      #!/bin/sh
      if [ "$1" = "--version" ]; then
        echo "v20.12.0"
        exit 0
      fi
      printf '%s\n' "$@"
    SH
    File.chmod(0o755, path)
    path
  end

  def write_xcode_project(dir, synchronized_path:, extra: nil)
    project_dir = File.join(dir, "App.xcodeproj")
    FileUtils.mkdir_p(project_dir)
    path_line = "path = #{synchronized_path};" if synchronized_path
    File.write(
      File.join(project_dir, "project.pbxproj"),
      <<~PBXPROJ
        // !$*UTF8*$!
        {
          objects = {
            ROOT_GROUP = {
              isa = PBXFileSystemSynchronizedRootGroup;
              #{path_line}
              sourceTree = "<group>";
            };
            EXTRA = {
              #{extra}
            };
          };
        }
      PBXPROJ
    )
  end

  def run_success(*args, chdir:)
    _out, err, status = run_cli(*args, chdir: chdir)
    assert status.success?, err
  end

  def with_config
    Dir.mktmpdir do |dir|
      path = File.join(dir, "InAppFigma", "InAppFigma.yaml")
      FileUtils.mkdir_p(File.dirname(path))
      config = valid_config
      write_config(path, config)
      yield dir, path, config
    end
  end

  def with_task_config(config)
    Dir.mktmpdir do |dir|
      path = File.join(dir, "InAppFigma.yaml")
      write_config(path, config)
      yield TaskConfig.new(path)
    end
  end

  def write_config(path, config)
    File.write(
      path,
      "# InAppFigma long-task configuration\n" \
      "# Page A -> Page B\n" \
      "---\n" \
      "#{YAML.dump(config).sub(/\A---\s*\n/, "")}"
    )
  end

  def load_yaml(path)
    YAML.safe_load(File.read(path), aliases: false)
  end

  def page(config, page_id)
    config.fetch("modules").first.fetch("pages").find do |item|
      item.fetch("id") == page_id
    end
  end

  def transition(config, page_id)
    page(config, page_id).fetch("navigation").fetch("transitions").first
  end

  def valid_config
    {
      "schema_version" => 1,
      "execution" => { "parallel" => false, "max_parallel" => 3 },
      "modules" => [
        {
          "id" => "account",
          "title" => "Account",
          "entry_page" => "page-a",
          "pages" => [
            page_config(
              "page-a",
              {
                "id" => "to-page-b",
                "action" => "tap_continue",
                "style" => "push",
                "destination" => "account.page-b"
              }
            ),
            page_config(
              "page-b",
              {
                "id" => "close",
                "action" => "tap_close",
                "style" => "back"
              }
            )
          ]
        }
      ]
    }
  end

  def valid_v3_config
    config = valid_config
    config["schema_version"] = 3
    config["delivery"] = { "profile" => "strict" }
    config["mock_data_sources"] = []
    config.fetch("modules").first.fetch("pages").each do |item|
      item.delete("navigation")
      item["page_role"] = "screen"
      item["data_dependencies"] = []
      item["acceptance_history"] = []
      item["behaviors"] = [{
        "id" => "tap-default",
        "type" => "interaction",
        "target" => "primary_action",
        "trigger" => { "event" => "tap" },
        "state_change" => "default",
        "run_policy" => "every_time"
      }]
    end
    config
  end

  def valid_v4_config
    config = valid_v3_config
    config["schema_version"] = 4
    config.fetch("modules").first.fetch("pages").each do |item|
      item["states"].each { |state| state["implementation_status"] = "todo" }
      item["behaviors"].each { |behavior| behavior["implementation_status"] = "todo" }
      item["accepted_baseline"] = nil
      item["removed_tasks"] = []
    end
    config
  end

  def completed_v4_config
    config = valid_v4_config
    config.fetch("modules").first.fetch("pages").each do |item|
      item["status"] = "done"
      item.fetch("states").each { |task| task["implementation_status"] = "done" }
      item.fetch("behaviors").each { |task| task["implementation_status"] = "done" }
      item["accepted_baseline"] = {
        "states" => item.fetch("states").map { |task| deep_copy(task.reject { |key, _| key == "implementation_status" }) },
        "behaviors" => item.fetch("behaviors").map { |task| deep_copy(task.reject { |key, _| key == "implementation_status" }) }
      }
    end
    config
  end

  def in_progress_v4_config
    config = valid_v4_config
    config.fetch("modules").first.fetch("pages").each do |item|
      item["status"] = "in_progress"
      item["attempts"] = 1
    end
    config
  end

  def changed_figma_url
    "https://www.figma.com/design/file/Page?node-id=9-9"
  end

  def retry_behavior
    {
      "id" => "retry-default",
      "type" => "interaction",
      "target" => "retry_action",
      "trigger" => { "event" => "tap" },
      "state_change" => "default",
      "run_policy" => "every_time",
      "implementation_status" => "todo"
    }
  end

  def deep_copy(value)
    Marshal.load(Marshal.dump(value))
  end

  def mark_page_tasks_done(path, page_id)
    config = load_yaml(path)
    target = page(config, page_id)
    target.fetch("states").each { |task| task["implementation_status"] = "done" }
    target.fetch("behaviors").each { |task| task["implementation_status"] = "done" }
    write_config(path, config)
  end

  def load_task_config(config)
    Dir.mktmpdir do |dir|
      path = File.join(dir, "InAppFigma.yaml")
      write_config(path, config)
      return TaskConfig.new(path)
    end
  end

  def page_config(id, transition)
    {
      "id" => id,
      "title" => id.split("-").map(&:capitalize).join(" "),
      "page_type" => "view",
      "status" => "todo",
      "attempts" => 0,
      "commit" => nil,
      "reason" => nil,
      "started_at" => nil,
      "completed_at" => nil,
      "states" => [
        {
          "id" => "default",
          "title" => "Default",
          "figma_url" => "https://www.figma.com/design/file/Page?node-id=1-2"
        }
      ],
      "navigation" => { "transitions" => [transition] }
    }
  end
end
