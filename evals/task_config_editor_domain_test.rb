# frozen_string_literal: true

require "minitest/autorun"
require "tmpdir"
require "yaml"

require_relative "../scripts/task_config_core"

class TaskConfigEditorDomainTest < Minitest::Test
  def setup
    @dir = Dir.mktmpdir
    @path = File.join(@dir, "InAppFigma.yaml")
    write_config(@path, valid_config)
  end

  def teardown
    FileUtils.remove_entry(@dir)
  end

  def test_snapshot_returns_normalized_preview_schema_and_sha256_revision
    snapshot = TaskConfig.new(@path).snapshot

    assert_equal "account", snapshot.fetch("config").fetch("modules").first.fetch("id")
    assert_match(/\A[0-9a-f]{64}\z/, snapshot.fetch("revision"))
    assert_equal({ "pages" => 2, "states" => 2, "behaviors" => 2, "mock_data_sources" => 0 }, snapshot.fetch("counts"))
    assert_equal 6, snapshot.dig("schema", "version")
    assert_includes snapshot.dig("schema", "statuses"), "in_progress"
    assert_equal %w[todo in_progress done], snapshot.dig("schema", "implementation_statuses")
    assert_includes snapshot.dig("schema", "transition_styles"), "full_screen"
    assert_equal snapshot.fetch("config"), YAML.safe_load(snapshot.fetch("yaml_preview"), aliases: false)
  end

  def test_legacy_config_defaults_to_strict_page_delivery_profile
    snapshot = TaskConfig.new(@path).snapshot

    assert_equal "strict", snapshot.dig("config", "delivery", "profile")
    assert_equal %w[strict implementation review], snapshot.dig("schema", "delivery_profiles")

    config = valid_config
    config["delivery"] = {}
    write_config(@path, config)
    assert_equal "strict", TaskConfig.new(@path).data.dig("delivery", "profile")
  end

  def test_delivery_profile_must_be_supported
    config = valid_config
    config["delivery"] = { "profile" => "fast" }
    write_config(@path, config)

    error = assert_raises(TaskConfigError) { TaskConfig.new(@path) }

    assert_includes error.message, "delivery.profile must be one of strict, implementation, review"
  end

  def test_legacy_config_defaults_system_ui_components_to_strict_visual_verification
    snapshot = TaskConfig.new(@path).snapshot

    assert_equal({
      "tab_bar_controller" => false,
      "picker" => false
    }, snapshot.dig("config", "system_ui"))
    assert_equal %w[tab_bar_controller picker], snapshot.dig("schema", "system_ui_components")
  end

  def test_system_ui_component_flags_must_be_known_booleans
    config = valid_config
    config["system_ui"] = {
      "tab_bar_controller" => "yes",
      "picker" => true,
      "unknown_component" => true
    }
    write_config(@path, config)

    error = assert_raises(TaskConfigError) { TaskConfig.new(@path) }

    assert_includes error.message, "system_ui.tab_bar_controller must be true or false"
    assert_includes error.message, "system_ui.unknown_component is not supported"
  end

  def test_legacy_config_normalizes_empty_mock_data_contracts
    config = valid_config
    config.delete("mock_data_sources")
    config.fetch("modules").each do |mod|
      mod.fetch("pages").each { |page| page.delete("data_dependencies") }
    end
    write_config(@path, config)

    snapshot = TaskConfig.new(@path).snapshot

    assert_equal [], snapshot.dig("config", "mock_data_sources")
    snapshot.dig("config", "modules", 0, "pages").each do |page|
      assert_equal [], page.fetch("data_dependencies")
    end
  end

  def test_shared_mock_source_can_be_referenced_by_multiple_pages
    config = valid_config
    config["mock_data_sources"] = [{
      "id" => "today-session",
      "swift_type" => "TodaySession",
      "fixture" => "standard"
    }]
    config.dig("modules", 0, "pages").each do |page|
      page["data_dependencies"] = [{
        "source" => "today-session",
        "access" => "read_write"
      }]
    end
    write_config(@path, config)

    snapshot = TaskConfig.new(@path).snapshot

    assert_equal 1, snapshot.dig("counts", "mock_data_sources")
    assert_equal "today-session", snapshot.dig("config", "modules", 0, "pages", 1, "data_dependencies", 0, "source")
    assert_includes snapshot.dig("schema", "data_access_modes"), "read_write"
  end

  def test_mock_data_sources_require_unique_ids_and_swift_contracts
    config = valid_config
    config["mock_data_sources"] = [
      { "id" => "today-session", "swift_type" => "TodaySession", "fixture" => "standard" },
      { "id" => "today-session", "swift_type" => "123 Session", "fixture" => "" }
    ]
    write_config(@path, config)

    error = assert_raises(TaskConfigError) { TaskConfig.new(@path) }

    assert_includes error.message, "duplicate mock data source id today-session"
    assert_includes error.message, "mock_data_sources[1].swift_type must be a Swift type name"
    assert_includes error.message, "mock_data_sources[1].fixture is required"
  end

  def test_page_data_dependencies_must_reference_unique_sources
    config = valid_config
    config["mock_data_sources"] = [{
      "id" => "today-session",
      "swift_type" => "TodaySession",
      "fixture" => "standard"
    }]
    config.dig("modules", 0, "pages", 0)["data_dependencies"] = [
      { "source" => "missing-session", "access" => "read_only" },
      { "source" => "missing-session", "access" => "write" }
    ]
    write_config(@path, config)

    error = assert_raises(TaskConfigError) { TaskConfig.new(@path) }

    assert_includes error.message, "data_dependencies[0].source must reference a mock data source"
    assert_includes error.message, "data_dependencies[1].source duplicates missing-session"
    assert_includes error.message, "data_dependencies[1].access must be one of read_only, read_write"
  end

  def test_validate_draft_returns_structured_unknown_destination_issue
    draft = valid_config
    draft["modules"][0]["pages"][0]["navigation"]["transitions"][0]["destination"] = "account.missing"

    result = TaskConfig.validate_draft(draft, path: @path)

    refute result.fetch("valid")
    assert_includes result.fetch("issues"), {
      "path" => "modules.account.pages.page-a.behaviors.to-page-b.actions[0].destination",
      "code" => "unknown_destination",
      "message" => "Destination account.missing does not exist."
    }
  end

  def test_validate_draft_wrong_role_issue_uses_canonical_editor_path
    wrong_role = TaskConfig.new(@path).data
    wrong_role.dig("modules", 0, "pages", 1)["page_role"] = "popup"
    role_issue = issue_matching(wrong_role, "destination must reference a screen page")
    assert_equal "modules.account.pages.page-a.behaviors.to-page-b.actions[0].destination", role_issue.fetch("path")
  end

  def test_validate_draft_missing_destination_points_to_the_destination_field
    missing_destination = TaskConfig.new(@path).data
    missing_destination.dig("modules", 0, "pages", 0, "behaviors", 0, "actions", 0).delete("destination")

    destination_issue = issue_matching(missing_destination, "requires destination")

    assert_equal "modules.account.pages.page-a.behaviors.to-page-b.actions[0].destination", destination_issue.fetch("path")
    assert_equal "required", destination_issue.fetch("code")
  end

  def test_validate_draft_invalid_parameter_issue_uses_canonical_editor_path
    invalid_parameter = TaskConfig.new(@path).data
    invalid_parameter.dig("modules", 0, "pages", 0, "behaviors", 0, "actions", 0)["parameters"] = { "item" => "" }
    parameter_issue = issue_matching(invalid_parameter, "parameters.item must be a non-empty string")
    assert_equal "modules.account.pages.page-a.behaviors.to-page-b.actions[0].parameters.item", parameter_issue.fetch("path")
  end

  def test_validate_draft_presentation_order_issue_uses_canonical_action_path
    invalid_order = TaskConfig.new(@path).data
    invalid_order.dig("modules", 0, "pages", 0, "behaviors", 0, "actions") << {
      "type" => "emit_event", "name" => "continued"
    }
    ordering_issue = issue_matching(invalid_order, "presentation actions must be last")
    assert_equal "modules.account.pages.page-a.behaviors.to-page-b.actions[0]", ordering_issue.fetch("path")
  end

  def test_validate_draft_action_issue_uses_numeric_fallback_for_invalid_behavior_id
    draft = TaskConfig.new(@path).data
    behavior = draft.dig("modules", 0, "pages", 0, "behaviors", 0)
    behavior["id"] = "Invalid behavior id"
    behavior.dig("actions", 0)["parameters"] = { "item" => "" }

    parameter_issue = issue_matching(draft, "parameters.item must be a non-empty string")

    assert_equal "modules.account.pages.page-a.behaviors[0].actions[0].parameters.item", parameter_issue.fetch("path")
  end

  def test_replace_rejects_stale_revision_without_writing
    config = TaskConfig.new(@path)
    original = File.binread(@path)

    assert_raises(TaskConfigRevisionConflict) do
      config.replace!(valid_config, expected_revision: "0" * 64, acknowledge_comment_loss: true)
    end
    assert_equal original, File.binread(@path)
  end

  def test_replace_preserves_leading_comments_and_changes_revision
    config = TaskConfig.new(@path)
    revision = config.revision
    draft = valid_config
    draft["modules"][0]["title"] = "Updated account"

    snapshot = config.replace!(draft, expected_revision: revision, acknowledge_comment_loss: false)

    assert File.read(@path).start_with?("# Header one\n# Header two\n")
    refute_equal revision, snapshot.fetch("revision")
    assert_equal "Updated account", snapshot.dig("config", "modules", 0, "title")
  end

  def test_body_comments_require_acknowledgement_before_replace
    File.write(@path, File.read(@path).sub("modules:\n", "# Important body note\nmodules:\n"))
    config = TaskConfig.new(@path)

    error = assert_raises(TaskConfigError) do
      config.replace!(valid_config, expected_revision: config.revision, acknowledge_comment_loss: false)
    end
    assert_includes error.message, "body comments"

    snapshot = config.replace!(valid_config, expected_revision: config.revision, acknowledge_comment_loss: true)
    assert_equal false, snapshot.fetch("comment_warning")
  end

  def test_status_action_requires_current_revision
    config = TaskConfig.new(@path)

    assert_raises(TaskConfigRevisionConflict) do
      config.apply_status!(
        action: "claim",
        module_id: "account",
        page_id: "page-a",
        expected_revision: "stale"
      )
    end

    snapshot = config.apply_status!(
      action: "claim",
      module_id: "account",
      page_id: "page-a",
      expected_revision: config.revision
    )
    assert_equal "in_progress", snapshot.dig("config", "modules", 0, "pages", 0, "status")
    assert_equal 1, snapshot.dig("config", "modules", 0, "pages", 0, "attempts")
  end

  def test_invalid_draft_does_not_replace_file
    config = TaskConfig.new(@path)
    original = File.binread(@path)
    draft = valid_config
    draft["modules"][0]["pages"][0]["states"] = []

    assert_raises(TaskConfigValidationError) do
      config.replace!(draft, expected_revision: config.revision, acknowledge_comment_loss: true)
    end
    assert_equal original, File.binread(@path)
  end

  private

  def issue_matching(draft, message)
    result = TaskConfig.validate_draft(draft, path: @path)
    refute result.fetch("valid")
    result.fetch("issues").find { |issue| issue.fetch("message").include?(message) } || flunk("Missing issue containing #{message.inspect}")
  end

  def write_config(path, config)
    File.write(path, "# Header one\n# Header two\n#{YAML.dump(config)}")
  end

  def valid_config
    {
      "schema_version" => 1,
      "execution" => { "parallel" => false, "max_parallel" => 2 },
      "mock_data_sources" => [],
      "modules" => [
        {
          "id" => "account",
          "title" => "Account",
          "entry_page" => "page-a",
          "pages" => [
            page_config("page-a", {
              "id" => "to-page-b",
              "action" => "tap_continue",
              "style" => "push",
              "destination" => "account.page-b"
            }),
            page_config("page-b", {
              "id" => "close",
              "action" => "tap_close",
              "style" => "back"
            })
          ]
        }
      ]
    }
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
      "acceptance_history" => [],
      "data_dependencies" => [],
      "states" => [{
        "id" => "default",
        "title" => "Default",
        "figma_url" => "https://www.figma.com/design/file/Page?node-id=1-2"
      }],
      "navigation" => { "transitions" => [transition] }
    }
  end
end
